import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import {
  ROUTE_INVENTORY,
  type RouteEntry,
} from '../../support/route-inventory.ts';
import { routeCaseKey } from '../../support/route-audit-report.ts';
import { withSessionPage } from '../../support/route-sessions.ts';
import { findingsFilePath } from '../../support/route-world-cache.ts';
import { CLIENT_ROUTE_CASES, isSkipped } from './client-route-cases.ts';
import { deleteWorldHelpArticles } from './client-route-world.ts';
import { expectOpenedRoute, expectSettled } from './route-open-steps.ts';
import { measureLayout } from './responsive-measure.ts';
import {
  describeResponsiveFinding,
  describeResponsiveSummary,
  hasResponsiveViolations,
  type LayoutViolation,
  parseResponsiveFindingLines,
  type ResponsiveFinding,
  NARROWEST_WIDTH,
  STRESS_CONDITIONS,
  summarizeResponsiveFindings,
  TEXT_STRETCH_RATIO,
  toViolations,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTHS,
} from './responsive-report.ts';

// 管理者と複数の利用者の登録・プロダクトの登録・予選の開始・決済・トーナメントの用意を、その状態を最初に使うテストが行う
const ROUTE_TEST_TIMEOUT_MS = 1_200_000;

const NAVIGATION_TIMEOUT_MS = 120_000;

const CLEANUP_TIMEOUT_MS = 600_000;

// 用意した状態は5.1の利用者側の全経路の検査と同じ名前空間(client)で共有し、実行を分けても長い用意をやり直さない。違反の一覧だけは別の名前空間にする
const FINDINGS_NAMESPACE = 'responsive';

test.describe.configure({ timeout: ROUTE_TEST_TIMEOUT_MS });

const clientEntries: readonly RouteEntry[] = ROUTE_INVENTORY.filter(
  ({ app }) => app === 'client',
);

// 画面の幅を変えても同じ状態のまま測れるよう、開く操作は1回だけ行い、幅は開いた後に切り替える
async function measureAtEveryWidth(
  page: Page,
  context: { readonly route: string; readonly state: string },
): Promise<readonly LayoutViolation[]> {
  const violations: LayoutViolation[] = [];
  for (const width of VIEWPORT_WIDTHS) {
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
    await expectSettled(page);
    const measure = (condition: (typeof STRESS_CONDITIONS)[number]) =>
      page.evaluate(measureLayout, { condition, ratio: TEXT_STRETCH_RATIO });
    const plain = await measure('plain');
    for (const condition of STRESS_CONDITIONS) {
      const issues = condition === 'plain' ? plain : await measure(condition);
      violations.push(
        ...toViolations({ ...context, width }, condition, issues, plain),
      );
    }
  }
  return violations;
}

async function recordFinding(finding: ResponsiveFinding): Promise<void> {
  const path = findingsFilePath(FINDINGS_NAMESPACE);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(finding)}\n`, 'utf8');
}

// 7.1へ渡す違反の一覧の置き場所と、その件数の要約を、実行の終わりに示す
async function reportSummary(): Promise<void> {
  const path = findingsFilePath(FINDINGS_NAMESPACE);
  const text = await readFile(path, 'utf8').catch(() => '');
  const findings = parseResponsiveFindingLines(text);
  process.stdout.write(
    `${describeResponsiveSummary(summarizeResponsiveFindings(findings))}。一覧: ${path}\n`,
  );
}

test.describe('利用者側の全経路の画面の幅と文字列の伸び', () => {
  test.afterAll(async ({ browser }) => {
    test.setTimeout(CLEANUP_TIMEOUT_MS);
    await reportSummary();
    await deleteWorldHelpArticles(browser);
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
      test(`${entry.path}(${state})は320・768・1280pxで横にはみ出さず、文字列を1.5倍に伸ばしても要素が重ならない`, async ({
        browser,
      }, testInfo) => {
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
          async (page): Promise<ResponsiveFinding> => {
            await outcome.beforeOpen?.(page);
            await page.setViewportSize({
              width: NARROWEST_WIDTH,
              height: VIEWPORT_HEIGHT,
            });
            const response = await page.goto(outcome.url, {
              timeout: NAVIGATION_TIMEOUT_MS,
            });
            await outcome.afterOpen?.(page);
            await expect(page.getByRole('main')).toBeVisible();
            await page.waitForLoadState('load', {
              timeout: NAVIGATION_TIMEOUT_MS,
            });
            expectOpenedRoute(page, response, outcome);
            return {
              route: entry.path,
              state,
              url: outcome.url,
              status: response?.status() ?? null,
              violations: await measureAtEveryWidth(page, {
                route: entry.path,
                state,
              }),
            };
          },
          outcome.storageState,
        );

        await recordFinding(finding);
        await testInfo.attach('responsive-layout-finding', {
          body: JSON.stringify(finding, null, 2),
          contentType: 'application/json',
        });
        expect(
          hasResponsiveViolations(finding),
          describeResponsiveFinding(finding),
        ).toBe(false);
      });
    }
  }
});
