import type { PlaywrightTestConfig, Project } from '@playwright/test';

import { TEST_FILE_PATTERNS } from '../../config/test-patterns.ts';
import type { BrowserLaunchOptions } from '../../config/vitest/browser.ts';
import type { E2EProjectPlan } from './targets.ts';

// パスはいずれも、ルートに置くplaywright.config.tsのディレクトリを基準にPlaywrightが解決する
const OUTPUT_DIR = 'test-results';
const HTML_REPORT_DIR = 'playwright-report';
const REACHABILITY_SETUP_DIR = 'e2e/support';
const REACHABILITY_SETUP_FILE = 'reachability.setup.ts';
const ZERO_TESTS_REPORTER_PATH = './e2e/support/zero-tests-reporter.ts';

// 開発サーバーに対して多く並列に実行すると機械の負荷で実行環境が落ちることがあり、Playwrightの既定(CPUのコア数の半分)は機械によって変わるため、ローカルとCIで同じ上限にする
export const DEFAULT_E2E_WORKERS = 2;

const E2E_WORKERS_ENV_KEY = 'E2E_WORKERS';

const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

export function resolveE2EWorkers(
  env: Readonly<Record<string, string | undefined>>,
): number {
  const value = env[E2E_WORKERS_ENV_KEY];
  if (value === undefined || value === '') {
    return DEFAULT_E2E_WORKERS;
  }
  if (!POSITIVE_INTEGER_PATTERN.test(value)) {
    throw new Error(
      `環境変数${E2E_WORKERS_ENV_KEY}には1以上の整数を指定してください: ${value}`,
    );
  }
  return Number.parseInt(value, 10);
}

const toProjects = ({
  target,
  testDir,
  setupProjectName,
}: E2EProjectPlan): Project[] => [
  {
    name: setupProjectName,
    testDir: REACHABILITY_SETUP_DIR,
    testMatch: REACHABILITY_SETUP_FILE,
    use: { baseURL: target.baseURL },
  },
  {
    name: target.name,
    testDir,
    testMatch: [...TEST_FILE_PATTERNS.e2e],
    dependencies: [setupProjectName],
    use: { baseURL: target.baseURL },
  },
];

export function createPlaywrightConfig(
  plans: readonly E2EProjectPlan[],
  launchOptions: BrowserLaunchOptions,
  workers: number,
): PlaywrightTestConfig {
  return {
    outputDir: OUTPUT_DIR,
    workers,
    // 開発コンテナからはホストのブラウザを開けず、失敗時にレポートの配信サーバーが待ち続けてコマンドが終わらないため、自動で開かない
    reporter: [
      ['list'],
      ['html', { outputFolder: HTML_REPORT_DIR, open: 'never' }],
      [ZERO_TESTS_REPORTER_PATH],
    ],
    use: { launchOptions },
    projects: plans.flatMap(toProjects),
  };
}
