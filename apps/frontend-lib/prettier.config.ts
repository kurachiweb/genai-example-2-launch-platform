import { fileURLToPath } from 'node:url';

import type { Config } from 'prettier';

import baseConfig from '../../prettier.config.ts';

const config: Config = {
  ...baseConfig,
  // 整形はルートのPrettierで実行され、プラグイン名は実行したディレクトリから解決されるため、共通部品のnode_modulesから解決した絶対パスで渡す
  plugins: [fileURLToPath(import.meta.resolve('prettier-plugin-tailwindcss'))],
  tailwindStylesheet: './styles/base.css',
};

export default config;
