import {
  expect,
  type Locator,
  type Page,
  type Response,
  test,
} from '@playwright/test';

import {
  API_SERVER_TIME_LABEL,
  BROWSER_RESULT_HEADING,
  DATABASE_REACHABLE_LABEL,
  RECHECK_LABEL,
  SERVER_RESULT_HEADING,
} from '../../apps/frontend-lib/utilities/messages/system-status-messages.ts';

export const SYSTEM_STATUS_PATH = '/system/status';

export const MISSING_PAGE_PATH = '/no-such-page';

export const RELAY_GRAPHQL_PATH = '/_bff/graphql';

// Sentryのブラウザ向けSDKが必ず含むグローバルの保管場所の名前で、最初に読み込むスクリプトにSDKが静的に取り込まれていないかの目印にする
export const SENTRY_SDK_MARKER = '__SENTRY__';

export const WEB_ANALYTICS_HOST = 'static.cloudflareinsights.com';

const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

// 開発サーバーの初回の変換とハイドレーションの待ちを含めても収まり、押し直しの上限が尽きた後に失敗を報告する余裕を残す
export const RECHECK_TEST_TIMEOUT_MS = 60_000;
const RECHECK_TOTAL_TIMEOUT_MS = 40_000;
const RECHECK_ATTEMPT_TIMEOUT_MS = 5_000;

const SKIPPED_CHECK_ANNOTATION_TYPE = '確認の省略';

// 対象の環境に確かめる対象が無く検査が空振りしたことを、テストの記録とレポートに残す
export function annotateSkippedCheck(description: string): void {
  test.info().annotations.push({
    type: SKIPPED_CHECK_ANNOTATION_TYPE,
    description,
  });
}

export const serverResultRegion = (page: Page): Locator =>
  page.getByRole('region', { name: SERVER_RESULT_HEADING });

export const browserResultRegion = (page: Page): Locator =>
  page.getByRole('region', { name: BROWSER_RESULT_HEADING });

export async function expectReachableResult(region: Locator): Promise<void> {
  await expect(region.getByText(API_SERVER_TIME_LABEL)).toBeVisible();
  await expect(region.locator('time')).toHaveAttribute(
    'datetime',
    ISO_DATE_TIME_PATTERN,
  );
  await expect(
    region.getByText(DATABASE_REACHABLE_LABEL, { exact: true }),
  ).toBeVisible();
}

const isRelayGraphQLResponse = (response: Response): boolean =>
  new URL(response.url()).pathname === RELAY_GRAPHQL_PATH &&
  response.request().method() === 'POST';

// ハイドレーションの前に押したボタンは何もしないため、中継へ要求が送られるまで押し直し、その応答を返す
export async function recheckFromBrowser(page: Page): Promise<Response> {
  let relayResponse: Response | undefined;
  await expect(async () => {
    const [response] = await Promise.all([
      page.waitForResponse(isRelayGraphQLResponse, {
        timeout: RECHECK_ATTEMPT_TIMEOUT_MS,
      }),
      page.getByRole('button', { name: RECHECK_LABEL }).click(),
    ]);
    relayResponse = response;
  }).toPass({ timeout: RECHECK_TOTAL_TIMEOUT_MS });
  if (relayResponse === undefined) {
    throw new Error('再確認の中継の応答を受け取れませんでした');
  }
  return relayResponse;
}
