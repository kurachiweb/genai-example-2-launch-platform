import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/tanstack-react';
import { mergeConfig, searchForWorkspaceRoot } from 'vite';

import { EDITOR_PREBUNDLED_DEPENDENCIES } from '../config/editor-prebundled-dependencies.ts';
import { VUE_FEATURE_FLAGS } from '../config/vue-feature-flags.ts';

// カタログの表示中にCloudflareへ通信してウィジェットを読み込まないよう、判定の結果をボタンで起こすテスト用の部品へ差し替える
const FAKE_TURNSTILE_PATH = fileURLToPath(
  new URL('../test/fake-turnstile.tsx', import.meta.url),
);

const APP_DIR = join(import.meta.dirname, '..');

// 共用部品は利用側アプリへの配置と同じ兄弟の相対パスで読み込み、自身の位置ではプロジェクトの外にある配置元を指すため、開発サーバーの配信を許可する
const COMMON_LIB_SOURCE_DIR = join(APP_DIR, '..', 'common-lib');

const config: StorybookConfig = {
  framework: '@storybook/tanstack-react',
  addons: ['@storybook/addon-a11y'],
  stories: ['../components/**/*.stories.tsx'],
  core: { disableTelemetry: true },
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      plugins: [tailwindcss()],
      define: VUE_FEATURE_FLAGS,
      optimizeDeps: { include: [...EDITOR_PREBUNDLED_DEPENDENCIES] },
      resolve: {
        alias: { '@marsidev/react-turnstile': FAKE_TURNSTILE_PATH },
      },
      server: {
        fs: {
          allow: [searchForWorkspaceRoot(APP_DIR), COMMON_LIB_SOURCE_DIR],
        },
      },
    }),
};

export default config;
