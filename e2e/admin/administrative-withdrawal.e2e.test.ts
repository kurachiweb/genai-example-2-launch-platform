import {
  ADMIN_FLOW_TIMEOUT_MS,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import { waitForEmailLink } from '../support/mailpit.ts';
import {
  createTestAccount,
  MAIL_FLOW_TIMEOUT_MS,
  registerAccount,
  VERIFY_EMAIL_PATH,
} from '../client/auth/account-steps.ts';
import {
  confirmWithdrawal,
  expectLoginRejected,
  expectNoEmailSince,
  expectNoUserRows,
  openAdminUsers,
  openWithdrawalDialog,
  searchUsersByEmail,
  userActionButtonOf,
  userRowOf,
  withdrawalAuditLogRows,
} from './administrative-withdrawal-steps.ts';
import { expect, test } from './client-page-test.ts';

// 管理者の用意に加え、利用者の登録と確認のメールの待ち、退会の後にメールが届かないことの待ちを1つの流れで行う
test.describe.configure({
  timeout: ADMIN_FLOW_TIMEOUT_MS + MAIL_FLOW_TIMEOUT_MS,
});

// 監査ログに残る理由。個人情報を含めない
const WITHDRAWAL_REASON = 'E2Eの問い合わせによる代理の退会の確認';

test.describe('代理の退会(管理者側)', () => {
  test('最上位管理者がユーザー一覧でメールアドレスで検索した利用者を、理由を入れて代理の退会にすると、一覧から消え、その利用者はログインできず、監査ログに理由つきの記録が出て、利用者へメールが送られない', async ({
    page,
    clientPage,
    openClientPage,
  }) => {
    const account = createTestAccount();
    await registerAccount(clientPage, account);
    // 登録の確認のメールが退会の後に届いて、退会の後のメールと区別できなくならないよう、先に届くのを待つ
    await waitForEmailLink({ to: account.email, linkPath: VERIFY_EMAIL_PATH });

    const admin = await signInAsNewAdmin(page, { role: 'super_admin' });
    await openAdminUsers(page, admin);
    await searchUsersByEmail(page, account.email);
    const dialog = await openWithdrawalDialog(page, account);
    const withdrawnAt = new Date();
    await confirmWithdrawal(page, dialog, WITHDRAWAL_REASON);

    await expect(userRowOf(page, account)).toHaveCount(0);
    await expectNoUserRows(page);

    await expectLoginRejected(await openClientPage(), account);

    const logRows = await withdrawalAuditLogRows(page, admin);
    await expect(logRows).toHaveCount(1);
    await expect(logRows).toContainText(WITHDRAWAL_REASON);

    await expectNoEmailSince(account.email, withdrawnAt);
  });

  test('モデレーターのユーザー一覧では、検索した利用者の行に停止の操作が出ても、代理の退会の操作は出ない', async ({
    page,
    clientPage,
  }) => {
    const account = createTestAccount();
    await registerAccount(clientPage, account);

    const admin = await signInAsNewAdmin(page, { role: 'moderator' });
    await openAdminUsers(page, admin);
    await searchUsersByEmail(page, account.email);

    const row = userRowOf(page, account);
    await expect(row).toHaveCount(1);
    await expect(userActionButtonOf(row, 'suspend', account)).toBeVisible();
    await expect(userActionButtonOf(row, 'withdraw', account)).toHaveCount(0);
  });
});
