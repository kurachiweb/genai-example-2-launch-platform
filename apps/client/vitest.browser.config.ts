import tailwindcss from '@tailwindcss/vite';
import viteReact from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defineConfig } from 'vitest/config';

import {
  browserOptionsPreset,
  browserTestPreset,
  resolveBrowserLaunchOptions,
} from '../../config/vitest/browser.ts';
import { EDITOR_PREBUNDLED_DEPENDENCIES } from './lib/config/editor-prebundled-dependencies.ts';
import { VUE_FEATURE_FLAGS } from './lib/config/vue-feature-flags.ts';

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
  'remark-cjk-friendly-gfm-strikethrough/parseOnly',
  'remark-rehype',
  'rehype-sanitize',
  'rehype-stringify',
  'hast-util-to-text',
  ...EDITOR_PREBUNDLED_DEPENDENCIES,
];

// 本物の経路の設定を読むテストから依存をたどると同型の関数のサーバーの分岐が読み込むサーバー専用のパッケージも見つかり、ブラウザ向けに事前バンドルできずテストの実行全体が失敗するため、事前バンドルから外す
const SERVER_ONLY_DEPENDENCIES = ['@tanstack/react-start/server'];

// 共有ディレクトリの配置先(lib・common-lib)のテストと網羅は検査担当の共通部品・共用部品が受け持つため、実行と分母の両方から外す
export default defineConfig({
  plugins: [viteReact(), tailwindcss()],
  define: VUE_FEATURE_FLAGS,
  optimizeDeps: {
    include: PREBUNDLED_DEPENDENCIES,
    exclude: SERVER_ONLY_DEPENDENCIES,
  },
  test: {
    ...browserTestPreset,
    exclude: [...configDefaults.exclude, 'lib/**', 'common-lib/**'],
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
