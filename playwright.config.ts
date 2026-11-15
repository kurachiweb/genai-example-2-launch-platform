import { defineConfig } from '@playwright/test';

import { resolveBrowserLaunchOptions } from './config/vitest/browser.ts';
import {
  createPlaywrightConfig,
  type E2ESerialGroup,
  resolveE2ERetries,
  resolveE2EWorkers,
} from './e2e/support/playwright-config.ts';
import {
  createE2ETestFileDetector,
  resolveE2EProjects,
  resolveE2ETargets,
} from './e2e/support/targets.ts';

// 同じ共有の行(Ultras導線の機能フラグ)を書き換えるため、利用者側の後に管理者側を1つずつ実行する
const SERIAL_GROUPS: readonly E2ESerialGroup[] = [
  {
    name: 'ultras',
    steps: [
      { target: 'client', testMatch: 'ultras.e2e.test.ts' },
      { target: 'admin', testMatch: 'ultras-promotion.e2e.test.ts' },
    ],
  },
];

export default defineConfig(
  createPlaywrightConfig(
    resolveE2EProjects(
      resolveE2ETargets(process.env),
      createE2ETestFileDetector(import.meta.dirname),
    ),
    resolveBrowserLaunchOptions(process.env),
    resolveE2EWorkers(process.env),
    SERIAL_GROUPS,
    resolveE2ERetries(process.env),
  ),
);
