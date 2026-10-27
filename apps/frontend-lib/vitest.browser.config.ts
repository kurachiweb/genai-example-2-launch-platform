import tailwindcss from '@tailwindcss/vite';
import viteReact from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import {
  browserOptionsPreset,
  browserTestPreset,
  resolveBrowserLaunchOptions,
} from '../../config/vitest/browser.ts';

export default defineConfig({
  plugins: [viteReact(), tailwindcss()],
  test: {
    ...browserTestPreset,
    coverage: {
      ...browserTestPreset.coverage,
      include: ['components/**/*.{ts,tsx}'],
      exclude: [...browserTestPreset.coverage.exclude, '**/*.stories.tsx'],
    },
    browser: {
      ...browserOptionsPreset,
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: resolveBrowserLaunchOptions(process.env),
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
});
