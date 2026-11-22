import { expect, type Locator, type Page } from '@playwright/test';

import {
  REPORT_CASE_DETAIL_COPY,
  REPORT_STATUS_CHANGE_COPY,
  reportStatusChangeTitle,
} from '../../apps/admin/src/components/reporting/case/report-case-messages.ts';
import type { ReportCaseStatus } from '../../apps/common-lib/reporting/report-case-rules.ts';
import { REPORT_CASE_STATUS_LABELS } from '../../apps/common-lib/reporting/report-labels.ts';
import { REQUIRED_REASON_LABEL } from '../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';
import {
  type MailpitMessage,
  waitForEmailWithSubject,
} from '../support/mailpit.ts';

const { sections, items } = REPORT_CASE_DETAIL_COPY;

// 件名はイベントサーバーのメールのテンプレート(content-reporting/report-notice-copy.tsのREPORT_OUTCOME_SUBJECT)が決め、申出者と投稿者で同じ
const REPORT_OUTCOME_SUBJECT = '通報の対応結果についてのお知らせ';

// 申出者と投稿者の本文が共に持つ却下の文(report-notice-copy.tsのoutcomeTailとposterRejectionLead)
const REJECTED_NOTICE_TEXT = '通報を却下しました。';

// 却下の通知は確定の後に依頼のQueueを経てイベントサーバーが送る
const REPORT_NOTICE_TIMEOUT_MS = 60_000;

// 管理画面の通報の共通の文言(components/reporting/shared/report-messages.ts)の写し。そのファイルは型の読み込みで画面の部品まで辿り、JSXを扱わないルートの型検査で読めないため写す
const REPORT_CASE_PAGE_TITLE = '通報の案件の詳細';

const REJECT_DIALOG_COPY = Object.freeze({
  title: 'この通報を却下しますか?',
  confirmLabel: '却下する',
});

const STATUS_CHANGED_MESSAGES: Readonly<Record<ReportCaseStatus, string>> =
  Object.freeze({
    open: '未対応に戻しました。',
    in_progress: '対応中にしました。',
    resolved: '対応済にしました。',
    rejected: '却下しました。',
  });

// 一覧と詳細の却下の操作は、読み上げで区別できるよう対象の表示名(コメントは「<プロダクト名>へのコメント」)を含む名前を持つ
const commentRejectActionName = (productName: string): string =>
  `${productName}へのコメントの通報を却下する`;

const categoryCountLabel = (name: string, count: number): string =>
  `${name} ${String(count)}件`;

const sectionOf = (page: Page, title: string): Locator =>
  page.getByRole('main').getByRole('region', { name: title, exact: true });

const statusSectionOf = (page: Page): Locator =>
  sectionOf(page, sections.status);

const operationsSectionOf = (page: Page): Locator =>
  sectionOf(page, sections.operations);

// 詳細の項目は名前と値の組の一覧で表示するため、項目の名前の直後の値を返す
const statusItemValue = (page: Page, term: string): Locator => {
  const section = statusSectionOf(page);
  return section
    .getByRole('term')
    .and(section.getByText(term, { exact: true }))
    .locator('xpath=following-sibling::dd[1]');
};

const statusItemTerm = (page: Page, term: string): Locator => {
  const section = statusSectionOf(page);
  return section
    .getByRole('term')
    .and(section.getByText(term, { exact: true }));
};

// メニューへの登録とは独立に確かめるため、案件の詳細のURLを直接開く
export async function openReportCaseDetail(
  page: Page,
  caseId: string,
): Promise<void> {
  await page.goto(`/reports/${encodeURIComponent(caseId)}`);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: REPORT_CASE_PAGE_TITLE,
      exact: true,
    }),
  ).toBeVisible();
}

export async function expectReportCaseStatus(
  page: Page,
  status: ReportCaseStatus,
): Promise<void> {
  await expect(statusItemValue(page, items.status)).toHaveText(
    REPORT_CASE_STATUS_LABELS[status],
  );
}

// カテゴリごとの件数の内訳が、指定したカテゴリの件数だけであることを確かめる
export async function expectReportCaseBreakdown(
  page: Page,
  counts: readonly { readonly name: string; readonly count: number }[],
): Promise<void> {
  await expect(
    statusItemValue(page, items.categoryCounts).getByRole('listitem'),
  ).toHaveText(
    counts.map(({ name, count }) => categoryCountLabel(name, count)),
  );
}

// 開いた直後はハイドレーションの前に押した操作が効かないため、確認のダイアログが開くまで押し直す
async function openDialogBy(
  page: Page,
  button: Locator,
  title: string,
): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await button.click({ timeout: REACTION_TIMEOUT_MS });
    }
    await expect(dialog).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  return dialog;
}

async function confirmWithReason(
  page: Page,
  dialog: Locator,
  confirmLabel: string,
  reason: string,
  changedMessage: string,
): Promise<void> {
  await dialog.getByLabel(REQUIRED_REASON_LABEL, { exact: true }).fill(reason);
  await dialog.getByRole('button', { name: confirmLabel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(changedMessage, { exact: true })).toBeVisible();
}

// 詳細の操作の区画からコメントへの通報を理由を添えて却下し、完了の種類と理由が表示されることを確かめる
export async function rejectCommentReportCase(
  page: Page,
  productName: string,
  reason: string,
): Promise<void> {
  const copy = REJECT_DIALOG_COPY;
  const rejectButton = operationsSectionOf(page).getByRole('button', {
    name: commentRejectActionName(productName),
    exact: true,
  });
  const dialog = await openDialogBy(page, rejectButton, copy.title);
  await confirmWithReason(
    page,
    dialog,
    copy.confirmLabel,
    reason,
    STATUS_CHANGED_MESSAGES.rejected,
  );
  await expectReportCaseStatus(page, 'rejected');
  await expect(statusItemValue(page, items.resolution)).toHaveText(
    REPORT_CASE_STATUS_LABELS.rejected,
  );
  await expect(statusItemValue(page, items.closingReason)).toHaveText(reason);
  await expect(statusItemTerm(page, items.closedAt)).toHaveCount(1);
  await expect(rejectButton).toHaveCount(0);
}

// 対応ステータスの変更で状態を選び、理由を添えて手で変更する
export async function changeReportCaseStatus(
  page: Page,
  to: ReportCaseStatus,
  reason: string,
): Promise<void> {
  const operations = operationsSectionOf(page);
  const select = operations.getByRole('combobox', {
    name: REPORT_STATUS_CHANGE_COPY.nextStatus,
    exact: true,
  });
  const option = page.getByRole('option', {
    name: REPORT_CASE_STATUS_LABELS[to],
    exact: true,
  });
  await expect(async () => {
    if (!(await option.isVisible())) {
      await select.click({ timeout: REACTION_TIMEOUT_MS });
    }
    await expect(option).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  await option.click();
  await expect(select).toHaveText(REPORT_CASE_STATUS_LABELS[to]);
  const dialog = await openDialogBy(
    page,
    operations.getByRole('button', {
      name: REPORT_STATUS_CHANGE_COPY.submit,
      exact: true,
    }),
    reportStatusChangeTitle(REPORT_CASE_STATUS_LABELS[to]),
  );
  await confirmWithReason(
    page,
    dialog,
    REPORT_STATUS_CHANGE_COPY.confirm,
    reason,
    STATUS_CHANGED_MESSAGES[to],
  );
  await expectReportCaseStatus(page, to);
}

// 完了から戻した案件は完了の種類・理由・日時を持たない
export async function expectNoClosingRecord(page: Page): Promise<void> {
  for (const term of [items.resolution, items.closingReason, items.closedAt]) {
    await expect(statusItemTerm(page, term)).toHaveCount(0);
  }
}

// 却下の通知が宛先へ届き、本文に却下の文と管理者の理由があることを確かめる
export async function expectRejectionNotice(
  email: string,
  reason: string,
  receivedAfter: Date,
): Promise<MailpitMessage> {
  const mail = await waitForEmailWithSubject(
    { to: email, subject: REPORT_OUTCOME_SUBJECT, receivedAfter },
    { timeoutMs: REPORT_NOTICE_TIMEOUT_MS },
  );
  expect(mail.text).toContain(REJECTED_NOTICE_TEXT);
  expect(mail.text).toContain(reason);
  return mail;
}
