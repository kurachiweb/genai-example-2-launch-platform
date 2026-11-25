import type { Page } from '@playwright/test';

import { USER_AVATAR_PURPOSE } from '../../../apps/common-lib/profile/profile-input-rules.ts';
import { UPLOAD_RELAY_PREFIX } from '../../../apps/common-lib/media/upload-protocol.ts';
import { findSecurityHeaderProblems } from '../../support/security-assertions.ts';
import { SET_COOKIE_HEADER_NAME } from '../../support/security-baseline-checks.ts';
import {
  createTestAccount,
  logoutFromUserMenu,
  MAIL_FLOW_TIMEOUT_MS,
  PROFILE_SETTINGS_PATH,
  registerAccount,
  type TestAccount,
} from '../auth/account-steps.ts';
import { expect, test } from '../auth/auth-test.ts';
import { registerVerifiedAccount } from '../profile-steps.ts';

const SESSION_COOKIE_NAME = '__Host-ls_session';

const ADMIN_SESSION_COOKIE_NAME = '__Host-ls_admin_session';

const RELAY_GRAPHQL_PATH = '/_bff/graphql';

const MAX_SESSION_MAX_AGE_SECONDS = 34_560_000;

const LENGTH_REQUIRED_STATUS = 411;

const CLEARING_MAX_AGE = 'Max-Age=0';

// セッションのCookieを持つ文脈のため、他のテストと値を共有しないよう、各テストで登録して作る
async function registerAndRecordSetCookies(
  page: Page,
  account: TestAccount,
): Promise<() => Promise<readonly string[]>> {
  const pending: Promise<readonly string[]>[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === RELAY_GRAPHQL_PATH) {
      pending.push(
        response
          .headersArray()
          .then((headers) =>
            headers
              .filter(
                ({ name }) => name.toLowerCase() === SET_COOKIE_HEADER_NAME,
              )
              .map(({ value }) => value),
          ),
      );
    }
  });
  await registerAccount(page, account);
  return async () => (await Promise.all(pending)).flat();
}

const sessionSetCookiesOf = (values: readonly string[]): readonly string[] =>
  values.filter((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));

test.describe('セッションのCookieの属性', () => {
  test('登録で発行するSet-Cookieは、Secure・HttpOnly・SameSite=Lax・Path=/・有効期間を持ち、Domainを持たない', async ({
    page,
  }) => {
    const account = createTestAccount();

    const readSetCookies = await registerAndRecordSetCookies(page, account);

    const issued = sessionSetCookiesOf(await readSetCookies());
    expect(issued).toHaveLength(1);
    const attributes = (issued[0] ?? '')
      .split(';')
      .slice(1)
      .map((attribute) => attribute.trim());
    expect(attributes).toEqual(
      expect.arrayContaining(['Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax']),
    );
    expect(attributes.some((a) => a.toLowerCase().startsWith('domain='))).toBe(
      false,
    );
    const maxAge = attributes.find((a) => a.startsWith('Max-Age='));
    const seconds = Number(maxAge?.slice('Max-Age='.length));
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(MAX_SESSION_MAX_AGE_SECONDS);
  });

  test('ブラウザが保持するCookieはHttpOnlyで、スクリプトから読めず、管理者側のCookieを持たない', async ({
    page,
    context,
  }) => {
    const account = createTestAccount();

    await registerAccount(page, account);

    const cookies = await context.cookies();
    const session = cookies.find(({ name }) => name === SESSION_COOKIE_NAME);
    expect(session).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
    });
    expect(session?.expires).toBeGreaterThan(Date.now() / 1000);
    expect(cookies.some(({ name }) => name === ADMIN_SESSION_COOKIE_NAME)).toBe(
      false,
    );
    const visibleToScript = await page.evaluate(() => document.cookie);
    expect(visibleToScript).not.toContain(SESSION_COOKIE_NAME);
  });

  test('ログアウトは、同じ属性で有効期間を0にしたSet-Cookieでセッションのクッキーを削除する', async ({
    page,
    context,
  }) => {
    const account = createTestAccount();
    const readSetCookies = await registerAndRecordSetCookies(page, account);
    const issuedCount = sessionSetCookiesOf(await readSetCookies()).length;

    await logoutFromUserMenu(page, account);

    await expect
      .poll(async () => sessionSetCookiesOf(await readSetCookies()).length)
      .toBeGreaterThan(issuedCount);
    const cleared = sessionSetCookiesOf(await readSetCookies()).at(-1) ?? '';
    expect(cleared).toContain(CLEARING_MAX_AGE);
    expect(cleared).toContain('Secure');
    expect(cleared).toContain('HttpOnly');
    expect(cleared).toContain('SameSite=Lax');
    await expect
      .poll(async () =>
        (await context.cookies()).some(
          ({ name }) => name === SESSION_COOKIE_NAME,
        ),
      )
      .toBe(false);
  });
});

test.describe('認証済みの応答のキャッシュの禁止', () => {
  test('ログイン中に描画した設定のページの応答は、no-storeとセキュリティヘッダーを持つ', async ({
    page,
  }) => {
    await registerAccount(page, createTestAccount());

    const response = await page.goto(PROFILE_SETTINGS_PATH);

    expect(response?.status()).toBe(200);
    const headers = (await response?.allHeaders()) ?? {};
    expect(headers['cache-control']).toContain('no-store');
    expect(findSecurityHeaderProblems(headers, 'page')).toEqual([]);
  });

  test('セッションを発行する中継の応答は、no-storeを持つ', async ({ page }) => {
    const responses: Promise<string | undefined>[] = [];
    page.on('response', (response) => {
      if (new URL(response.url()).pathname === RELAY_GRAPHQL_PATH) {
        responses.push(
          response.allHeaders().then((headers) => headers['cache-control']),
        );
      }
    });

    await registerAccount(page, createTestAccount());

    const cacheControls = await Promise.all(responses);
    expect(cacheControls.length).toBeGreaterThan(0);
    for (const cacheControl of cacheControls) {
      expect(cacheControl).toContain('no-store');
    }
  });
});

test.describe('Content-Lengthの無いアップロード', () => {
  test('Content-Lengthの無いアップロードを411で拒否し、長さを付けた同じ要求は411にならない', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(MAIL_FLOW_TIMEOUT_MS);
    const account = createTestAccount();
    await registerVerifiedAccount(page, account);
    const cookies = await context.cookies();
    const session = cookies.find(({ name }) => name === SESSION_COOKIE_NAME);
    expect(session).toBeDefined();
    const origin = new URL(baseURL ?? '').origin;
    const url = `${origin}${UPLOAD_RELAY_PREFIX}${USER_AVATAR_PURPOSE}`;
    const headers = {
      origin,
      cookie: `${SESSION_COOKIE_NAME}=${session?.value ?? ''}`,
      'content-type': 'image/png',
    };
    const body = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    // 本文をストリームで渡すと、Content-Lengthを付けないチャンク転送で送られる
    const chunked = await fetch(url, {
      method: 'POST',
      headers,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    const sized = await fetch(url, { method: 'POST', headers, body });

    expect(chunked.status).toBe(LENGTH_REQUIRED_STATUS);
    expect(await chunked.json()).toEqual({
      error: { code: 'content_length_required', message: expect.any(String) },
    });
    expect(sized.status).not.toBe(LENGTH_REQUIRED_STATUS);
  });
});
