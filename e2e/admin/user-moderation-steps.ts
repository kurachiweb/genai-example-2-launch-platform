import { expect, type Locator, type Page } from '@playwright/test';

import {
  AUDIT_LOG_LIST_CAPTION,
  AUDIT_LOGS_TITLE,
  TARGET_FILTER_LABEL,
} from '../../apps/admin/src/components/audit/audit-logs-messages.ts';
import {
  MODERATION_CHANGED_MESSAGES,
  type ModerationDialogCopy,
  MODERATION_PAGE_COPY,
  MODERATION_REASON_LABEL,
  suspendUserDialogCopy,
  unsuspendUserDialogCopy,
  USER_FILTER_LABELS,
  USER_LIST_CAPTION,
  USER_STATUS_LABELS,
  userActionName,
  userHandleLabel,
} from '../../apps/admin/src/components/moderation/shared/moderation-messages.ts';
import type { ModerationOperation } from '../../apps/admin/src/components/moderation/shared/moderation-operations.ts';
import { MODERATION_AUDIT_ACTION_DEFINITIONS } from '../../apps/common-lib/admin/audit-actions/ugc-moderation.ts';
import type { ModerationAction } from '../../apps/common-lib/moderation/moderation-actions.ts';
import {
  APPLY_FILTER_LABEL,
  REQUIRED_REASON_LABEL,
} from '../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import {
  directoryItemOf,
  directoryPeriodPath,
  openDirectory,
} from '../client/directory-steps.ts';
import {
  type AdminProfileInput,
  openFromAdminNavigation,
} from '../support/admin-bootstrap.ts';
import {
  type MailpitMessage,
  waitForEmailWithSubject,
} from '../support/mailpit.ts';

const USERS_PATH = '/users';

const AUDIT_LOGS_PATH = '/audit-logs';

// 措置の通知は確定の後に依頼のQueueを経てイベントサーバーが送る
const MODERATION_NOTICE_TIMEOUT_MS = 60_000;

// 件名はイベントサーバーのメールのテンプレート(ugc-moderation/user-suspended-template.ts)が決める
const USER_SUSPENDED_SUBJECT = 'アカウントが停止されました';

type UserStatusOperation = Extract<
  ModerationOperation,
  'user.suspend' | 'user.unsuspend'
>;

const USER_STATUS_ACTIONS = Object.freeze({
  'user.suspend': Object.freeze({
    kind: 'suspend',
    copyOf: suspendUserDialogCopy,
  }),
  'user.unsuspend': Object.freeze({
    kind: 'unsuspend',
    copyOf: unsuspendUserDialogCopy,
  }),
} as const);

// 補助の掲載中のプロダクトは索引文書を持たず検索に現れないため、掲載の実施日の期間で開いたディレクトリで確かめる。同じ実施日はプロダクトのIDの降順で、補助が直前に作った項目は1ページ目に並ぶ
export async function expectListedInDirectory(
  page: Page,
  productName: string,
  matchDate: string,
): Promise<void> {
  await openDirectory(
    page,
    directoryPeriodPath({ from: matchDate, to: matchDate }),
  );
  await expect(directoryItemOf(page, productName)).toBeVisible();
}

export async function expectNotListedInDirectory(
  page: Page,
  productName: string,
  matchDate: string,
): Promise<void> {
  await openDirectory(
    page,
    directoryPeriodPath({ from: matchDate, to: matchDate }),
  );
  await expect(directoryItemOf(page, productName)).toHaveCount(0);
}

export const userRowOf = (page: Page, handle: string): Locator =>
  page
    .getByRole('table', { name: USER_LIST_CAPTION, exact: true })
    .getByRole('row')
    .filter({ hasText: userHandleLabel(handle) });

// 管理メニューから開くとハイドレーションの後のため、絞り込みの適用はルーターの遷移になる
export async function searchUserByHandle(
  page: Page,
  admin: Pick<AdminProfileInput, 'nickname'>,
  handle: string,
): Promise<Locator> {
  await openFromAdminNavigation(page, admin, USERS_PATH);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: MODERATION_PAGE_COPY.users.title,
    }),
  ).toBeVisible();
  await page
    .getByLabel(USER_FILTER_LABELS.handle, { exact: true })
    .fill(handle);
  await page.getByRole('button', { name: APPLY_FILTER_LABEL }).click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get('handle') === handle,
  );
  const row = userRowOf(page, handle);
  await expect(row).toHaveCount(1);
  return row;
}

// 確認のダイアログで必須の理由を入力して確定し、変わった旨の知らせとダイアログが閉じるのを待つ
export async function confirmModeration(
  page: Page,
  opener: Locator,
  operation: ModerationOperation,
  copy: ModerationDialogCopy,
  reason: string,
): Promise<void> {
  await opener.click();
  const dialog = page.getByRole('dialog', { name: copy.title, exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(REQUIRED_REASON_LABEL, { exact: true }).fill(reason);
  await dialog
    .getByRole('button', { name: copy.confirmLabel, exact: true })
    .click();
  await expect(
    page.getByText(MODERATION_CHANGED_MESSAGES[operation], { exact: true }),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
}

export async function moderateUser(
  page: Page,
  row: Locator,
  operation: UserStatusOperation,
  nickname: string,
  reason: string,
): Promise<void> {
  const { kind, copyOf } = USER_STATUS_ACTIONS[operation];
  await confirmModeration(
    page,
    row.getByRole('button', {
      name: userActionName(kind, nickname),
      exact: true,
    }),
    operation,
    copyOf(nickname),
    reason,
  );
}

export async function expectSuspendedUser(
  row: Locator,
  reason: string,
): Promise<void> {
  await expect(
    row.getByText(USER_STATUS_LABELS.suspended, { exact: true }),
  ).toBeVisible();
  await expect(
    row
      .getByRole('term')
      .filter({ hasText: MODERATION_REASON_LABEL })
      .locator('xpath=following-sibling::dd[1]'),
  ).toHaveText(reason);
}

export async function expectActiveUser(row: Locator): Promise<void> {
  await expect(
    row.getByText(USER_STATUS_LABELS.active, { exact: true }),
  ).toBeVisible();
}

// 停止の通知が投稿者へ届き、本文に入力した理由があることを確かめる
export async function expectSuspensionNotice(
  email: string,
  reason: string,
  receivedAfter: Date,
): Promise<MailpitMessage> {
  const mail = await waitForEmailWithSubject(
    { to: email, subject: USER_SUSPENDED_SUBJECT, receivedAfter },
    { timeoutMs: MODERATION_NOTICE_TIMEOUT_MS },
  );
  expect(mail.text).toContain(reason);
  return mail;
}

// 監査ログの画面を対象の識別子で絞り込み、操作者・操作種別・対象の揃った行を返す
export async function moderationAuditLogRows(
  page: Page,
  admin: Pick<AdminProfileInput, 'nickname'>,
  action: ModerationAction,
  targetId: string,
): Promise<Locator> {
  return auditLogRowsOf(
    page,
    admin,
    MODERATION_AUDIT_ACTION_DEFINITIONS[action].label,
    targetId,
  );
}

// 監査ログの画面を対象の識別子で絞り込み、操作者・操作種別の表示名・対象の揃った行を返す
export async function auditLogRowsOf(
  page: Page,
  admin: Pick<AdminProfileInput, 'nickname'>,
  actionLabel: string,
  targetId: string,
): Promise<Locator> {
  await openFromAdminNavigation(page, admin, AUDIT_LOGS_PATH);
  await expect(
    page.getByRole('heading', { level: 1, name: AUDIT_LOGS_TITLE }),
  ).toBeVisible();
  await page.getByLabel(TARGET_FILTER_LABEL, { exact: true }).fill(targetId);
  await page.getByRole('button', { name: APPLY_FILTER_LABEL }).click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get('target') === targetId,
  );
  return page
    .getByRole('table', { name: AUDIT_LOG_LIST_CAPTION })
    .getByRole('row')
    .filter({ hasText: actionLabel })
    .filter({ hasText: admin.nickname })
    .filter({ hasText: targetId });
}
