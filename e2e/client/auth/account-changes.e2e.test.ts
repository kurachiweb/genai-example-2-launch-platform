import type { Page } from '@playwright/test';

import {
  EMAIL_CHANGE_ACTION_LABEL,
  EMAIL_CHANGE_PAGE_TITLE,
  EMAIL_CHANGED_MESSAGE,
  LOGIN_LABEL,
  LOGIN_WITH_NEW_EMAIL_MESSAGE,
  NEW_PASSWORD_LABEL,
  PASSWORD_CHANGE_ACTION_LABEL,
  PASSWORD_CHANGE_PAGE_TITLE,
  PASSWORD_CHANGED_MESSAGE,
  REQUIRED_SUFFIX,
} from '../../../apps/client/src/components/auth/account-messages.ts';
import {
  EMAIL_CHANGE_REQUESTED_MESSAGE,
  EMAIL_CHANGE_SUBMIT_LABEL,
  NEW_EMAIL_LABEL,
  PASSWORD_CHANGE_REQUESTED_MESSAGE,
  PASSWORD_CHANGE_SUBMIT_LABEL,
  WITHDRAWAL_ACTION_LABEL,
  WITHDRAWAL_CONFIRM_TITLE,
  WITHDRAWAL_SECTION_TITLE,
  WITHDRAWN_MESSAGE,
} from '../../../apps/client/src/components/settings/settings-messages.ts';
import {
  createTestAccount,
  currentPasswordField,
  INVALID_CREDENTIALS_MESSAGE,
  loginAs,
  loginForm,
  logoutFromUserMenu,
  MAIL_FLOW_TIMEOUT_MS,
  openAccountSettings,
  registerAccount,
  submitLogin,
  type TestAccount,
  userMenuButton,
  verifyEmailBanner,
  waitForBotToken,
} from './account-steps.ts';
import {
  waitForEmailLink,
  waitForEmailWithSubject,
} from '../../support/mailpit.ts';
import { expect, test } from './auth-test.ts';

test.describe.configure({ timeout: MAIL_FLOW_TIMEOUT_MS });

const EMAIL_CHANGE_CONFIRM_PATH = '/auth/email-change/confirm';

const PASSWORD_CHANGE_CONFIRM_PATH = '/auth/password-change/confirm';

const EMAIL_CHANGED_SUBJECT = 'メールアドレスが変更されました';

const PASSWORD_CHANGED_SUBJECT = 'パスワードが変更されました';

async function expectLoginRejected(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/auth/login');
  await submitLogin(page, email, password);
  await expect(
    loginForm(page)
      .getByRole('alert')
      .filter({ hasText: INVALID_CREDENTIALS_MESSAGE }),
  ).toBeVisible();
}

// メールのリンクの画面は、ボタンを押した時だけ変更を確定する
async function confirmFromEmailLink(
  page: Page,
  link: string,
  actionLabel: string,
): Promise<void> {
  await page.goto(link);
  await page.getByRole('button', { name: actionLabel }).click();
}

test.describe('メールアドレスとパスワードの変更', () => {
  test('新しいメールアドレスへのリンクで変更を確定すると、確定した端末はログインしたままで、新しいメールアドレスでだけログインできる', async ({
    page,
  }) => {
    const account = createTestAccount();
    const { email: newEmail } = createTestAccount();
    await registerAccount(page, account);
    await openAccountSettings(page, account);

    const form = page.getByRole('form', { name: EMAIL_CHANGE_PAGE_TITLE });
    await waitForBotToken(form);
    await form
      .getByLabel(`${NEW_EMAIL_LABEL}${REQUIRED_SUFFIX}`, { exact: true })
      .fill(newEmail);
    await currentPasswordField(form).fill(account.password);
    await form.getByRole('button', { name: EMAIL_CHANGE_SUBMIT_LABEL }).click();
    await expect(page.getByText(EMAIL_CHANGE_REQUESTED_MESSAGE)).toBeVisible();

    const link = await waitForEmailLink({
      to: newEmail,
      linkPath: EMAIL_CHANGE_CONFIRM_PATH,
    });
    await confirmFromEmailLink(page, link, EMAIL_CHANGE_ACTION_LABEL);

    await expect(page.getByText(EMAIL_CHANGED_MESSAGE)).toBeVisible();
    await expect(page.getByText(LOGIN_WITH_NEW_EMAIL_MESSAGE)).toHaveCount(0);
    await waitForEmailWithSubject({
      to: account.email,
      subject: EMAIL_CHANGED_SUBJECT,
    });
    await page.reload();
    await expect(userMenuButton(page, account)).toBeVisible();
    await expect(verifyEmailBanner(page)).toHaveCount(0);

    await logoutFromUserMenu(page, account);
    await expectLoginRejected(page, account.email, account.password);
    await loginAs(page, { ...account, email: newEmail });
  });

  test('現在のメールアドレスへのリンクで変更を確定すると、新しいパスワードでだけログインできる', async ({
    page,
  }) => {
    const account = createTestAccount();
    const { password: newPassword } = createTestAccount();
    await registerAccount(page, account);
    await openAccountSettings(page, account);

    const form = page.getByRole('form', { name: PASSWORD_CHANGE_PAGE_TITLE });
    await waitForBotToken(form);
    await form
      .getByLabel(`${NEW_PASSWORD_LABEL}${REQUIRED_SUFFIX}`, { exact: true })
      .fill(newPassword);
    await currentPasswordField(form).fill(account.password);
    await form
      .getByRole('button', { name: PASSWORD_CHANGE_SUBMIT_LABEL })
      .click();
    await expect(
      page.getByText(PASSWORD_CHANGE_REQUESTED_MESSAGE),
    ).toBeVisible();

    const link = await waitForEmailLink({
      to: account.email,
      linkPath: PASSWORD_CHANGE_CONFIRM_PATH,
    });
    await confirmFromEmailLink(page, link, PASSWORD_CHANGE_ACTION_LABEL);

    await expect(page.getByText(PASSWORD_CHANGED_MESSAGE)).toBeVisible();
    await waitForEmailWithSubject({
      to: account.email,
      subject: PASSWORD_CHANGED_SUBJECT,
    });
    await page.reload();
    await expect(userMenuButton(page, account)).toBeVisible();

    await logoutFromUserMenu(page, account);
    await expectLoginRejected(page, account.email, account.password);
    await loginAs(page, { ...account, password: newPassword });
  });
});

test.describe('退会', () => {
  async function withdraw(page: Page, account: TestAccount): Promise<void> {
    await openAccountSettings(page, account);
    await page
      .getByRole('region', { name: WITHDRAWAL_SECTION_TITLE })
      .getByRole('button', { name: WITHDRAWAL_ACTION_LABEL })
      .click();
    const dialog = page.getByRole('dialog', { name: WITHDRAWAL_CONFIRM_TITLE });
    const form = dialog.getByRole('form', { name: WITHDRAWAL_SECTION_TITLE });
    await waitForBotToken(form);
    await currentPasswordField(form).fill(account.password);
    await form.getByRole('button', { name: WITHDRAWAL_ACTION_LABEL }).click();
  }

  test('退会するとログアウトし、同じメールアドレスとパスワードではログインできず、同じメールアドレスで登録し直せる', async ({
    page,
  }) => {
    const account = createTestAccount();
    await registerAccount(page, account);

    await withdraw(page, account);

    await expect(page.getByText(WITHDRAWN_MESSAGE)).toBeVisible();
    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('banner').getByRole('link', { name: LOGIN_LABEL }),
    ).toBeVisible();
    await expect(userMenuButton(page, account)).toHaveCount(0);

    await expectLoginRejected(page, account.email, account.password);

    const reRegistered = { ...createTestAccount(), email: account.email };
    await registerAccount(page, reRegistered);
    await expect(verifyEmailBanner(page)).toBeVisible();
  });
});
