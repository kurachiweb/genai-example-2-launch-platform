import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { expect, test } from '@playwright/test';

import { scanPage } from '../../support/a11y-scan.ts';
import {
  ROUTE_INVENTORY,
  type RouteEntry,
} from '../../support/route-inventory.ts';
import { findSecurityHeaderProblems } from '../../support/security-assertions.ts';
import { CLIENT_ROUTE_CASES, isSkipped } from './client-route-cases.ts';
import {
  describeFinding,
  describeSummary,
  hasFindings,
  parseFindingLines,
  type RouteAuditFinding,
  routeCaseKey,
  routeTestTitle,
  summarizeFindings,
} from '../../support/route-audit-report.ts';
import { expectOpenedRoute, expectSettled } from './route-open-steps.ts';
import { deleteWorldHelpArticles } from './client-route-world.ts';
import { withSessionPage } from '../../support/route-sessions.ts';
import { findingsFilePath } from '../../support/route-world-cache.ts';

// 管理者と複数の利用者の登録・プロダクトの登録・予選の開始・決済・トーナメントの用意を、その状態を最初に使うテストが行う
const ROUTE_TEST_TIMEOUT_MS = 1_200_000;

// 開発サーバーが応答しなくなった時に、テストの制限時間まで待ち続けず、その経路の失敗として早く終える
const NAVIGATION_TIMEOUT_MS = 120_000;

const CLEANUP_TIMEOUT_MS = 600_000;

test.describe.configure({ timeout: ROUTE_TEST_TIMEOUT_MS });

const clientEntries: readonly RouteEntry[] = ROUTE_INVENTORY.filter(
  ({ app }) => app === 'client',
);

async function recordFinding(finding: RouteAuditFinding): Promise<void> {
  const path = findingsFilePath('client');
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(finding)}\n`, 'utf8');
}

// 7.1へ渡す違反とヘッダーの不足の一覧の置き場所と、その件数の要約を、実行の終わりに示す
async function reportSummary(): Promise<void> {
  const path = findingsFilePath('client');
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
            await expectSettled(page);
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
