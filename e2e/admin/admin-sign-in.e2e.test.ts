import { ADMIN_ACCOUNTS_TITLE } from '../../apps/admin/src/components/admins/admin-accounts-messages.ts';
import { remainingRecoveryCodesMessage } from '../../apps/admin/src/components/account/account-messages.ts';
import {
  LOGIN_SUBMIT_LABEL,
  REQUIRED_SUFFIX,
  TOTP_CODE_LABEL,
} from '../../apps/admin/src/components/auth/admin-auth-messages.ts';
import { DASHBOARD_EMPTY_TITLE } from '../../apps/admin/src/components/dashboard/dashboard-messages.ts';
import {
  accountMenuButton,
  ADMIN_FLOW_TIMEOUT_MS,
  type BootstrappedAdmin,
  completeAdminInvitation,
  createAdminEmail,
  expectAdminRole,
  findAdminIdByEmail,
  ISSUED_RECOVERY_CODE_COUNT,
  issueSuperAdminInvitation,
  loginForm,
  nextTotpCode,
  openFromAdminNavigation,
  secondFactorForm,
  signInAdmin,
  signInAdminWithRecoveryCode,
  signInAsNewAdmin,
  signOutAdmin,
  submitAdminCredentials,
} from '../support/admin-bootstrap.ts';
import { expect, test } from './admin-test.ts';

test.describe.configure({ timeout: ADMIN_FLOW_TIMEOUT_MS });

// APIサーバーの認証のエラーの定義(AUTH_ERRORSのinvalid_credentials)の文言。定義のファイルはWorkersの型を前提とする部品を読み込み、ルートの型検査に含められないため写して持つ
const INVALID_CREDENTIALS_MESSAGE =
  'メールアドレスまたはパスワードが正しくありません。';

const ACCOUNTS_PATH = '/accounts';

const LOGIN_PATH = '/auth/login';

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

// 発行の時刻と画面の時計のずれ、コマンドの実行時間を許す幅
const EXPIRY_TOLERANCE_MS = 10 * 60 * 1000;

test.describe('最初の最上位管理者とログイン', () => {
  test('招待の発行コマンドのリンクから招待を完了するとダッシュボードが空の状態で表示され、ログアウトの後は認証コードとリカバリコードでログインできる', async ({
    page,
  }) => {
    const email = createAdminEmail();
    const issued = await issueSuperAdminInvitation(email);
    const expiresInMs = Date.parse(issued.expiresAt) - Date.now();
    expect(Math.abs(expiresInMs - INVITATION_TTL_MS)).toBeLessThan(
      EXPIRY_TOLERANCE_MS,
    );

    const completed = await completeAdminInvitation(page, issued.link);
    const admin: BootstrappedAdmin = {
      ...completed,
      adminId: await findAdminIdByEmail(email),
      email,
      role: 'super_admin',
    };
    await expect(page.getByText(DASHBOARD_EMPTY_TITLE)).toBeVisible();
    await expectAdminRole(page, admin);

    await signOutAdmin(page, admin);
    await page.goto(LOGIN_PATH);
    await submitAdminCredentials(page, admin.email, `${admin.password}x`);
    await expect(
      loginForm(page).getByText(INVALID_CREDENTIALS_MESSAGE),
    ).toBeVisible();
    await expect(secondFactorForm(page)).toHaveCount(0);

    await signInAdmin(page, admin);
    await signOutAdmin(page, admin);
    await signInAdminWithRecoveryCode(
      page,
      admin,
      admin.recoveryCodes[0] ?? '',
    );

    await openFromAdminNavigation(page, admin, '/account');
    await expect(
      page.getByText(
        remainingRecoveryCodesMessage(ISSUED_RECOVERY_CODE_COUNT - 1),
      ),
    ).toBeVisible();
  });

  test('ログインしていない時にログイン必須のページを開くとログイン画面へ移り、ログインすると開こうとしたページへ戻る', async ({
    page,
  }) => {
    const admin = await signInAsNewAdmin(page, { role: 'viewer' });
    await signOutAdmin(page, admin);

    await page.goto(ACCOUNTS_PATH);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === LOGIN_PATH &&
        url.searchParams.get('redirect') === ACCOUNTS_PATH,
    );
    await submitAdminCredentials(page, admin.email, admin.password);
    const form = secondFactorForm(page);
    await form
      .getByLabel(`${TOTP_CODE_LABEL}${REQUIRED_SUFFIX}`, { exact: true })
      .fill(await nextTotpCode(admin));
    await form.getByRole('button', { name: LOGIN_SUBMIT_LABEL }).click();

    await expect(page).toHaveURL(ACCOUNTS_PATH);
    await expect(
      page.getByRole('heading', { level: 1, name: ADMIN_ACCOUNTS_TITLE }),
    ).toBeVisible();
    await expect(accountMenuButton(page, admin)).toBeVisible();
  });
});
