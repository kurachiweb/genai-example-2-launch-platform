import tailwindcss from '@tailwindcss/vite';
import viteReact from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defineConfig } from 'vitest/config';

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
  'react-dom/server',
  'vitest-browser-react',
  'radix-ui',
  'lucide-react',
  'class-variance-authority',
  'clsx',
  'tailwind-merge',
  'react-hook-form',
  '@hookform/resolvers/zod',
  'zod',
  'sonner',
  '@tanstack/react-router',
  '@tanstack/react-query',
  'jotai/vanilla',
  '@marsidev/react-turnstile',
];

// 本物の経路の設定を読むテストから依存をたどると同型の関数のサーバーの分岐が読み込むサーバー専用のパッケージも見つかり、ブラウザ向けに事前バンドルできずテストの実行全体が失敗するため、事前バンドルから外す
const SERVER_ONLY_DEPENDENCIES = ['@tanstack/react-start/server'];

// 共有ディレクトリの配置先(lib)のテストと網羅は検査担当の共通部品が受け持つため、実行と分母の両方から外す
export default defineConfig({
  plugins: [viteReact(), tailwindcss()],
  optimizeDeps: {
    include: PREBUNDLED_DEPENDENCIES,
    exclude: SERVER_ONLY_DEPENDENCIES,
  },
  test: {
    ...browserTestPreset,
    exclude: [...configDefaults.exclude, 'lib/**'],
    coverage: {
      ...browserTestPreset.coverage,
      include: ['src/components/**/*.{ts,tsx}'],
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
