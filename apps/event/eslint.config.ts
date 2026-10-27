import js from '@eslint/js';
import type { Linter } from 'eslint';
import prettierConfig from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

import {
  createBackendLayerRules,
  REACT_RESTRICTION,
} from '../../config/eslint/backend-layers.ts';
import { createBaseConfig } from '../../eslint.config.base.ts';

// 層の規則のno-restricted-importsのオプションを置き換えないよう、Reactの読み込み位置の制限は別の規則で行う
const REACT_CONFINEMENT_RULES: Linter.Config[] = [
  {
    name: 'event/email/react-confinement',
    files: ['src/**'],
    ignores: [
      'src/infrastructure/email/rendering/**',
      'src/infrastructure/email/templates/**',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [REACT_RESTRICTION] },
      ],
    },
  },
];

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
  ...createBackendLayerRules('event'),
  ...REACT_CONFINEMENT_RULES,
];

export default config;
