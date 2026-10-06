import { defineConfig } from '@playwright/test';

import { resolveBrowserLaunchOptions } from './config/vitest/browser.ts';
import { createPlaywrightConfig } from './e2e/support/playwright-config.ts';
import {
  createE2ETestFileDetector,
  resolveE2EProjects,
  resolveE2ETargets,
} from './e2e/support/targets.ts';

export default defineConfig(
  createPlaywrightConfig(
    resolveE2EProjects(
      resolveE2ETargets(process.env),
      createE2ETestFileDetector(import.meta.dirname),
    ),
    resolveBrowserLaunchOptions(process.env),
  ),
);
