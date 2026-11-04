import type { Locator, Page } from '@playwright/test';

import {
  LOGGED_OUT_MESSAGE,
  LOGIN_LABEL,
} from '../../../apps/client/src/components/auth/account-messages.ts';
import {
  CURRENT_DEVICE_LABEL,
  REVOKE_SESSION_LABEL,
  SECURITY_SETTINGS_PAGE_TITLE,
  SESSION_REVOKED_MESSAGE,
  SESSIONS_SECTION_TITLE,
  sessionCountMessage,
} from '../../../apps/client/src/components/settings/settings-messages.ts';
import {
  createTestAccount,
  INVALID_CREDENTIALS_MESSAGE,
  loginAs,
  loginForm,
  logoutFromUserMenu,
  registerAccount,
  SECURITY_SETTINGS_PATH,
  submitLogin,
  userMenuButton,
  waitForBotToken,
} from './account-steps.ts';
import { assumeDistinctClientIp } from '../../support/client-ip.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../../support/hydration-retry.ts';
import { expect, test } from './auth-test.ts';

const sessionsSection = (page: Page): Locator =>
  page.getByRole('region', { name: SESSIONS_SECTION_TITLE });

const sessionItems = (page: Page): Locator =>
  sessionsSection(page).getByRole('listitem');

const currentSessionItem = (page: Page): Locator =>
  sessionItems(page).filter({
    has: page.getByText(CURRENT_DEVICE_LABEL, { exact: true }),
  });

const otherSessionItems = (page: Page): Locator =>
  sessionItems(page).filter({
    hasNot: page.getByText(CURRENT_DEVICE_LABEL, { exact: true }),
  });

test.describe('ログインとログアウト', () => {
  test('ユーザーメニューからログアウトし、誤ったパスワードは文言で拒否され、正しいパスワードでログインできる', async ({
    page,
  }) => {
    const account = createTestAccount();
    await registerAccount(page, account);

    await logoutFromUserMenu(page, account);

    await expect(page.getByText(LOGGED_OUT_MESSAGE)).toBeVisible();
    const header = page.getByRole('banner');
    await expect(header.getByRole('link', { name: LOGIN_LABEL })).toBeVisible();
    await page.reload();
    await expect(header.getByRole('link', { name: LOGIN_LABEL })).toBeVisible();
    await expect(userMenuButton(page, account)).toHaveCount(0);

    await page.goto('/auth/login');
    await submitLogin(page, account.email, `${account.password}x`);

    await expect(
      loginForm(page)
        .getByRole('alert')
        .filter({ hasText: INVALID_CREDENTIALS_MESSAGE }),
    ).toBeVisible();
    await expect(userMenuButton(page, account)).toHaveCount(0);

    // 失敗した送信でトークンを使ったため、ウィジェットが次のトークンを発行するのを待ってから送り直す
    await waitForBotToken(loginForm(page));
    await submitLogin(page, account.email, account.password);

    await expect(userMenuButton(page, account)).toBeVisible();
    await expect(page).toHaveURL('/');
  });
});

test.describe('ログイン中の端末の管理', () => {
  test('別のブラウザの文脈のログインを一覧で確かめて個別にログアウトさせると、その文脈はログインし直しを求められる', async ({
    browser,
    baseURL,
    page,
  }) => {
    const account = createTestAccount();
    await registerAccount(page, account);
    const otherContext = await browser.newContext({ baseURL });
    try {
      await assumeDistinctClientIp(otherContext, baseURL);
      const otherPage = await otherContext.newPage();

      await otherPage.goto(SECURITY_SETTINGS_PATH);
      await expect(otherPage).toHaveURL(/\/auth\/login\?/u);
      await submitLogin(otherPage, account.email, account.password);
      await expect(otherPage).toHaveURL(SECURITY_SETTINGS_PATH);
      await expect(
        otherPage.getByRole('heading', {
          level: 1,
          name: SECURITY_SETTINGS_PAGE_TITLE,
        }),
      ).toBeVisible();
      await expect(sessionItems(otherPage)).toHaveCount(2);
      await expect(currentSessionItem(otherPage)).toHaveCount(1);

      await page.goto(SECURITY_SETTINGS_PATH);
      await expect(
        sessionsSection(page).getByText(sessionCountMessage(2)),
      ).toBeVisible();
      await expect(currentSessionItem(page)).toHaveCount(1);
      await expect(otherSessionItems(page)).toHaveCount(1);

      const revokeButton = otherSessionItems(page).getByRole('button', {
        name: REVOKE_SESSION_LABEL,
        exact: true,
      });
      await expect(async () => {
        if (await revokeButton.isVisible()) {
          await revokeButton.click();
        }
        await expect(otherSessionItems(page)).toHaveCount(0, {
          timeout: REACTION_TIMEOUT_MS,
        });
      }).toPass({ timeout: RETRY_TIMEOUT_MS });

      await expect(page.getByText(SESSION_REVOKED_MESSAGE)).toBeVisible();
      await expect(
        sessionsSection(page).getByText(sessionCountMessage(1)),
      ).toBeVisible();
      await expect(currentSessionItem(page)).toHaveCount(1);

      await otherPage.reload();
      await expect(otherPage).toHaveURL(/\/auth\/login\?/u);
      await expect(userMenuButton(otherPage, account)).toHaveCount(0);

      await page.reload();
      await expect(userMenuButton(page, account)).toBeVisible();
      await expect(sessionItems(page)).toHaveCount(1);
    } finally {
      await otherContext.close();
    }
  });

  test('ログアウトしたセッションは一覧に残らず、ログインし直した端末だけが「この端末」として表示される', async ({
    page,
  }) => {
    const account = createTestAccount();
    await registerAccount(page, account);
    await logoutFromUserMenu(page, account);
    await expect(page.getByText(LOGGED_OUT_MESSAGE)).toBeVisible();

    await loginAs(page, account);
    await page.goto(SECURITY_SETTINGS_PATH);

    await expect(
      sessionsSection(page).getByText(sessionCountMessage(1)),
    ).toBeVisible();
    await expect(currentSessionItem(page)).toHaveCount(1);
  });
});
