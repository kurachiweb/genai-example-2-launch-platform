import { expect, test } from '@playwright/test';

import { NOT_FOUND_TITLE } from '../../apps/frontend-lib/utilities/messages/state-messages.ts';
import { SYSTEM_STATUS_TITLE } from '../../apps/frontend-lib/utilities/messages/system-status-messages.ts';
import {
  builtAssetScriptUrlsOf,
  findImmutableCacheProblems,
  findParserBlockingScriptTags,
  findScriptTagsWithoutNonce,
  findSecurityHeaderProblems,
  findWorkerHeaderTraces,
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
  FAVICON_PATH,
  MISSING_PAGE_PATH,
  pageLoadResultRegion,
  RECHECK_TEST_TIMEOUT_MS,
  recheckFromBrowser,
  recordRelayGraphQLRequests,
  RELAY_GRAPHQL_PATH,
  SENTRY_SDK_MARKER,
  serverResultRegion,
  SYSTEM_STATUS_PATH,
  WEB_ANALYTICS_HOST,
} from '../support/system-status-page.ts';

const RELAY_REQUEST_BODY = { query: '{ __typename }' };

test.describe('利用者側の疎通確認の画面', { tag: '@smoke' }, () => {
  test('応答にセキュリティヘッダーとnonce付きのCSPが付き、HTMLのすべてのスクリプトが同じnonceを持つ', async ({
    page,
  }) => {
    const response = await page.goto(SYSTEM_STATUS_PATH);

    expect(response?.status()).toBe(200);
    const headers = (await response?.allHeaders()) ?? {};
    expect(findSecurityHeaderProblems(headers, 'page')).toEqual([]);
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

  test('エラートラッキング・アクセス解析・bot判定のスクリプトを最初の描画を妨げない方法で読み込む', async ({
    page,
  }) => {
    const response = await page.goto(SYSTEM_STATUS_PATH);
    const html = (await response?.text()) ?? '';
    const nonce = scriptNonceOf(
      (await response?.allHeaders())?.['content-security-policy'] ?? '',
    );
    await page.waitForLoadState('load');

    expect(findParserBlockingScriptTags(html)).toEqual([]);
    expect(await readParserBlockingScriptSources(page)).toEqual([]);
    const analyticsScripts = scriptTagsFromHost(html, WEB_ANALYTICS_HOST);
    if (analyticsScripts.length === 0) {
      annotateSkippedCheck(
        'アクセス解析のトークンが無い環境のため、計測スクリプトのdeferとnonceの確認を飛ばした',
      );
    }
    for (const script of analyticsScripts) {
      expect(script.defer, script.source).toBe(true);
      expect(script.nonce, script.source).toBe(nonce);
    }
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

  test('ハイドレーションの後も再確認までは中継へ取得し直さず、表示した時の結果の見出しがサーバー側の描画のままである', async ({
    page,
  }) => {
    test.setTimeout(RECHECK_TEST_TIMEOUT_MS);
    const relayRequests = recordRelayGraphQLRequests(page);

    await page.goto(SYSTEM_STATUS_PATH);
    await expectReachableResult(serverResultRegion(page));
    // ハイドレーションの完了の合図が無いため、再確認のボタンが操作できたこと(押した操作で再確認の案内が消えたこと)を完了とみなす
    const recheckRequest = (await recheckFromBrowser(page)).request();
    await expectReachableResult(browserResultRegion(page));

    expect(
      relayRequests().map((request) =>
        request === recheckRequest
          ? '再確認'
          : `${request.method()} ${request.url()}`,
      ),
    ).toEqual(['再確認']);
    await expectReachableResult(serverResultRegion(page));
    await expect(pageLoadResultRegion(page)).toHaveCount(0);
  });

  test('ビルド後の対象でのみ、ビルドの成果物のスクリプトとファビコンをWorkerを通さずに配信し、成果物のスクリプトを長期にキャッシュさせる', async ({
    page,
    request,
  }) => {
    const response = await page.goto(SYSTEM_STATUS_PATH);
    const html = (await response?.text()) ?? '';

    const assetUrls = builtAssetScriptUrlsOf(html, page.url()).slice(0, 1);
    if (assetUrls.length === 0) {
      annotateSkippedCheck(
        'ビルドの成果物のスクリプトが無い対象(開発サーバー)のため、静的なファイルがWorkerを通らずに配信されることの確認を飛ばした',
      );
    }
    for (const url of assetUrls) {
      const asset = await request.get(url);
      expect(asset.ok(), url).toBe(true);
      expect(findImmutableCacheProblems(asset.headers()), url).toEqual([]);
      expect(findWorkerHeaderTraces(asset.headers()), url).toEqual([]);
      expect(
        findSecurityHeaderProblems(asset.headers(), 'static-file'),
        url,
      ).toEqual([]);
      const favicon = await request.get(FAVICON_PATH);
      expect(favicon.ok(), FAVICON_PATH).toBe(true);
      expect(findWorkerHeaderTraces(favicon.headers()), FAVICON_PATH).toEqual(
        [],
      );
      expect(
        findSecurityHeaderProblems(favicon.headers(), 'static-file'),
        FAVICON_PATH,
      ).toEqual([]);
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

test.describe('利用者側の存在しないページ', { tag: '@smoke' }, () => {
  test('404で、レイアウトの中に存在しないページの表示とトップページ・ディレクトリへの導線を表示し、CSPの違反が起きない', async ({
    page,
  }) => {
    await installCspViolationRecorder(page);

    const response = await page.goto(MISSING_PAGE_PATH);

    expect(response?.status()).toBe(404);
    expect(
      findSecurityHeaderProblems((await response?.allHeaders()) ?? {}, 'page'),
    ).toEqual([]);
    await expect(page.getByRole('banner')).toBeVisible();
    const main = page.getByRole('main');
    await expect(
      main.getByRole('heading', { level: 1, name: NOT_FOUND_TITLE }),
    ).toBeVisible();
    await expect(
      main.getByRole('link', { name: 'トップページへ' }),
    ).toHaveAttribute('href', '/');
    await expect(
      main.getByRole('link', { name: 'ディレクトリを見る' }),
    ).toHaveAttribute('href', '/p');
    await page.waitForLoadState('load');
    expect(await readCspViolations(page)).toEqual([]);
  });
});

test.describe('利用者側の中継の経路', { tag: '@smoke' }, () => {
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
