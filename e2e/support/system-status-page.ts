import {
  expect,
  type Locator,
  type Page,
  type Request,
  type Response,
  test,
} from '@playwright/test';

import {
  API_SERVER_TIME_LABEL,
  BROWSER_RESULT_HEADING,
  DATABASE_REACHABLE_LABEL,
  PAGE_LOAD_RESULT_HEADING,
  RECHECK_GUIDANCE,
  RECHECK_LABEL,
  SERVER_RESULT_HEADING,
} from '../../apps/frontend-lib/utilities/messages/system-status-messages.ts';

export const SYSTEM_STATUS_PATH = '/system/status';

export const MISSING_PAGE_PATH = '/no-such-page';

export const RELAY_GRAPHQL_PATH = '/_bff/graphql';

export const FAVICON_PATH = '/favicon.ico';

// Sentryのブラウザ向けSDKが必ず含むグローバルの保管場所の名前で、最初に読み込むスクリプトにSDKが静的に取り込まれていないかの目印にする
export const SENTRY_SDK_MARKER = '__SENTRY__';

export const WEB_ANALYTICS_HOST = 'static.cloudflareinsights.com';

const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

// 開発サーバーの初回の変換とハイドレーションの待ちを含めても収まり、押し直しの上限が尽きた後に失敗を報告する余裕を残す
export const RECHECK_TEST_TIMEOUT_MS = 60_000;
const RECHECK_TOTAL_TIMEOUT_MS = 40_000;
// ハイドレーションの後のクリックは同じ操作の中で表示を変えるため、変化を待つ時間は短くてよい
const RECHECK_REACTION_TIMEOUT_MS = 2_000;

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

export const pageLoadResultRegion = (page: Page): Locator =>
  page.getByRole('region', { name: PAGE_LOAD_RESULT_HEADING });

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

const isRelayGraphQLRequest = (request: Request): boolean =>
  new URL(request.url()).pathname === RELAY_GRAPHQL_PATH &&
  request.method() === 'POST';

const isRelayGraphQLResponse = (response: Response): boolean =>
  isRelayGraphQLRequest(response.request());

// ページを開く前に呼び、以降にページが中継の経路へ送ったPOSTを送った順に記録して、その時点の記録を返す関数を返す
export function recordRelayGraphQLRequests(
  page: Page,
): () => readonly Request[] {
  const requests: Request[] = [];
  page.on('request', (request) => {
    if (isRelayGraphQLRequest(request)) {
      requests.push(request);
    }
  });
  return () => [...requests];
}

// ハイドレーションの完了の合図が無く、その前に押したボタンは何もしないため、再確認の案内が表示されている間だけ押し直し、案内が消えて中継の応答が届くのを待って最後の応答を返す。
// 案内が消えた後(押した操作が効いて再確認中)は押さないため、応答が遅くても中継へ2回目の要求を送らない
export async function recheckFromBrowser(page: Page): Promise<Response> {
  const relayResponses: Response[] = [];
  const recordResponse = (response: Response): void => {
    if (isRelayGraphQLResponse(response)) {
      relayResponses.push(response);
    }
  };
  page.on('response', recordResponse);
  try {
    const guidance = browserResultRegion(page).getByText(RECHECK_GUIDANCE);
    await expect(async () => {
      if (await guidance.isVisible()) {
        await page.getByRole('button', { name: RECHECK_LABEL }).click();
      }
      await expect(guidance).toBeHidden({
        timeout: RECHECK_REACTION_TIMEOUT_MS,
      });
      expect(relayResponses, '再確認の中継の応答').not.toHaveLength(0);
    }).toPass({ timeout: RECHECK_TOTAL_TIMEOUT_MS });
  } finally {
    page.off('response', recordResponse);
  }
  const relayResponse = relayResponses.at(-1);
  if (relayResponse === undefined) {
    throw new Error('再確認の中継の応答を受け取れませんでした');
  }
  return relayResponse;
}
