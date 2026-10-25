import js from '@eslint/js';
import type { Linter } from 'eslint';
import prettierConfig from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

import { createBaseConfig } from '../../eslint.config.base.ts';

// 共有ディレクトリの静的解析は検査担当のapiが受け持つため、配置先を重ねて検査しない
const config: Linter.Config[] = [
  {
    name: 'event/ignores',
    ignores: ['db/', 'lib/'],
  },
  ...createBaseConfig({
    js,
    tseslint,
    prettierConfig,
    tsconfigRootDir: import.meta.dirname,
  }),
];

export default config;
