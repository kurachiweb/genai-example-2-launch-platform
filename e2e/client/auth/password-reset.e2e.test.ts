import type { Locator, Page } from '@playwright/test';

import {
  EMAIL_LABEL,
  LOGIN_LABEL,
  NEW_PASSWORD_LABEL,
  PASSWORD_RESET_CONFIRM_PAGE_TITLE,
  PASSWORD_RESET_DONE_MESSAGE,
  PASSWORD_RESET_LINK_SENT_MESSAGE,
  PASSWORD_RESET_PAGE_TITLE,
  PASSWORD_RESET_REQUEST_SUBMIT_LABEL,
  PASSWORD_RESET_SUBMIT_LABEL,
  REQUIRED_SUFFIX,
} from '../../../apps/client/src/components/auth/account-messages.ts';
import {
  createTestAccount,
  loginAs,
  MAIL_FLOW_TIMEOUT_MS,
  registerAccount,
  userMenuButton,
  verifyEmailBanner,
  waitForBotToken,
} from './account-steps.ts';
import { assumeDistinctClientIp } from '../../support/client-ip.ts';
import {
  waitForEmailLink,
  waitForEmailWithSubject,
} from '../../support/mailpit.ts';
import { expect, test } from './auth-test.ts';

test.describe.configure({ timeout: MAIL_FLOW_TIMEOUT_MS });

const PASSWORD_RESET_PATH = '/auth/password-reset';

const PASSWORD_RESET_CONFIRM_PATH = '/auth/password-reset/confirm';

const PASSWORD_RESET_COMPLETED_SUBJECT = 'パスワードが再設定されました';

const requestForm = (page: Page): Locator =>
  page.getByRole('form', { name: PASSWORD_RESET_PAGE_TITLE });

// 送信の後は要求のフォームが案内に置き換わり、案内はアカウントの有無で変わらない
async function requestPasswordReset(page: Page, email: string): Promise<void> {
  await page.goto(PASSWORD_RESET_PATH);
  const form = requestForm(page);
  await waitForBotToken(form);
  await form
    .getByLabel(`${EMAIL_LABEL}${REQUIRED_SUFFIX}`, { exact: true })
    .fill(email);
  await form
    .getByRole('button', { name: PASSWORD_RESET_REQUEST_SUBMIT_LABEL })
    .click();
  await expect(page.getByText(PASSWORD_RESET_LINK_SENT_MESSAGE)).toBeVisible();
  await expect(requestForm(page)).toHaveCount(0);
}

test.describe('パスワードリセット', () => {
  test('未登録のメールアドレスでも同じ案内になり、リンクから再設定すると既存のセッションが無効になって新しいパスワードでログインできる', async ({
    browser,
    baseURL,
    page,
  }) => {
    const account = createTestAccount();
    await registerAccount(page, account);
    const resetContext = await browser.newContext({ baseURL });
    try {
      await assumeDistinctClientIp(resetContext, baseURL);
      const resetPage = await resetContext.newPage();

      await requestPasswordReset(resetPage, createTestAccount().email);
      await requestPasswordReset(resetPage, account.email);

      const link = await waitForEmailLink({
        to: account.email,
        linkPath: PASSWORD_RESET_CONFIRM_PATH,
      });
      await resetPage.goto(link);
      const resetForm = resetPage.getByRole('form', {
        name: PASSWORD_RESET_CONFIRM_PAGE_TITLE,
      });
      const { password: newPassword } = createTestAccount();
      await resetForm
        .getByLabel(`${NEW_PASSWORD_LABEL}${REQUIRED_SUFFIX}`, { exact: true })
        .fill(newPassword);
      await resetForm
        .getByRole('button', { name: PASSWORD_RESET_SUBMIT_LABEL })
        .click();

      await expect(
        resetPage.getByText(PASSWORD_RESET_DONE_MESSAGE),
      ).toBeVisible();
      await waitForEmailWithSubject({
        to: account.email,
        subject: PASSWORD_RESET_COMPLETED_SUBJECT,
      });

      await page.reload();
      await expect(
        page.getByRole('banner').getByRole('link', { name: LOGIN_LABEL }),
      ).toBeVisible();
      await expect(userMenuButton(page, account)).toHaveCount(0);

      await loginAs(resetPage, { ...account, password: newPassword });
      await expect(verifyEmailBanner(resetPage)).toHaveCount(0);
    } finally {
      await resetContext.close();
    }
  });
});
