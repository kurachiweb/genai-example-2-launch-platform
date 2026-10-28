import { expect, test } from '@playwright/test';

import { NOT_FOUND_TITLE } from '../../apps/frontend-lib/utilities/messages/state-messages.ts';
import { SYSTEM_STATUS_TITLE } from '../../apps/frontend-lib/utilities/messages/system-status-messages.ts';
import {
  findParserBlockingScriptTags,
  findScriptTagsWithoutNonce,
  findSecurityHeaderProblems,
  installCspViolationRecorder,
  readCspViolations,
  readParserBlockingScriptSources,
  scriptNonceOf,
  scriptTagsFromHost,
  staticScriptUrlsOf,
} from '../support/security-assertions.ts';
import {
  annotateSkippedCheck,
  browserResultRegion,
  expectReachableResult,
  MISSING_PAGE_PATH,
  RECHECK_TEST_TIMEOUT_MS,
  recheckFromBrowser,
  RELAY_GRAPHQL_PATH,
  SENTRY_SDK_MARKER,
  serverResultRegion,
  SYSTEM_STATUS_PATH,
  WEB_ANALYTICS_HOST,
} from '../support/system-status-page.ts';

const RELAY_REQUEST_BODY = { query: '{ __typename }' };

// 管理者側はアクセス解析を持たないため、計測スクリプトの配信元も送信先の許可も現れない
const WEB_ANALYTICS_DOMAIN = 'cloudflareinsights.com';

const NO_INDEX_ROBOTS_CONTENT = 'noindex, nofollow';

test.describe('管理者側の疎通確認の画面', () => {
  test('応答にセキュリティヘッダーとnonce付きのCSPが付き、HTMLのすべてのスクリプトが同じnonceを持つ', async ({
    page,
  }) => {
    const response = await page.goto(SYSTEM_STATUS_PATH);

    expect(response?.status()).toBe(200);
    const headers = (await response?.allHeaders()) ?? {};
    expect(findSecurityHeaderProblems(headers, 'page')).toEqual([]);
    expect(headers['x-robots-tag']).toBe(NO_INDEX_ROBOTS_CONTENT);
    expect(headers['content-security-policy']).not.toContain(
      WEB_ANALYTICS_DOMAIN,
    );
    const nonce = scriptNonceOf(headers['content-security-policy'] ?? '');
    expect(nonce).toBeDefined();
    const html = (await response?.text()) ?? '';
    expect(html).toContain('<script');
    expect(findScriptTagsWithoutNonce(html, nonce ?? '')).toEqual([]);
  });

  test('要求ごとに異なるnonceを使う', async ({ request }) => {
    const first = await request.get(SYSTEM_STATUS_PATH);
    const second = await request.get(SYSTEM_STATUS_PATH);

    const firstNonce = scriptNonceOf(
      first.headers()['content-security-policy'] ?? '',
    );
    const secondNonce = scriptNonceOf(
      second.headers()['content-security-policy'] ?? '',
    );
    expect(firstNonce).toBeDefined();
    expect(secondNonce).toBeDefined();
    expect(firstNonce).not.toBe(secondNonce);
  });

  test('APIサーバーの時刻と到達可能を表示し、再確認が成功し、CSPの違反が起きない', async ({
    page,
  }) => {
    test.setTimeout(RECHECK_TEST_TIMEOUT_MS);
    await installCspViolationRecorder(page);

    await page.goto(SYSTEM_STATUS_PATH);

    await expect(
      page.getByRole('heading', { level: 1, name: SYSTEM_STATUS_TITLE }),
    ).toBeVisible();
    await expectReachableResult(serverResultRegion(page));
    const relayResponse = await recheckFromBrowser(page);
    expect(relayResponse.status()).toBe(200);
    expect(
      findSecurityHeaderProblems(await relayResponse.allHeaders(), 'non-page'),
    ).toEqual([]);
    await expectReachableResult(browserResultRegion(page));
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('エラートラッキング・bot判定のスクリプトを最初の描画を妨げない方法で読み込み、アクセス解析のスクリプトを持たない', async ({
    page,
  }) => {
    const response = await page.goto(SYSTEM_STATUS_PATH);
    const html = (await response?.text()) ?? '';
    await page.waitForLoadState('load');

    expect(findParserBlockingScriptTags(html)).toEqual([]);
    expect(scriptTagsFromHost(html, WEB_ANALYTICS_HOST)).toEqual([]);
    expect(html).not.toContain(WEB_ANALYTICS_DOMAIN);
    expect(await readParserBlockingScriptSources(page)).toEqual([]);
  });

  test('ビルド後の対象でのみ、最初に読み込むスクリプトがSentryを静的に取り込まず、静的なファイルの応答にセキュリティヘッダーが付く', async ({
    page,
    request,
  }) => {
    const response = await page.goto(SYSTEM_STATUS_PATH);
    const html = (await response?.text()) ?? '';

    const scriptUrls = staticScriptUrlsOf(html, page.url());
    if (scriptUrls.length === 0) {
      annotateSkippedCheck(
        'ビルドの成果物のスクリプトが無い対象(開発サーバー)のため、Sentryの静的な取り込みと静的なファイルのヘッダーの確認を飛ばした',
      );
    }
    for (const url of scriptUrls) {
      const script = await request.get(url);
      expect(script.ok(), url).toBe(true);
      expect(
        findSecurityHeaderProblems(script.headers(), 'static-file'),
        url,
      ).toEqual([]);
      expect((await script.text()).includes(SENTRY_SDK_MARKER), url).toBe(
        false,
      );
    }
  });

  test.describe('スクリプトを実行しないブラウザ', () => {
    test.use({ javaScriptEnabled: false });

    test('サーバーが描画したHTMLだけで主要な内容を表示する', async ({
      page,
    }) => {
      await page.goto(SYSTEM_STATUS_PATH);

      await expect(
        page.getByRole('heading', { level: 1, name: SYSTEM_STATUS_TITLE }),
      ).toBeVisible();
      await expectReachableResult(serverResultRegion(page));
    });
  });
});

test.describe('管理者側の存在しないページ', () => {
  test('404で、レイアウトの中に存在しないページの表示とトップページへの導線を表示し、CSPの違反が起きない', async ({
    page,
  }) => {
    await installCspViolationRecorder(page);

    const response = await page.goto(MISSING_PAGE_PATH);

    expect(response?.status()).toBe(404);
    const headers = (await response?.allHeaders()) ?? {};
    expect(findSecurityHeaderProblems(headers, 'page')).toEqual([]);
    expect(headers['x-robots-tag']).toBe(NO_INDEX_ROBOTS_CONTENT);
    await expect(page.getByRole('banner')).toBeVisible();
    const main = page.getByRole('main');
    await expect(
      main.getByRole('heading', { level: 1, name: NOT_FOUND_TITLE }),
    ).toBeVisible();
    await expect(main.getByRole('link')).toHaveCount(1);
    await expect(
      main.getByRole('link', { name: 'トップページへ' }),
    ).toHaveAttribute('href', '/');
    await page.waitForLoadState('load');
    expect(await readCspViolations(page)).toEqual([]);
  });
});

test.describe('管理者側の中継の経路', () => {
  test('クロスサイトを名乗る要求を403と共通のエラー形式で拒否する', async ({
    request,
  }) => {
    const response = await request.post(RELAY_GRAPHQL_PATH, {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
      data: RELAY_REQUEST_BODY,
    });

    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: 'csrf_rejected', message: expect.any(String) },
    });
    expect(findSecurityHeaderProblems(response.headers(), 'non-page')).toEqual(
      [],
    );
  });

  test('Sec-Fetch-Siteが無くOriginが異なる要求を403で拒否する', async ({
    request,
  }) => {
    const response = await request.post(RELAY_GRAPHQL_PATH, {
      headers: { Origin: 'https://cross-site.example' },
      data: RELAY_REQUEST_BODY,
    });

    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: 'csrf_rejected', message: expect.any(String) },
    });
  });
});
