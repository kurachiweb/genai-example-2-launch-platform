import { expect, type Locator, type Page } from '@playwright/test';

import { OWN_PRODUCT_RATING_MESSAGE } from '../../apps/common-lib/engagement/engagement-rules.ts';
import {
  COMMENT_ACTIONS_MENU_LABEL,
  COMMENT_DELETE_CONFIRM_TITLE,
  COMMENT_DELETE_LABEL,
  COMMENT_DELETED_MESSAGE,
  COMMENT_EDIT_LABEL,
  COMMENT_EDIT_PLACEHOLDER,
  COMMENT_EDIT_SUBMIT_LABEL,
  COMMENT_EDITED_MARK,
  COMMENT_GUEST_NOTICE,
  COMMENT_LOGIN_LINK_LABEL,
  COMMENT_POST_PLACEHOLDER,
  COMMENT_POST_SUBMIT_LABEL,
  COMMENT_POSTED_MESSAGE,
  COMMENT_RATING_INPUT_LABEL,
  COMMENT_REPLIED_MESSAGE,
  COMMENT_REPLY_LABEL,
  COMMENT_REPLY_PLACEHOLDER,
  COMMENT_REPLY_SUBMIT_LABEL,
  COMMENT_UPDATED_MESSAGE,
  COMMENT_WITH_RATING_POSTED_MESSAGE,
  commentCountMetricLabel,
  commentLabelOf,
  launchCommentsLabel,
  REMOVED_COMMENT_LABEL,
  REMOVED_COMMENT_MESSAGE,
} from '../../apps/client/src/components/engagement/comment-messages.ts';
import {
  OWN_RATING_LABEL,
  RATING_CANCEL_LABEL,
  RATING_EMPTY_MESSAGE,
  RATING_GUEST_NOTICE,
  RATING_OUT_OF_FIVE,
  RATING_SECTION_TITLE,
  ratingCountLabelOf,
} from '../../apps/client/src/components/engagement/rating-messages.ts';
import {
  BOLD_ACTION_LABEL,
  FORMAT_TOOLBAR_LABEL,
} from '../../apps/frontend-lib/utilities/messages/markdown-messages.ts';
import { waitForBotToken } from '../support/bot-verification.ts';
import { RETRY_TIMEOUT_MS } from '../support/hydration-retry.ts';
import {
  executeLocalD1,
  type LocalD1Row,
  sqlStringLiteral,
} from '../support/local-d1.ts';
import { waitForToastDismissed } from '../support/toast.ts';
import {
  directoryItemOf,
  directoryPeriodPath,
  openDirectory,
  productPagePath,
} from './directory-steps.ts';
import { markdownEditable } from './markdown-steps.ts';

export interface EngagementProduct {
  readonly handle: string;
  readonly name: string;
}

export interface CommentRow {
  readonly id: string;
  readonly body: string;
  readonly authorUserId: string | null;
}

const FIRST_LAUNCH_NUMBER = 1;

export const ratingSectionOf = (page: Page): Locator =>
  page.getByRole('region', { name: RATING_SECTION_TITLE, exact: true });

export const launchCommentsSectionOf = (page: Page): Locator =>
  page.getByRole('region', {
    name: launchCommentsLabel(FIRST_LAUNCH_NUMBER),
    exact: true,
  });

// 同じ投稿者のコメントが並ぶため、投稿者のニックネームの名前と本文で1件に絞る
export const commentArticleOf = (
  scope: Locator,
  nickname: string,
  body: string,
): Locator =>
  scope
    .getByRole('article', { name: commentLabelOf(nickname), exact: true })
    .filter({ hasText: body });

export const removedCommentArticleOf = (scope: Locator): Locator =>
  scope.getByRole('article', { name: REMOVED_COMMENT_LABEL, exact: true });

export const replyButtonOf = (article: Locator): Locator =>
  article.getByRole('button', { name: COMMENT_REPLY_LABEL, exact: true });

// 最新のローンチのコメント欄は既定で開いている
export async function openEngagementProductPage(
  page: Page,
  product: EngagementProduct,
): Promise<void> {
  await page.goto(productPagePath(product.handle));
  await expect(
    page.getByRole('heading', { level: 1, name: product.name, exact: true }),
  ).toBeVisible();
  await expect(launchCommentsSectionOf(page)).toBeVisible();
}

// 入力欄は読み込みの後に編集できるようになるため、bot判定のトークン(ハイドレーションの後に届く)と書式のツールが押せるようになるのを待ってから本文を打つ。本文はフォーカスが外れた時に確定し、続く評価や送信のボタンの操作でフォーカスが移る
async function typeCommentBody(
  page: Page,
  editable: Locator,
  text: string,
  { appendToEnd = false }: { readonly appendToEnd?: boolean } = {},
): Promise<Locator> {
  const form = editable.locator('xpath=ancestor::form[1]');
  await waitForBotToken(form);
  await expect(
    form
      .getByRole('toolbar', { name: FORMAT_TOOLBAR_LABEL })
      .getByRole('button', { name: BOLD_ACTION_LABEL, exact: true }),
  ).toBeEnabled();
  await editable.click();
  if (appendToEnd) {
    await page.keyboard.press('ControlOrMeta+End');
  }
  await page.keyboard.type(text);
  return form;
}

// 送信の成功のトーストを前の送信のトーストと取り違えないよう、前のトーストが消えてから送る
async function submitAndWaitForToast(
  page: Page,
  form: Locator,
  submitLabel: string,
  message: string,
): Promise<void> {
  await form.getByRole('button', { name: submitLabel, exact: true }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
}

async function waitForPreviousToast(
  page: Page,
  message: string,
): Promise<void> {
  await waitForToastDismissed(page, page.getByText(message, { exact: true }));
}

// 評価の行の星は低い順に並ぶ
const starOf = (radiogroup: Locator, score: number): Locator =>
  radiogroup.getByRole('radio').nth(score - 1);

export async function postComment(
  page: Page,
  body: string,
  rating?: number,
): Promise<Locator> {
  const section = launchCommentsSectionOf(page);
  const message =
    rating === undefined
      ? COMMENT_POSTED_MESSAGE
      : COMMENT_WITH_RATING_POSTED_MESSAGE;
  await waitForPreviousToast(page, message);
  const form = await typeCommentBody(
    page,
    markdownEditable(section, COMMENT_POST_PLACEHOLDER),
    body,
  );
  if (rating !== undefined) {
    const star = starOf(
      form.getByRole('radiogroup', {
        name: COMMENT_RATING_INPUT_LABEL,
        exact: true,
      }),
      rating,
    );
    await star.click();
    await expect(star).toHaveAttribute('aria-checked', 'true');
  }
  await submitAndWaitForToast(page, form, COMMENT_POST_SUBMIT_LABEL, message);
  const article = section
    .getByRole('article')
    .filter({ hasText: body })
    .first();
  await expect(article).toBeVisible();
  return article;
}

export async function replyToComment(
  page: Page,
  article: Locator,
  body: string,
): Promise<void> {
  await waitForPreviousToast(page, COMMENT_REPLIED_MESSAGE);
  const editable = markdownEditable(article, COMMENT_REPLY_PLACEHOLDER);
  await replyButtonOf(article).click();
  // 入力欄の編集領域の部品は最初の読み込みに含まれず、開いた時に読み込むため、既定の検証の待ちより長く待つ
  await expect(editable).toBeVisible({ timeout: RETRY_TIMEOUT_MS });
  const form = await typeCommentBody(page, editable, body);
  await submitAndWaitForToast(
    page,
    form,
    COMMENT_REPLY_SUBMIT_LABEL,
    COMMENT_REPLIED_MESSAGE,
  );
  await expect(editable).toHaveCount(0);
}

async function chooseCommentMenuItem(
  page: Page,
  article: Locator,
  label: string,
): Promise<void> {
  const item = page.getByRole('menuitem', { name: label, exact: true });
  await article
    .getByRole('button', { name: COMMENT_ACTIONS_MENU_LABEL, exact: true })
    .click();
  await expect(item).toBeVisible();
  await item.click();
}

// 編集の欄は今の本文で開くため、本文の末尾に書き足す
export async function appendToComment(
  page: Page,
  article: Locator,
  addition: string,
): Promise<void> {
  await waitForPreviousToast(page, COMMENT_UPDATED_MESSAGE);
  await chooseCommentMenuItem(page, article, COMMENT_EDIT_LABEL);
  const editable = markdownEditable(article, COMMENT_EDIT_PLACEHOLDER);
  const form = await typeCommentBody(page, editable, addition, {
    appendToEnd: true,
  });
  await submitAndWaitForToast(
    page,
    form,
    COMMENT_EDIT_SUBMIT_LABEL,
    COMMENT_UPDATED_MESSAGE,
  );
  await expect(editable).toHaveCount(0);
  await expect(article.getByText(COMMENT_EDITED_MARK)).toBeVisible();
}

export async function deleteComment(
  page: Page,
  article: Locator,
): Promise<void> {
  await waitForPreviousToast(page, COMMENT_DELETED_MESSAGE);
  await chooseCommentMenuItem(page, article, COMMENT_DELETE_LABEL);
  const dialog = page.getByRole('dialog', {
    name: COMMENT_DELETE_CONFIRM_TITLE,
  });
  await waitForBotToken(dialog);
  await dialog
    .getByRole('button', { name: COMMENT_DELETE_LABEL, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText(COMMENT_DELETED_MESSAGE, { exact: true }),
  ).toBeVisible();
}

export async function expectRemovedComment(scope: Locator): Promise<void> {
  await expect(
    removedCommentArticleOf(scope).getByText(REMOVED_COMMENT_MESSAGE, {
      exact: true,
    }),
  ).toBeVisible();
}

export async function expectRatingSummary(
  page: Page,
  { average, count }: { readonly average: string; readonly count: number },
): Promise<void> {
  const section = ratingSectionOf(page);
  await expect(
    section.getByText(`${average}${RATING_OUT_OF_FIVE}`, { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByText(ratingCountLabelOf(String(count)), { exact: true }),
  ).toBeVisible();
}

export async function expectNoRatings(page: Page): Promise<void> {
  await expect(
    ratingSectionOf(page).getByText(RATING_EMPTY_MESSAGE),
  ).toBeVisible();
}

const ownRatingOf = (page: Page): Locator =>
  ratingSectionOf(page).getByRole('radiogroup', {
    name: OWN_RATING_LABEL,
    exact: true,
  });

export async function rateFromSection(
  page: Page,
  score: number,
  message: string,
): Promise<void> {
  await waitForPreviousToast(page, message);
  const star = starOf(ownRatingOf(page), score);
  await star.click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(star).toHaveAttribute('aria-checked', 'true');
}

export async function cancelRatingFromSection(
  page: Page,
  message: string,
): Promise<void> {
  await waitForPreviousToast(page, message);
  await ratingSectionOf(page)
    .getByRole('button', { name: RATING_CANCEL_LABEL, exact: true })
    .click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(
    ownRatingOf(page).getByRole('radio', { checked: true }),
  ).toHaveCount(0);
}

export async function expectOwnProductRatingNotice(page: Page): Promise<void> {
  const section = ratingSectionOf(page);
  await expect(
    section.getByText(OWN_PRODUCT_RATING_MESSAGE, { exact: true }),
  ).toBeVisible();
  await expect(section.getByRole('radiogroup')).toHaveCount(0);
}

// 未ログインの閲覧者には、コメント欄にログインの案内とリンク、評価欄に星を選ぶとログインできる案内が出る
export async function expectGuestPrompts(page: Page): Promise<void> {
  const section = launchCommentsSectionOf(page);
  await expect(
    section.getByText(COMMENT_GUEST_NOTICE, { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole('link', { name: COMMENT_LOGIN_LINK_LABEL, exact: true }),
  ).toHaveAttribute('href', /^\/auth\/login\?/u);
  await expect(
    section.getByRole('textbox', { name: COMMENT_POST_PLACEHOLDER }),
  ).toHaveCount(0);
  await expect(
    ratingSectionOf(page).getByText(RATING_GUEST_NOTICE, { exact: true }),
  ).toBeVisible();
}

// 掲載中のプロダクトの補助は索引を作らず検索に現れないため、実施日の期間の一覧で項目を探す
export async function expectDirectoryCommentCount(
  page: Page,
  matchDate: string,
  productName: string,
  count: number,
): Promise<void> {
  await openDirectory(
    page,
    directoryPeriodPath({ from: matchDate, to: matchDate }),
  );
  await expect(
    directoryItemOf(page, productName).getByRole('link', {
      name: commentCountMetricLabel(String(count)),
      exact: true,
    }),
  ).toBeVisible();
}

// 掲載中のプロダクトの補助が作る投稿者はログインできないため、投稿者本人の表示を確かめられるよう、プロダクトと予選の記録の投稿者を確認済みの利用者に付け替える
export async function transferProductOwnership(
  productHandle: string,
  ownerEmail: string,
): Promise<void> {
  const owner = `(SELECT id FROM users WHERE email = ${sqlStringLiteral(ownerEmail)} AND deleted_at IS NULL)`;
  const product = `(SELECT id FROM products WHERE handle = ${sqlStringLiteral(productHandle)} AND deleted_at IS NULL)`;
  const updated = await executeLocalD1(
    [
      `UPDATE match_entries SET owner_user_id = ${owner}, updated_at = ${String(Date.now())} WHERE product_id = ${product} AND ${owner} IS NOT NULL;`,
      `UPDATE products SET user_id = ${owner}, updated_at = ${String(Date.now())} WHERE id = ${product} AND ${owner} IS NOT NULL RETURNING id;`,
    ].join('\n'),
  );
  if (updated.length !== 1) {
    throw new Error(
      `プロダクト(${productHandle})の投稿者を利用者(${ownerEmail})に付け替えられませんでした`,
    );
  }
}

const commentRowOf = (row: LocalD1Row): CommentRow => {
  const { id, body, author_user_id: authorUserId } = row;
  if (
    typeof id !== 'string' ||
    typeof body !== 'string' ||
    (typeof authorUserId !== 'string' && authorUserId !== null)
  ) {
    throw new Error(
      `コメントの照会の結果の形式が正しくありません: ${JSON.stringify(row)}`,
    );
  }
  return { id, body, authorUserId };
};

// 投稿の古い順に返す
export async function readProductComments(
  productHandle: string,
): Promise<readonly CommentRow[]> {
  const rows = await executeLocalD1(
    `SELECT id, body, author_user_id FROM launch_comments WHERE product_id = (SELECT id FROM products WHERE handle = ${sqlStringLiteral(productHandle)}) ORDER BY created_at, id;`,
  );
  return rows.map(commentRowOf);
}

// 画面からは削除から日数の経ったコメントを作れないため、削除済みのコメントの削除の日時を書き換える
export async function moveCommentDeletion(
  commentId: string,
  deletedAt: Date,
): Promise<void> {
  const updated = await executeLocalD1(
    `UPDATE launch_comments SET deleted_at = ${String(deletedAt.getTime())} WHERE id = ${sqlStringLiteral(commentId)} AND deleted_at IS NOT NULL AND anonymized_at IS NULL RETURNING id;`,
  );
  if (updated.length !== 1) {
    throw new Error(
      `削除済みで匿名化していないコメント(${commentId})の削除の日時を書き換えられませんでした`,
    );
  }
}
