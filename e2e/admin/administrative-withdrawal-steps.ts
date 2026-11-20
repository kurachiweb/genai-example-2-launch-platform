import { expect, type Locator, type Page } from '@playwright/test';

import {
  AUDIT_LOG_LIST_CAPTION,
  AUDIT_LOGS_TITLE,
  AUDIT_TARGET_KIND_LABELS,
} from '../../apps/admin/src/components/audit/audit-logs-messages.ts';
import {
  MODERATION_CHANGED_MESSAGES,
  MODERATION_PAGE_COPY,
  USER_FILTER_LABELS,
  USER_LIST_CAPTION,
  USER_LIST_EMPTY_MESSAGE,
  userActionName,
  userHandleLabel,
  withdrawUserDialogCopy,
} from '../../apps/admin/src/components/moderation/shared/moderation-messages.ts';
import { MODERATION_AUDIT_ACTION_DEFINITIONS } from '../../apps/common-lib/admin/audit-actions/ugc-moderation.ts';
import {
  APPLY_FILTER_LABEL,
  AUDITED_ACTION_NOTICE,
  REQUIRED_REASON_LABEL,
} from '../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import {
  INVALID_CREDENTIALS_MESSAGE,
  loginForm,
  submitLogin,
  type TestAccount,
  userMenuButton,
} from '../client/auth/account-steps.ts';
import {
  type AdminProfileInput,
  openFromAdminNavigation,
} from '../support/admin-bootstrap.ts';
import { waitForLatestEmail } from '../support/mailpit.ts';

const USERS_PATH = '/users';

const AUDIT_LOGS_PATH = '/audit-logs';

// 代理の退会のメールが無いことは、届くはずのメールの待ちの期限(Queueを経てイベントサーバーが送るまでの長さ)の間、何も届かないことで確かめる
const NO_EMAIL_WINDOW_MS = 20_000;

const WITHDRAW_AUDIT_ACTION =
  MODERATION_AUDIT_ACTION_DEFINITIONS['user.administrative-withdraw'];

// ハイドレーション済みの画面から管理画面のナビゲーションで開き、絞り込みの入力がフォームの状態に入るようにする
export async function openAdminUsers(
  page: Page,
  admin: Pick<AdminProfileInput, 'nickname'>,
): Promise<void> {
  await openFromAdminNavigation(page, admin, USERS_PATH);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: MODERATION_PAGE_COPY.users.title,
      exact: true,
    }),
  ).toBeVisible();
}

// メールアドレスで絞り込み、条件がURLへ届くまで待つ
export async function searchUsersByEmail(
  page: Page,
  email: string,
): Promise<void> {
  const search = page.getByRole('search');
  await search
    .getByLabel(USER_FILTER_LABELS.email, { exact: true })
    .fill(email);
  await search
    .getByRole('button', { name: APPLY_FILTER_LABEL, exact: true })
    .click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === USERS_PATH && url.searchParams.get('email') === email,
  );
}

export const userTable = (page: Page): Locator =>
  page.getByRole('table', { name: USER_LIST_CAPTION });

export const userRowOf = (
  page: Page,
  account: Pick<TestAccount, 'nickname'>,
): Locator =>
  userTable(page).getByRole('row').filter({ hasText: account.nickname });

export const userActionButtonOf = (
  scope: Page | Locator,
  kind: 'suspend' | 'withdraw',
  account: Pick<TestAccount, 'nickname'>,
): Locator =>
  scope.getByRole('button', {
    name: userActionName(kind, account.nickname),
    exact: true,
  });

// 登録の時に決まるハンドルは画面からしか分からないため、一覧の行のハンドルの列から読む
async function handleOf(row: Locator): Promise<string> {
  const label = (await row.locator('[translate="no"]').innerText()).trim();
  const prefix = userHandleLabel('');
  if (!label.startsWith(prefix)) {
    throw new Error(
      `ユーザー一覧の行のハンドルの表記が想定と違います: ${label}`,
    );
  }
  return label.slice(prefix.length);
}

export interface WithdrawalDialog {
  readonly dialog: Locator;
  readonly confirmLabel: string;
}

// 行の「代理の退会」から確認のダイアログを開き、対象のハンドルと利用中の状態、監査ログに記録される旨が示されることを確かめる
export async function openWithdrawalDialog(
  page: Page,
  account: Pick<TestAccount, 'nickname'>,
): Promise<WithdrawalDialog> {
  const row = userRowOf(page, account);
  await expect(row).toHaveCount(1);
  const copy = withdrawUserDialogCopy({
    nickname: account.nickname,
    handle: await handleOf(row),
    suspended: false,
  });
  await userActionButtonOf(row, 'withdraw', account).click();
  const dialog = page.getByRole('dialog', { name: copy.title, exact: true });
  await expect(dialog).toContainText(copy.description);
  await expect(dialog).toContainText(AUDITED_ACTION_NOTICE);
  return { dialog, confirmLabel: copy.confirmLabel };
}

// 理由を入れて確定し、ダイアログが閉じて完了のトーストが出ることを確かめる
export async function confirmWithdrawal(
  page: Page,
  { dialog, confirmLabel }: WithdrawalDialog,
  reason: string,
): Promise<void> {
  await dialog.getByLabel(REQUIRED_REASON_LABEL, { exact: true }).fill(reason);
  await dialog.getByRole('button', { name: confirmLabel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText(
      MODERATION_CHANGED_MESSAGES['user.administrative-withdraw'],
      { exact: true },
    ),
  ).toBeVisible();
}

// 一覧が空になると表の代わりに空の旨の文言が一覧の区画に出る
export async function expectNoUserRows(page: Page): Promise<void> {
  const list = page
    .getByRole('main')
    .getByRole('region', { name: USER_LIST_CAPTION, exact: true });
  await expect(list).toContainText(USER_LIST_EMPTY_MESSAGE);
  await expect(userTable(page)).toHaveCount(0);
}

// 退会済みの利用者は未登録のメールアドレスと同じ文言で拒否される
export async function expectLoginRejected(
  clientPage: Page,
  account: TestAccount,
): Promise<void> {
  await clientPage.goto('/auth/login');
  await submitLogin(clientPage, account.email, account.password);
  await expect(
    loginForm(clientPage)
      .getByRole('alert')
      .filter({ hasText: INVALID_CREDENTIALS_MESSAGE }),
  ).toBeVisible();
  await expect(userMenuButton(clientPage, account)).toHaveCount(0);
}

// 監査ログの一覧で、この管理者が行った代理の退会の記録の行を返す。対象の種類はユーザー
export async function withdrawalAuditLogRows(
  page: Page,
  admin: Pick<AdminProfileInput, 'nickname'>,
): Promise<Locator> {
  await openFromAdminNavigation(page, admin, AUDIT_LOGS_PATH);
  await expect(
    page.getByRole('heading', { level: 1, name: AUDIT_LOGS_TITLE }),
  ).toBeVisible();
  return page
    .getByRole('table', { name: AUDIT_LOG_LIST_CAPTION })
    .getByRole('row')
    .filter({ hasText: WITHDRAW_AUDIT_ACTION.label })
    .filter({ hasText: admin.nickname })
    .filter({ hasText: AUDIT_TARGET_KIND_LABELS.user });
}

// 退会の確定の時刻から待ちの期限が過ぎるまで、その宛先へ新しいメールが1通も届かないことを確かめる
export async function expectNoEmailSince(
  to: string,
  since: Date,
): Promise<void> {
  const remainingMs = Math.max(
    since.getTime() + NO_EMAIL_WINDOW_MS - Date.now(),
    0,
  );
  await expect(
    waitForLatestEmail(
      { to, receivedAfter: since },
      { timeoutMs: remainingMs },
    ),
  ).rejects.toThrow(`${to}へのメールが`);
}
