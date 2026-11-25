import { expect, type Locator, type Page } from '@playwright/test';

import {
  COMMENT_ACTIONS_MENU_LABEL,
  COMMENT_POST_PLACEHOLDER,
  COMMENT_POST_SUBMIT_LABEL,
  COMMENT_RATING_INPUT_LABEL,
  COMMENT_WITH_RATING_POSTED_MESSAGE,
} from '../../../apps/client/src/components/engagement/comment-messages.ts';
import {
  REPORT_ACTION_LABELS,
  REPORT_DIALOG_TITLES,
  REPORT_MESSAGES,
} from '../../../apps/client/src/components/reporting/report-messages.ts';
import { REPORT_CATEGORY_OTHER_NAME } from '../../../apps/common-lib/reporting/report-rules.ts';
import {
  BOLD_ACTION_LABEL,
  FORMAT_TOOLBAR_LABEL,
} from '../../../apps/frontend-lib/utilities/messages/markdown-messages.ts';
import { waitForBotToken } from '../../support/bot-verification.ts';
import type { KeyboardOperator } from '../../support/keyboard-operator.ts';
import { RETRY_TIMEOUT_MS } from '../../support/hydration-retry.ts';
import { launchCommentsSectionOf } from '../engagement-steps.ts';
import { markdownEditable } from '../markdown-steps.ts';

const RATING_SCORE = 4;

const REPORT_REASON = 'E2Eのキーボード操作の確認のための通報です。';

// 入力欄は読み込みの後に編集できるようになるため、bot判定のトークンと書式のツールが使えるようになってから、Tabで入力欄へ移って本文を打つ
async function typeMarkdownByKeyboard(
  operator: KeyboardOperator,
  editable: Locator,
  name: string,
  text: string,
): Promise<Locator> {
  const form = editable.locator('xpath=ancestor::form[1]');
  await waitForBotToken(form);
  await expect(
    form
      .getByRole('toolbar', { name: FORMAT_TOOLBAR_LABEL })
      .getByRole('button', { name: BOLD_ACTION_LABEL, exact: true }),
  ).toBeEnabled();
  await operator.focus(editable, name);
  await operator.page.keyboard.type(text);
  await expect(editable).toContainText(text);
  return form;
}

// コメント欄へ本文を入力し、評価の星を矢印キーで選び、送信のボタンをEnterで押す。続けてコメントの操作のメニューをEscapeで閉じる
export async function postCommentByKeyboard(
  operator: KeyboardOperator,
  body: string,
): Promise<Locator> {
  const { page } = operator;
  const section = launchCommentsSectionOf(page);
  const form = await typeMarkdownByKeyboard(
    operator,
    markdownEditable(section, COMMENT_POST_PLACEHOLDER),
    'コメントの入力欄',
    body,
  );
  const stars = form.getByRole('radiogroup', {
    name: COMMENT_RATING_INPUT_LABEL,
    exact: true,
  });
  await operator.chooseRadio(
    stars,
    stars.getByRole('radio').nth(RATING_SCORE - 1),
    `評価の星${String(RATING_SCORE)}`,
    'ArrowRight',
  );
  await operator.activate(
    form.getByRole('button', { name: COMMENT_POST_SUBMIT_LABEL, exact: true }),
    'コメントの送信',
  );
  await expect(
    page.getByText(COMMENT_WITH_RATING_POSTED_MESSAGE, { exact: true }),
  ).toBeVisible({ timeout: RETRY_TIMEOUT_MS });
  const article = section
    .getByRole('article')
    .filter({ hasText: body })
    .first();
  await expect(article).toBeVisible();
  return article;
}

// 自分のコメントの操作のメニューをEnterで開き、Escapeで閉じてフォーカスがメニューのボタンへ戻ることを確かめる
export async function openCommentMenuAndEscape(
  operator: KeyboardOperator,
  article: Locator,
): Promise<void> {
  const { page } = operator;
  const trigger = article.getByRole('button', {
    name: COMMENT_ACTIONS_MENU_LABEL,
    exact: true,
  });
  await operator.activate(trigger, 'コメントの操作のメニュー');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await operator.expectPopupEscapeCloses(
    menu,
    'コメントの操作のメニュー',
    trigger,
  );
}

// プロダクトページの通報のボタンから通報のダイアログを開き、Escapeで閉じて元のボタンへフォーカスが戻ることを確かめてから、開き直して理由を入力して送る
export async function reportProductByKeyboard(
  operator: KeyboardOperator,
  page: Page,
): Promise<void> {
  const opener = page.getByRole('button', {
    name: REPORT_ACTION_LABELS.product,
    exact: true,
  });
  const dialog = page.getByRole('dialog', {
    name: REPORT_DIALOG_TITLES.product,
    exact: true,
  });
  const form = dialog.getByRole('form', {
    name: REPORT_DIALOG_TITLES.product,
    exact: true,
  });

  await operator.activate(opener, 'プロダクトの通報の操作');
  await expect(dialog).toBeVisible();
  await operator.expectDialogEscapeCloses(dialog, '通報のダイアログ', opener);

  await operator.activate(opener, 'プロダクトの通報の操作');
  await expect(form).toBeVisible();
  await waitForBotToken(form);
  const categories = form.getByRole('radiogroup');
  await operator.chooseRadio(
    categories,
    form.getByRole('radio', { name: REPORT_CATEGORY_OTHER_NAME, exact: true }),
    `通報のカテゴリ(${REPORT_CATEGORY_OTHER_NAME})`,
  );
  await operator.type(
    form.getByRole('textbox', {
      name: REPORT_MESSAGES.reasonLabel,
      exact: true,
    }),
    '通報の理由',
    REPORT_REASON,
  );
  await operator.activate(
    form.getByRole('button', { name: REPORT_MESSAGES.submit, exact: true }),
    '通報の送信',
  );
  await expect(
    page.getByText(REPORT_MESSAGES.accepted, { exact: true }),
  ).toBeVisible({ timeout: RETRY_TIMEOUT_MS });
  await expect(form).toHaveCount(0);
}
