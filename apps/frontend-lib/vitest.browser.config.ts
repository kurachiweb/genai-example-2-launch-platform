import { join } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import viteReact from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { searchForWorkspaceRoot } from 'vite';
import { defineConfig } from 'vitest/config';

import {
  browserOptionsPreset,
  browserTestPreset,
  resolveBrowserLaunchOptions,
} from '../../config/vitest/browser.ts';
import { EDITOR_PREBUNDLED_DEPENDENCIES } from './config/editor-prebundled-dependencies.ts';
import { VUE_FEATURE_FLAGS } from './config/vue-feature-flags.ts';

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
  'react-easy-crop',
  'uqr',
  'unified',
  'remark-parse',
  'remark-gfm',
  'remark-cjk-friendly',
  'remark-cjk-friendly-gfm-strikethrough',
  'remark-rehype',
  'rehype-sanitize',
  'rehype-stringify',
  'hast-util-to-text',
  ...EDITOR_PREBUNDLED_DEPENDENCIES,
];

// 共用部品は利用側アプリへの配置と同じ兄弟の相対パスで読み込み、自身の位置ではプロジェクトの外にある配置元を指すため、開発サーバーの配信を許可する
const COMMON_LIB_SOURCE_DIR = join(import.meta.dirname, '..', 'common-lib');

export default defineConfig({
  plugins: [viteReact(), tailwindcss()],
  define: VUE_FEATURE_FLAGS,
  optimizeDeps: {
    include: PREBUNDLED_DEPENDENCIES,
  },
  server: {
    fs: {
      allow: [
        searchForWorkspaceRoot(import.meta.dirname),
        COMMON_LIB_SOURCE_DIR,
      ],
    },
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
