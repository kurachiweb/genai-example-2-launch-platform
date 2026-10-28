import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/tanstack-react';
import { mergeConfig } from 'vite';

// カタログの表示中にCloudflareへ通信してウィジェットを読み込まないよう、判定の結果をボタンで起こすテスト用の部品へ差し替える
const FAKE_TURNSTILE_PATH = fileURLToPath(
  new URL('../test/fake-turnstile.tsx', import.meta.url),
);

const config: StorybookConfig = {
  framework: '@storybook/tanstack-react',
  addons: ['@storybook/addon-a11y'],
  stories: ['../components/**/*.stories.tsx'],
  core: { disableTelemetry: true },
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      plugins: [tailwindcss()],
      resolve: {
        alias: { '@marsidev/react-turnstile': FAKE_TURNSTILE_PATH },
      },
    }),
};

export default config;
