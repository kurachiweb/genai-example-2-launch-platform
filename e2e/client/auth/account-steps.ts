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
import {
  LOGOUT_LABEL,
  SETTINGS_LINK,
  userMenuLabel,
} from '../../../apps/client/src/components/layout/site-links.ts';
import {
  ACCOUNT_SETTINGS_PAGE_TITLE,
  CURRENT_PASSWORD_LABEL,
  SECURITY_SETTINGS_PAGE_TITLE,
  SETTINGS_NAVIGATION_LABEL,
} from '../../../apps/client/src/components/settings/settings-messages.ts';
import { SETTINGS_NAV_ITEMS } from '../../../apps/client/src/composition/settings-navigation.ts';
import { waitForBotToken } from '../../support/bot-verification.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../../support/hydration-retry.ts';
import { waitForEmailLink } from '../../support/mailpit.ts';
import { TEST_EMAIL_DOMAIN } from '../../support/test-email.ts';

export { waitForBotToken } from '../../support/bot-verification.ts';

export interface TestAccount {
  readonly nickname: string;
  readonly email: string;
  readonly password: string;
}

export const VERIFY_EMAIL_PATH = '/auth/verify-email';

export const PROFILE_SETTINGS_PATH = '/settings/profile';

const ACCOUNT_SETTINGS_PATH = '/settings/account';

export const SECURITY_SETTINGS_PATH = '/settings/security';

// 退会済みの利用者も未登録のメールアドレスと同じ文言で拒否されるため、ログインの拒否はこの1つの文言で確かめる
export const INVALID_CREDENTIALS_MESSAGE =
  'メールアドレスまたはパスワードが正しくありません。';

// 1つの流れで複数のメールの到着とログインを待つため、既定の30秒では開発サーバーの負荷で足りなくなることがある
export const MAIL_FLOW_TIMEOUT_MS = 90_000;

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
  await form
    .getByLabel(`${EMAIL_LABEL}${REQUIRED_SUFFIX}`, { exact: true })
    .fill(email);
  await form
    .getByLabel(`${PASSWORD_LABEL}${REQUIRED_SUFFIX}`, { exact: true })
    .fill(password);
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

async function chooseUserMenuItem(
  page: Page,
  account: TestAccount,
  item: Locator,
): Promise<void> {
  await expect(async () => {
    if (!(await item.isVisible())) {
      await userMenuButton(page, account).click();
    }
    await expect(item).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  await item.click();
}

export const currentPasswordField = (form: Locator): Locator =>
  form.getByLabel(`${CURRENT_PASSWORD_LABEL}${REQUIRED_SUFFIX}`, {
    exact: true,
  });

export async function logoutFromUserMenu(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await chooseUserMenuItem(
    page,
    account,
    page.getByRole('menuitem', { name: LOGOUT_LABEL }),
  );
}

const settingsNavLabelOf = (path: string): string => {
  const item = SETTINGS_NAV_ITEMS.find(({ to }) => to === path);
  if (item === undefined) {
    throw new Error(`設定のナビゲーションに${path}の項目がありません`);
  }
  return item.label;
};

// ユーザーメニューの「設定」は先頭の項目のプロフィールの設定ページへ移る
export async function openProfileSettings(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await chooseUserMenuItem(
    page,
    account,
    page.getByRole('menuitem', { name: SETTINGS_LINK.label }),
  );
  await expect(page).toHaveURL(PROFILE_SETTINGS_PATH);
}

// 設定ページのフォームの多くはbot判定のウィジェットを持たず、ハイドレーションの完了を待つ手掛かりが無いため、ハイドレーション済みの画面からルーターの遷移で開く。ハイドレーションの前に入力した値はフォームの状態に入らず、送信ボタンが無効のまま残る。プロフィールの設定ページを経て、ナビゲーションのリンクでアカウントの設定ページへ移る
export async function openAccountSettings(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await openProfileSettings(page, account);
  await page
    .getByRole('navigation', { name: SETTINGS_NAVIGATION_LABEL })
    .getByRole('link', { name: settingsNavLabelOf(ACCOUNT_SETTINGS_PATH) })
    .click();
  await expect(page).toHaveURL(ACCOUNT_SETTINGS_PATH);
  await expect(
    page.getByRole('heading', { level: 1, name: ACCOUNT_SETTINGS_PAGE_TITLE }),
  ).toBeVisible();
}

export async function openSecuritySettings(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await openAccountSettings(page, account);
  await page
    .getByRole('navigation', { name: SETTINGS_NAVIGATION_LABEL })
    .getByRole('link', { name: settingsNavLabelOf(SECURITY_SETTINGS_PATH) })
    .click();
  await expect(page).toHaveURL(SECURITY_SETTINGS_PATH);
  await expect(
    page.getByRole('heading', { level: 1, name: SECURITY_SETTINGS_PAGE_TITLE }),
  ).toBeVisible();
}
