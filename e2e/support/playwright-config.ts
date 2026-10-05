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
): PlaywrightTestConfig {
  return {
    outputDir: OUTPUT_DIR,
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
