import type { Locator, Page } from '@playwright/test';

import {
  currentEmailText,
  CURRENT_PASSWORD_LABEL,
  EMAIL_CHANGE_REQUESTED_MESSAGE,
  EMAIL_CHANGE_SECTION_TITLE,
  EMAIL_CHANGE_SUBMIT_LABEL,
  NEW_EMAIL_LABEL,
  PASSWORD_CHANGE_SECTION_TITLE,
  PASSWORD_CHANGE_SUBMIT_LABEL,
  PASSWORD_CHANGED_MESSAGE,
  PROFILE_SECTION_TITLE,
  remainingRecoveryCodesMessage,
  TOTP_RESET_COMPLETED_MESSAGE,
  TOTP_RESET_LABEL,
  TOTP_RESET_START_LABEL,
  TOTP_RESET_SUBMIT_LABEL,
} from '../../apps/admin/src/components/account/account-messages.ts';
import {
  ADMIN_TITLE_LABEL,
  AVATAR_REMOVE_LABEL,
  AVATAR_REMOVED_NOTICE,
  NICKNAME_LABEL,
  PROFILE_SAVED_MESSAGE,
  PROFILE_SUBMIT_LABEL,
} from '../../apps/admin/src/components/admins/admin-accounts-messages.ts';
import {
  EMAIL_CHANGE_ACTION_LABEL,
  EMAIL_CHANGED_MESSAGE,
  EMAIL_LABEL,
  NEW_PASSWORD_LABEL,
  PASSWORD_RESET_CONFIRM_PAGE_TITLE,
  PASSWORD_RESET_DONE_MESSAGE,
  PASSWORD_RESET_LINK_SENT_MESSAGE,
  PASSWORD_RESET_PAGE_TITLE,
  PASSWORD_RESET_REQUEST_SUBMIT_LABEL,
  PASSWORD_RESET_SUBMIT_LABEL,
  REQUIRED_SUFFIX,
  TOTP_CODE_LABEL,
} from '../../apps/admin/src/components/auth/admin-auth-messages.ts';
import {
  accountMenuButton,
  ADMIN_FLOW_TIMEOUT_MS,
  type BootstrappedAdmin,
  createAdminEmail,
  createAdminProfile,
  ISSUED_RECOVERY_CODE_COUNT,
  loginForm,
  nextTotpCode,
  openFromAdminNavigation,
  recoveryCodeItems,
  signInAdmin,
  signInAsNewAdmin,
  signOutAdmin,
  withTotpSecret,
} from '../support/admin-bootstrap.ts';
import { waitForBotToken } from '../support/bot-verification.ts';
import { assumeDistinctClientIp } from '../support/client-ip.ts';
import { uploadCroppedImage } from '../support/image-upload.ts';
import { waitForEmailLink } from '../support/mailpit.ts';
import { expect, test } from './admin-test.ts';

test.describe.configure({ timeout: ADMIN_FLOW_TIMEOUT_MS });

const ACCOUNT_PATH = '/account';

const HOME_PATH = '/';

const PASSWORD_RESET_PATH = '/auth/password-reset';

const PASSWORD_RESET_CONFIRM_PATH = '/auth/password-reset/confirm';

const EMAIL_CHANGE_CONFIRM_PATH = '/auth/email-change/confirm';

const AVATAR_FILE_NAME = 'e2e-avatar.png';

const DEFAULT_ICON_SELECTOR = '[data-slot="media-placeholder"]';

const sectionForm = (page: Page, name: string): Locator =>
  page.getByRole('form', { name });

const requiredField = (form: Locator, label: string): Locator =>
  form.getByLabel(`${label}${REQUIRED_SUFFIX}`, { exact: true });

// 開いたページを読み込み直した直後はハイドレーションの前で、フォームの入力が状態に入らないため、トップページから管理メニューで開き直す
async function reopenAccountPage(
  page: Page,
  admin: Pick<BootstrappedAdmin, 'nickname'>,
): Promise<void> {
  await page.goto(HOME_PATH);
  await openFromAdminNavigation(page, admin, ACCOUNT_PATH);
}

async function fillReauthentication(
  form: Locator,
  admin: BootstrappedAdmin,
): Promise<void> {
  await requiredField(form, CURRENT_PASSWORD_LABEL).fill(admin.password);
  await requiredField(form, TOTP_CODE_LABEL).fill(await nextTotpCode(admin));
}

test.describe('自分のアカウント', () => {
  test('プロフィールのニックネーム・肩書き・画像を保存でき、画像を取り除くと既定のアイコンになる', async ({
    page,
  }) => {
    const admin = await signInAsNewAdmin(page, { role: 'viewer' });
    await openFromAdminNavigation(page, admin, ACCOUNT_PATH);
    const { nickname } = createAdminProfile();
    const title = `E2E肩書き${nickname.slice(-6)}`;

    const form = sectionForm(page, PROFILE_SECTION_TITLE);
    await form.getByLabel(NICKNAME_LABEL, { exact: true }).fill(nickname);
    await form.getByLabel(ADMIN_TITLE_LABEL, { exact: true }).fill(title);
    await uploadCroppedImage(page, form, { fileName: AVATAR_FILE_NAME });
    await form.getByRole('button', { name: PROFILE_SUBMIT_LABEL }).click();
    await expect(page.getByText(PROFILE_SAVED_MESSAGE)).toBeVisible();
    const renamed = { ...admin, nickname };
    await expect(accountMenuButton(page, renamed)).toBeVisible();

    await reopenAccountPage(page, renamed);
    const savedForm = sectionForm(page, PROFILE_SECTION_TITLE);
    await expect(
      savedForm.getByLabel(NICKNAME_LABEL, { exact: true }),
    ).toHaveValue(nickname);
    await expect(
      savedForm.getByLabel(ADMIN_TITLE_LABEL, { exact: true }),
    ).toHaveValue(title);
    await savedForm.getByRole('button', { name: AVATAR_REMOVE_LABEL }).click();
    await expect(savedForm.getByText(AVATAR_REMOVED_NOTICE)).toBeVisible();
    await savedForm.getByRole('button', { name: PROFILE_SUBMIT_LABEL }).click();
    await expect(page.getByText(PROFILE_SAVED_MESSAGE)).toBeVisible();
    await expect(
      accountMenuButton(page, renamed).locator(DEFAULT_ICON_SELECTOR),
    ).toBeVisible();

    await reopenAccountPage(page, renamed);
    await expect(
      sectionForm(page, PROFILE_SECTION_TITLE).getByText(AVATAR_REMOVED_NOTICE),
    ).toBeVisible();
  });

  test('パスワードの再設定のリンクから再設定すると既存のセッションが無効になり、新しいパスワードでログインできる', async ({
    browser,
    baseURL,
    page,
  }) => {
    const admin = await signInAsNewAdmin(page, { role: 'viewer' });
    const resetContext = await browser.newContext({ baseURL });
    try {
      await assumeDistinctClientIp(resetContext, baseURL);
      const resetPage = await resetContext.newPage();
      await resetPage.goto(PASSWORD_RESET_PATH);
      const requestForm = sectionForm(resetPage, PASSWORD_RESET_PAGE_TITLE);
      await waitForBotToken(requestForm);
      await requiredField(requestForm, EMAIL_LABEL).fill(admin.email);
      await requestForm
        .getByRole('button', { name: PASSWORD_RESET_REQUEST_SUBMIT_LABEL })
        .click();
      await expect(
        resetPage.getByText(PASSWORD_RESET_LINK_SENT_MESSAGE),
      ).toBeVisible();

      const link = await waitForEmailLink({
        to: admin.email,
        linkPath: PASSWORD_RESET_CONFIRM_PATH,
      });
      await resetPage.goto(link);
      const resetForm = sectionForm(
        resetPage,
        PASSWORD_RESET_CONFIRM_PAGE_TITLE,
      );
      const { password } = createAdminProfile();
      await requiredField(resetForm, NEW_PASSWORD_LABEL).fill(password);
      await resetForm
        .getByRole('button', { name: PASSWORD_RESET_SUBMIT_LABEL })
        .click();
      await expect(
        resetPage.getByText(PASSWORD_RESET_DONE_MESSAGE),
      ).toBeVisible();

      await page.reload();
      await expect(loginForm(page)).toBeVisible();
      await expect(accountMenuButton(page, admin)).toHaveCount(0);

      await signInAdmin(resetPage, { ...admin, password });
    } finally {
      await resetContext.close();
    }
  });

  test('新しいメールアドレスに届いたリンクで変更を確定すると、新しいメールアドレスでログインできる', async ({
    page,
  }) => {
    const admin = await signInAsNewAdmin(page, { role: 'moderator' });
    await openFromAdminNavigation(page, admin, ACCOUNT_PATH);
    const newEmail = createAdminEmail();

    const form = sectionForm(page, EMAIL_CHANGE_SECTION_TITLE);
    await requiredField(form, NEW_EMAIL_LABEL).fill(newEmail);
    await fillReauthentication(form, admin);
    await form.getByRole('button', { name: EMAIL_CHANGE_SUBMIT_LABEL }).click();
    await expect(page.getByText(EMAIL_CHANGE_REQUESTED_MESSAGE)).toBeVisible();

    const link = await waitForEmailLink({
      to: newEmail,
      linkPath: EMAIL_CHANGE_CONFIRM_PATH,
    });
    await page.goto(link);
    await page.getByRole('button', { name: EMAIL_CHANGE_ACTION_LABEL }).click();
    await expect(page.getByText(EMAIL_CHANGED_MESSAGE)).toBeVisible();
    await expect(accountMenuButton(page, admin)).toBeVisible();

    await reopenAccountPage(page, admin);
    await expect(page.getByText(currentEmailText(newEmail))).toBeVisible();

    await signOutAdmin(page, admin);
    await signInAdmin(page, { ...admin, email: newEmail });
  });

  test('パスワードを変更すると、新しいパスワードでログインできる', async ({
    page,
  }) => {
    const admin = await signInAsNewAdmin(page, { role: 'super_admin' });
    await openFromAdminNavigation(page, admin, ACCOUNT_PATH);
    const { password } = createAdminProfile();

    const form = sectionForm(page, PASSWORD_CHANGE_SECTION_TITLE);
    await requiredField(form, NEW_PASSWORD_LABEL).fill(password);
    await fillReauthentication(form, admin);
    await form
      .getByRole('button', { name: PASSWORD_CHANGE_SUBMIT_LABEL })
      .click();
    await expect(page.getByText(PASSWORD_CHANGED_MESSAGE)).toBeVisible();
    await expect(accountMenuButton(page, admin)).toBeVisible();

    await signOutAdmin(page, admin);
    await signInAdmin(page, { ...admin, password });
  });

  test('多要素認証を設定し直すと新しいリカバリコードが表示され、新しい認証アプリの認証コードでログインできる', async ({
    page,
  }) => {
    const admin = await signInAsNewAdmin(page, { role: 'viewer' });
    await openFromAdminNavigation(page, admin, ACCOUNT_PATH);

    const startForm = sectionForm(page, TOTP_RESET_LABEL);
    await fillReauthentication(startForm, admin);
    await startForm
      .getByRole('button', { name: TOTP_RESET_START_LABEL })
      .click();

    const dialog = page.getByRole('dialog', { name: TOTP_RESET_LABEL });
    const reset = withTotpSecret(
      admin,
      await dialog.locator('code').innerText(),
    );
    await requiredField(dialog, TOTP_CODE_LABEL).fill(
      await nextTotpCode(reset),
    );
    await dialog.getByRole('button', { name: TOTP_RESET_SUBMIT_LABEL }).click();
    await expect(dialog.getByText(TOTP_RESET_COMPLETED_MESSAGE)).toBeVisible();
    await expect(recoveryCodeItems(dialog)).toHaveCount(
      ISSUED_RECOVERY_CODE_COUNT,
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByText(remainingRecoveryCodesMessage(ISSUED_RECOVERY_CODE_COUNT)),
    ).toBeVisible();

    await signOutAdmin(page, reset);
    await signInAdmin(page, reset);
  });
});
