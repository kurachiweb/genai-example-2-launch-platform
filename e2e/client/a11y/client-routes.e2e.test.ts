import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { expect, type Page, type Response, test } from '@playwright/test';

import { scanPage } from '../../support/a11y-scan.ts';
import {
  ROUTE_INVENTORY,
  type RouteEntry,
} from '../../support/route-inventory.ts';
import { findSecurityHeaderProblems } from '../../support/security-assertions.ts';
import {
  CLIENT_ROUTE_CASES,
  isSkipped,
  type RouteTarget,
} from './client-route-cases.ts';
import {
  describeFinding,
  describeSummary,
  hasFindings,
  parseFindingLines,
  type RouteAuditFinding,
  routeCaseKey,
  routeTestTitle,
  summarizeFindings,
} from './client-route-report.ts';
import { deleteWorldHelpArticles } from './client-route-world.ts';
import { withSessionPage } from './route-sessions.ts';
import { findingsFilePath } from './route-world-cache.ts';

// 管理者と複数の利用者の登録・プロダクトの登録・予選の開始・決済・トーナメントの用意を、その状態を最初に使うテストが行う
const ROUTE_TEST_TIMEOUT_MS = 1_200_000;

// 開発サーバーが応答しなくなった時に、テストの制限時間まで待ち続けず、その経路の失敗として早く終える
const NAVIGATION_TIMEOUT_MS = 120_000;

const CLEANUP_TIMEOUT_MS = 600_000;

const OK_STATUS = 200;

// 画面の取得中に出るスケルトンと読み込み中の領域が全て消えてから検査する
const LOADING_SELECTOR = '[data-slot="skeleton"], [aria-busy="true"]';

const SETTLE_TIMEOUT_MS = 30_000;

test.describe.configure({ timeout: ROUTE_TEST_TIMEOUT_MS });

const clientEntries: readonly RouteEntry[] = ROUTE_INVENTORY.filter(
  ({ app }) => app === 'client',
);

// ログインへの移動やエラーの画面への差し替えで、検査したい状態と別の画面を検査して通らないよう、状態コードと移動先を確かめる
function expectOpenedRoute(
  page: Page,
  response: Response | null,
  { url, expectedStatus = OK_STATUS }: RouteTarget,
): void {
  expect(response?.status(), `${url}の応答の状態コード`).toBe(expectedStatus);
  expect(new URL(page.url()).pathname, `${url}を開いた後の移動先`).toBe(
    new URL(url, page.url()).pathname,
  );
}

async function recordFinding(finding: RouteAuditFinding): Promise<void> {
  const path = findingsFilePath();
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(finding)}\n`, 'utf8');
}

// 7.1へ渡す違反とヘッダーの不足の一覧の置き場所と、その件数の要約を、実行の終わりに示す
async function reportSummary(): Promise<void> {
  const path = findingsFilePath();
  const text = await readFile(path, 'utf8').catch(() => '');
  const findings = parseFindingLines(text);
  process.stdout.write(
    `${describeSummary(summarizeFindings(findings))}。一覧: ${path}\n`,
  );
}

test.describe('利用者側の全経路のアクセシビリティとセキュリティヘッダー', () => {
  test.afterAll(async ({ browser }) => {
    test.setTimeout(CLEANUP_TIMEOUT_MS);
    await reportSummary();
    await deleteWorldHelpArticles(browser);
  });

  test('一覧の利用者側の全ての経路と状態に、開く手順がある', () => {
    const inventoried = clientEntries.flatMap(({ path, states, excluded }) =>
      excluded === undefined
        ? states.map((state) => routeCaseKey(path, state))
        : [],
    );

    const missing = inventoried.filter((key) => !CLIENT_ROUTE_CASES.has(key));
    const unknown = [...CLIENT_ROUTE_CASES.keys()].filter(
      (key) => !inventoried.includes(key),
    );

    expect({ missing, unknown }).toEqual({ missing: [], unknown: [] });
  });

  for (const entry of clientEntries) {
    if (entry.excluded !== undefined) {
      const reason = entry.excluded;
      test(`${entry.path}は検査しない`, () => {
        test.skip(true, reason);
      });
      continue;
    }
    for (const state of entry.states) {
      test(routeTestTitle(entry.path, state), async ({ browser }, testInfo) => {
        const resolver = CLIENT_ROUTE_CASES.get(
          routeCaseKey(entry.path, state),
        );
        if (resolver === undefined) {
          throw new Error(`${entry.path}(${state})を開く手順がありません`);
        }
        const outcome = await resolver(browser);
        if (isSkipped(outcome)) {
          test.skip(true, outcome.skip);
          return;
        }
        const finding = await withSessionPage(
          browser,
          'client',
          async (page): Promise<RouteAuditFinding> => {
            await outcome.beforeOpen?.(page);
            const response = await page.goto(outcome.url, {
              timeout: NAVIGATION_TIMEOUT_MS,
            });
            await outcome.afterOpen?.(page);
            await expect(page.getByRole('main')).toBeVisible();
            await page.waitForLoadState('load', {
              timeout: NAVIGATION_TIMEOUT_MS,
            });
            expectOpenedRoute(page, response, outcome);
            await expect(page.locator(LOADING_SELECTOR)).toHaveCount(0, {
              timeout: SETTLE_TIMEOUT_MS,
            });
            return {
              route: entry.path,
              state,
              url: outcome.url,
              status: response?.status() ?? null,
              violations: await scanPage(page, { route: entry.path, state }),
              headerProblems: findSecurityHeaderProblems(
                (await response?.allHeaders()) ?? {},
                'page',
              ),
            };
          },
          outcome.storageState,
        );

        await recordFinding(finding);
        await testInfo.attach('route-audit-finding', {
          body: JSON.stringify(finding, null, 2),
          contentType: 'application/json',
        });
        expect(hasFindings(finding), describeFinding(finding)).toBe(false);
      });
    }
  }
});
