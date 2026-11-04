import type { Locator, Page } from '@playwright/test';

import {
  LOGIN_SUBMIT_LABEL,
  RECOVERY_CODE_LABEL,
  REQUIRED_SUFFIX,
  SECOND_FACTOR_FORM_LABEL,
  TOTP_CODE_LABEL,
  USE_RECOVERY_CODE_LABEL,
} from '../../../apps/client/src/components/auth/account-messages.ts';
import {
  remainingRecoveryCodesMessage,
  TOTP_DISABLE_FORM_LABEL,
  TOTP_DISABLE_SUBMIT_LABEL,
  TOTP_DISABLED_MESSAGE,
  TOTP_DISABLED_STATUS,
  TOTP_ENABLE_SUBMIT_LABEL,
  TOTP_ENABLED_MESSAGE,
  TOTP_ENABLED_STATUS,
  TOTP_MANUAL_ENTRY_LABEL,
  TOTP_SETUP_DIALOG_TITLE,
  TOTP_START_FORM_LABEL,
  TOTP_START_SUBMIT_LABEL,
} from '../../../apps/client/src/components/settings/settings-messages.ts';
import { RECOVERY_CODES_LABEL } from '../../../apps/frontend-lib/utilities/messages/auth-messages.ts';
import {
  loginAs,
  createTestAccount,
  currentPasswordField,
  logoutFromUserMenu,
  MAIL_FLOW_TIMEOUT_MS,
  openSecuritySettings,
  registerAccount,
  submitLogin,
  type TestAccount,
  userMenuButton,
  verifyEmailFromMail,
} from './account-steps.ts';
import {
  createTotpCodeSource,
  type TotpCodeSource,
} from '../../support/totp.ts';
import { expect, test } from './auth-test.ts';

test.describe.configure({ timeout: MAIL_FLOW_TIMEOUT_MS });

const ISSUED_RECOVERY_CODE_COUNT = 10;

const secondFactorForm = (page: Page): Locator =>
  page.getByRole('form', { name: SECOND_FACTOR_FORM_LABEL });

interface EnabledTotp {
  readonly codes: TotpCodeSource;
  readonly recoveryCodes: readonly string[];
}

// 画面の手入力用の文字列から認証アプリと同じ方法で認証コードを計算して有効にし、この時だけ表示されるリカバリコードを控える
async function enableTotp(
  page: Page,
  account: TestAccount,
): Promise<EnabledTotp> {
  const startForm = page.getByRole('form', { name: TOTP_START_FORM_LABEL });
  await currentPasswordField(startForm).fill(account.password);
  await startForm
    .getByRole('button', { name: TOTP_START_SUBMIT_LABEL })
    .click();

  const dialog = page.getByRole('dialog', { name: TOTP_SETUP_DIALOG_TITLE });
  await expect(dialog.getByText(TOTP_MANUAL_ENTRY_LABEL)).toBeVisible();
  const codes = createTotpCodeSource(await dialog.locator('code').innerText());
  await dialog
    .getByLabel(`${TOTP_CODE_LABEL}${REQUIRED_SUFFIX}`, { exact: true })
    .fill(await codes.nextCode());
  await dialog.getByRole('button', { name: TOTP_ENABLE_SUBMIT_LABEL }).click();

  await expect(dialog.getByText(TOTP_ENABLED_MESSAGE)).toBeVisible();
  const recoveryCodeItems = dialog
    .getByRole('list', { name: RECOVERY_CODES_LABEL })
    .getByRole('listitem');
  await expect(recoveryCodeItems).toHaveCount(ISSUED_RECOVERY_CODE_COUNT);
  const recoveryCodes = await recoveryCodeItems.allInnerTexts();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  return { codes, recoveryCodes };
}

async function startLoginUntilSecondFactor(
  page: Page,
  account: TestAccount,
): Promise<Locator> {
  await page.goto('/auth/login');
  await submitLogin(page, account.email, account.password);
  const form = secondFactorForm(page);
  await expect(form).toBeVisible();
  await expect(userMenuButton(page, account)).toHaveCount(0);
  return form;
}

test.describe('多要素認証', () => {
  test('手入力用の文字列から計算した認証コードで有効にし、認証コードとリカバリコードでログインして、無効にするとパスワードだけでログインできる', async ({
    page,
  }) => {
    const account = createTestAccount();
    await registerAccount(page, account);
    await verifyEmailFromMail(page, account);
    await openSecuritySettings(page, account);
    await expect(page.getByText(TOTP_DISABLED_STATUS)).toBeVisible();

    const { codes, recoveryCodes } = await enableTotp(page, account);

    await expect(page.getByText(TOTP_ENABLED_STATUS)).toBeVisible();
    await expect(
      page.getByText(remainingRecoveryCodesMessage(ISSUED_RECOVERY_CODE_COUNT)),
    ).toBeVisible();

    await logoutFromUserMenu(page, account);
    const totpForm = await startLoginUntilSecondFactor(page, account);
    await totpForm
      .getByLabel(`${TOTP_CODE_LABEL}${REQUIRED_SUFFIX}`, { exact: true })
      .fill(await codes.nextCode());
    await totpForm.getByRole('button', { name: LOGIN_SUBMIT_LABEL }).click();
    await expect(userMenuButton(page, account)).toBeVisible();

    await logoutFromUserMenu(page, account);
    const recoveryForm = await startLoginUntilSecondFactor(page, account);
    await recoveryForm
      .getByRole('button', { name: USE_RECOVERY_CODE_LABEL })
      .click();
    await recoveryForm
      .getByLabel(`${RECOVERY_CODE_LABEL}${REQUIRED_SUFFIX}`, { exact: true })
      .fill(recoveryCodes[0] ?? '');
    await recoveryForm
      .getByRole('button', { name: LOGIN_SUBMIT_LABEL })
      .click();
    await expect(userMenuButton(page, account)).toBeVisible();

    await openSecuritySettings(page, account);
    await expect(
      page.getByText(
        remainingRecoveryCodesMessage(ISSUED_RECOVERY_CODE_COUNT - 1),
      ),
    ).toBeVisible();
    const disableForm = page.getByRole('form', {
      name: TOTP_DISABLE_FORM_LABEL,
    });
    await currentPasswordField(disableForm).fill(account.password);
    await disableForm
      .getByRole('button', { name: USE_RECOVERY_CODE_LABEL })
      .click();
    await disableForm
      .getByLabel(`${RECOVERY_CODE_LABEL}${REQUIRED_SUFFIX}`, { exact: true })
      .fill(recoveryCodes[1] ?? '');
    await disableForm
      .getByRole('button', { name: TOTP_DISABLE_SUBMIT_LABEL })
      .click();

    await expect(page.getByText(TOTP_DISABLED_MESSAGE)).toBeVisible();
    await expect(page.getByText(TOTP_DISABLED_STATUS)).toBeVisible();

    await logoutFromUserMenu(page, account);
    await loginAs(page, account);
    await expect(secondFactorForm(page)).toHaveCount(0);
  });
});
