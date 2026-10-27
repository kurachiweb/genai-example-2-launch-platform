import tailwindcss from '@tailwindcss/vite';
import viteReact from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import {
  browserOptionsPreset,
  browserTestPreset,
  resolveBrowserLaunchOptions,
} from '../../config/vitest/browser.ts';

// 実行中に依存の事前バンドルをやり直すとページが再読み込みされ、Reactが2つ読み込まれてフックが失敗するため、画面部品の依存を最初から事前バンドルする
const PREBUNDLED_DEPENDENCIES = [
  'react',
  'react/jsx-dev-runtime',
  'react-dom/client',
  'vitest-browser-react',
  'radix-ui',
  'lucide-react',
  'class-variance-authority',
  'clsx',
  'tailwind-merge',
];

export default defineConfig({
  plugins: [viteReact(), tailwindcss()],
  optimizeDeps: {
    include: PREBUNDLED_DEPENDENCIES,
  },
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
