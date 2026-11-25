import { expect, type Locator, type Page } from '@playwright/test';

import {
  COMMENT_ACTIONS_MENU_LABEL,
  COMMENT_EDIT_LABEL,
} from '../../apps/client/src/components/engagement/comment-messages.ts';
import {
  ACTIONS_MENU_LABEL,
  PROFILE_EDIT_LABEL,
} from '../../apps/client/src/components/profile/profile-messages.ts';
import {
  REPORT_ACTION_LABELS,
  REPORT_DIALOG_TITLES,
  REPORT_MESSAGES,
} from '../../apps/client/src/components/reporting/report-messages.ts';
import type { ReportTargetKind } from '../../apps/common-lib/reporting/report-rules.ts';
import { waitForBotToken } from '../support/bot-verification.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';

export interface ReportInput {
  readonly categoryName: string;
  readonly reason: string;
  // 未ログインの「権利侵害」のときだけ欄が出る。省くと欄が無いことを確かめる
  readonly contactEmail?: string;
}

const reportDialogOf = (page: Page, kind: ReportTargetKind): Locator =>
  page.getByRole('dialog', { name: REPORT_DIALOG_TITLES[kind], exact: true });

const reportFormOf = (dialog: Locator, kind: ReportTargetKind): Locator =>
  dialog.getByRole('form', { name: REPORT_DIALOG_TITLES[kind], exact: true });

export const contactEmailField = (form: Locator): Locator =>
  form.getByRole('textbox', {
    name: REPORT_MESSAGES.contactEmailLabel,
    exact: true,
  });

const reasonField = (form: Locator): Locator =>
  form.getByRole('textbox', { name: REPORT_MESSAGES.reasonLabel, exact: true });

const submitButtonOf = (form: Locator): Locator =>
  form.getByRole('button', { name: REPORT_MESSAGES.submit, exact: true });

// カテゴリは開いた時に取得し、フォームはbot判定のトークンが入るまで送れないため、トークンが入ったフォームを返す
async function readyReportForm(
  page: Page,
  kind: ReportTargetKind,
): Promise<Locator> {
  const form = reportFormOf(reportDialogOf(page, kind), kind);
  await expect(form).toBeVisible();
  await waitForBotToken(form);
  return form;
}

// ハイドレーションの前に押した操作は何もしないため、ダイアログが開くまで押し直す
async function openDialogBy(
  page: Page,
  kind: ReportTargetKind,
  trigger: Locator,
): Promise<Locator> {
  const dialog = reportDialogOf(page, kind);
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await trigger.click({ timeout: REACTION_TIMEOUT_MS });
    }
    await expect(dialog).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  return readyReportForm(page, kind);
}

// メニューの項目が現れるまでメニューのボタンを押し直す
async function openMenuUntil(
  menuButton: Locator,
  item: Locator,
): Promise<void> {
  await expect(async () => {
    if (!(await item.isVisible())) {
      await menuButton.click({ timeout: REACTION_TIMEOUT_MS });
    }
    await expect(item).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
}

async function openDialogFromMenu(
  page: Page,
  kind: ReportTargetKind,
  menuButton: Locator,
): Promise<Locator> {
  const item = page.getByRole('menuitem', {
    name: REPORT_ACTION_LABELS[kind],
    exact: true,
  });
  await openMenuUntil(menuButton, item);
  await item.click();
  await expect(reportDialogOf(page, kind)).toBeVisible();
  return readyReportForm(page, kind);
}

const productReportButtonOf = (page: Page): Locator =>
  page.getByRole('button', { name: REPORT_ACTION_LABELS.product, exact: true });

const profileActionsMenuOf = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByRole('button', { name: ACTIONS_MENU_LABEL, exact: true });

const commentActionsMenuOf = (article: Locator): Locator =>
  article.getByRole('button', {
    name: COMMENT_ACTIONS_MENU_LABEL,
    exact: true,
  });

const profileHeadingOf = (page: Page, nickname: string): Locator =>
  page.getByRole('heading', { level: 1, name: nickname, exact: true });

export async function openProductReportForm(page: Page): Promise<Locator> {
  return openDialogBy(page, 'product', productReportButtonOf(page));
}

export async function openProfileReportForm(
  page: Page,
  nickname: string,
): Promise<Locator> {
  await expect(profileHeadingOf(page, nickname)).toBeVisible();
  return openDialogFromMenu(page, 'user', profileActionsMenuOf(page));
}

export async function openCommentReportForm(
  page: Page,
  article: Locator,
): Promise<Locator> {
  await expect(article).toBeVisible();
  return openDialogFromMenu(page, 'comment', commentActionsMenuOf(article));
}

async function fillReport(
  form: Locator,
  { categoryName, reason }: Omit<ReportInput, 'contactEmail'>,
): Promise<void> {
  const category = form.getByRole('radio', { name: categoryName, exact: true });
  await category.click();
  await expect(category).toHaveAttribute('aria-checked', 'true');
  await reasonField(form).fill(reason);
}

export async function submitReportForm(
  page: Page,
  form: Locator,
  { contactEmail, ...input }: ReportInput,
): Promise<void> {
  await fillReport(form, input);
  const contact = contactEmailField(form);
  if (contactEmail === undefined) {
    await expect(contact).toHaveCount(0);
  } else {
    await contact.fill(contactEmail);
  }
  await submitButtonOf(form).click();
  // 受け付けはbot判定の検証・回数制限・案件への集約を順に行い、開発サーバーの負荷で既定の検証の待ちを超えることがあるため長く待つ
  await expect(
    page.getByText(REPORT_MESSAGES.accepted, { exact: true }),
  ).toBeVisible({ timeout: RETRY_TIMEOUT_MS });
  await expect(form).toHaveCount(0);
}

// 連絡先の欄が必須として現れ、空のままでは送信のボタンが押せないことを確かめる
export async function expectContactEmailRequired(
  form: Locator,
  input: Omit<ReportInput, 'contactEmail'>,
): Promise<void> {
  await fillReport(form, input);
  const contact = contactEmailField(form);
  await expect(contact).toBeVisible();
  await expect(contact).toHaveAttribute('aria-required', 'true');
  await expect(contact).toHaveValue('');
  await expect(submitButtonOf(form)).toBeDisabled();
}

// 本人の表示になったこと(編集のリンク)を確かめてから、メニューのボタンと通報の項目が無いことを確かめる
export async function expectNoProfileReportAction(
  page: Page,
  nickname: string,
): Promise<void> {
  await expect(profileHeadingOf(page, nickname)).toBeVisible();
  await expect(
    page.getByRole('link', { name: PROFILE_EDIT_LABEL, exact: true }),
  ).toBeVisible();
  await expect(profileActionsMenuOf(page)).toHaveCount(0);
  await expect(page.getByText(REPORT_ACTION_LABELS.user)).toHaveCount(0);
}

export async function expectNoProductReportAction(page: Page): Promise<void> {
  await expect(productReportButtonOf(page)).toHaveCount(0);
}

// 自分のコメントのメニューは「編集」「削除」だけを持つため、メニューを開いて通報の項目が無いことを確かめてから閉じる
export async function expectNoCommentReportAction(
  page: Page,
  article: Locator,
): Promise<void> {
  const menuButton = commentActionsMenuOf(article);
  await openMenuUntil(
    menuButton,
    page.getByRole('menuitem', { name: COMMENT_EDIT_LABEL, exact: true }),
  );
  await expect(
    page.getByRole('menuitem', {
      name: REPORT_ACTION_LABELS.comment,
      exact: true,
    }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
}
