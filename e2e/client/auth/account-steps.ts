import { randomBytes } from 'node:crypto';

import { expect, type Locator, type Page } from '@playwright/test';

import {
  EMAIL_LABEL,
  EMAIL_VERIFIED_MESSAGE,
  LOGIN_PAGE_TITLE,
  LOGIN_SUBMIT_LABEL,
  NICKNAME_LABEL,
  PASSWORD_LABEL,
  REGISTER_PAGE_TITLE,
  REGISTER_SUBMIT_LABEL,
  REQUIRED_SUFFIX,
  VERIFY_EMAIL_ACTION_LABEL,
  VERIFY_EMAIL_BANNER_MESSAGE,
} from '../../../apps/client/src/components/auth/account-messages.ts';
import { userMenuLabel } from '../../../apps/client/src/components/layout/site-links.ts';
import { waitForEmailLink } from '../../support/mailpit.ts';

export interface TestAccount {
  readonly nickname: string;
  readonly email: string;
  readonly password: string;
}

export const VERIFY_EMAIL_PATH = '/auth/verify-email';

const TEST_EMAIL_DOMAIN = 'test.example';

const BOT_TOKEN_FIELD_SELECTOR = 'input[name="cf-turnstile-response"]';

// 前のテストや前回の実行のデータと衝突せず、漏洩パスワードの照合にも当たらないよう、実行ごとに乱数から作る
export function createTestAccount(): TestAccount {
  const suffix = randomBytes(8).toString('hex');
  return {
    nickname: `E2E利用者${suffix.slice(0, 6)}`,
    email: `e2e-${suffix}@${TEST_EMAIL_DOMAIN}`,
    password: randomBytes(18).toString('base64url'),
  };
}

export const registerForm = (page: Page): Locator =>
  page.getByRole('form', { name: REGISTER_PAGE_TITLE });

export const loginForm = (page: Page): Locator =>
  page.getByRole('form', { name: LOGIN_PAGE_TITLE });

export const verifyEmailBanner = (page: Page): Locator =>
  page.getByRole('status').filter({ hasText: VERIFY_EMAIL_BANNER_MESSAGE });

export const userMenuButton = (page: Page, account: TestAccount): Locator =>
  page
    .getByRole('banner')
    .getByRole('button', { name: userMenuLabel(account.nickname) });

// bot判定のトークンが無い送信は拒否されるため、非表示のウィジェットがフォームの中の入力欄へトークンを書き込むまで待つ。ウィジェットはハイドレーションの後に描かれるため、入力の前に待てばハイドレーションの前の操作の取りこぼしも防げる
export async function waitForBotToken(form: Locator): Promise<void> {
  await expect(form.locator(BOT_TOKEN_FIELD_SELECTOR)).not.toHaveValue('');
}

export async function registerAccount(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await page.goto('/auth/register');
  const form = registerForm(page);
  await waitForBotToken(form);
  await form
    .getByLabel(`${NICKNAME_LABEL}${REQUIRED_SUFFIX}`, { exact: true })
    .fill(account.nickname);
  await form
    .getByLabel(`${EMAIL_LABEL}${REQUIRED_SUFFIX}`, { exact: true })
    .fill(account.email);
  await form
    .getByLabel(`${PASSWORD_LABEL}${REQUIRED_SUFFIX}`, { exact: true })
    .fill(account.password);
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: REGISTER_SUBMIT_LABEL }).click();
  await expect(userMenuButton(page, account)).toBeVisible();
}

export async function submitLogin(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  const form = loginForm(page);
  await waitForBotToken(form);
  await form.getByLabel(EMAIL_LABEL, { exact: true }).fill(email);
  await form.getByLabel(PASSWORD_LABEL, { exact: true }).fill(password);
  await form.getByRole('button', { name: LOGIN_SUBMIT_LABEL }).click();
}

export async function loginAs(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/auth/login');
  await submitLogin(page, account.email, account.password);
  await expect(userMenuButton(page, account)).toBeVisible();
}

export async function verifyEmailFromMail(
  page: Page,
  account: TestAccount,
): Promise<void> {
  const link = await waitForEmailLink({
    to: account.email,
    linkPath: VERIFY_EMAIL_PATH,
  });
  await page.goto(link);
  await page.getByRole('button', { name: VERIFY_EMAIL_ACTION_LABEL }).click();
  await expect(page.getByText(EMAIL_VERIFIED_MESSAGE)).toBeVisible();
}
