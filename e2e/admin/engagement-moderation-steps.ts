import { expect, type Locator, type Page } from '@playwright/test';

import {
  COMMENT_LIST_CAPTION,
  commentActionName,
  hideCommentDialogCopy,
  invalidateRatingDialogCopy,
  MODERATION_CHANGED_MESSAGES,
  RATING_LIST_CAPTION,
  RATING_STATE_LABELS,
  ratingActionName,
} from '../../apps/admin/src/components/moderation/shared/moderation-messages.ts';
import { ADMIN_COMMENT_STATE_LABELS } from '../../apps/common-lib/moderation/moderation-labels.ts';
import { REQUIRED_REASON_LABEL } from '../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';
import type {
  FixtureUser,
  ModerationTargets,
} from '../support/moderation-fixtures.ts';

const COMMENTS_PATH = '/comments';

const RATINGS_PATH = '/ratings';

const commentsPathOf = (authorHandle: string): string =>
  `${COMMENTS_PATH}?${new URLSearchParams({ authorHandle }).toString()}`;

const ratingsPathOf = (raterHandle: string): string =>
  `${RATINGS_PATH}?${new URLSearchParams({ raterHandle }).toString()}`;

const tableRowOf = (page: Page, caption: string, text: string): Locator =>
  page
    .getByRole('main')
    .getByRole('table', { name: caption, exact: true })
    .getByRole('row')
    .filter({ hasText: text });

// 開いた直後はハイドレーションの前に押した操作が効かないため、確認のダイアログが開くまで押し直す
async function openActionDialog(
  page: Page,
  button: Locator,
  dialogTitle: string,
): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: dialogTitle, exact: true });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await button.click();
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

// 投稿者のハンドルで絞ったコメントの一覧から、補助で作ったコメントを理由を添えて非公開化し、行の状態と操作が替わることを確かめる
export async function hideCommentFromList(
  page: Page,
  { comment }: Pick<ModerationTargets, 'comment'>,
  reason: string,
): Promise<void> {
  const { nickname, handle } = comment.author;
  await page.goto(commentsPathOf(handle));
  const row = tableRowOf(page, COMMENT_LIST_CAPTION, comment.body);
  await expect(row).toHaveCount(1);
  const copy = hideCommentDialogCopy(nickname);
  const dialog = await openActionDialog(
    page,
    row.getByRole('button', {
      name: commentActionName('hide', nickname),
      exact: true,
    }),
    copy.title,
  );
  await confirmWithReason(
    page,
    dialog,
    copy.confirmLabel,
    reason,
    MODERATION_CHANGED_MESSAGES['comment.hide'],
  );
  await expect(row).toContainText(ADMIN_COMMENT_STATE_LABELS.hidden);
  await expect(
    row.getByRole('button', {
      name: commentActionName('unhide', nickname),
      exact: true,
    }),
  ).toBeVisible();
}

// 評価者のハンドルで絞った評価の一覧から、その評価を理由を添えて無効化し、行の状態と操作が替わることを確かめる
export async function invalidateRatingFromList(
  page: Page,
  rater: FixtureUser,
  reason: string,
): Promise<void> {
  const { nickname, handle } = rater;
  await page.goto(ratingsPathOf(handle));
  const row = tableRowOf(page, RATING_LIST_CAPTION, nickname);
  await expect(row).toHaveCount(1);
  const copy = invalidateRatingDialogCopy(nickname);
  const dialog = await openActionDialog(
    page,
    row.getByRole('button', {
      name: ratingActionName('invalidate', nickname),
      exact: true,
    }),
    copy.title,
  );
  await confirmWithReason(
    page,
    dialog,
    copy.confirmLabel,
    reason,
    MODERATION_CHANGED_MESSAGES['rating.invalidate'],
  );
  await expect(row).toContainText(RATING_STATE_LABELS.invalidated);
  await expect(
    row.getByRole('button', {
      name: ratingActionName('revalidate', nickname),
      exact: true,
    }),
  ).toBeVisible();
}
