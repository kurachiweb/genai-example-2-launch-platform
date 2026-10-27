import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import { browserTestPreset } from '../../config/vitest/browser.ts';

export default defineConfig({
  test: {
    ...browserTestPreset,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});
