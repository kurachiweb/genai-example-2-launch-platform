import { join } from 'node:path';

import eslintReact from '@eslint-react/eslint-plugin';
import js from '@eslint/js';
import tanstackQuery from '@tanstack/eslint-plugin-query';
import tanstackRouter from '@tanstack/eslint-plugin-router';
import type { Linter } from 'eslint';
import prettierConfig from 'eslint-config-prettier/flat';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import storybook from 'eslint-plugin-storybook';
import tseslint from 'typescript-eslint';

import { createBaseConfig } from '../../eslint.config.base.ts';
import { createFrontendLintConfig } from './config/frontend-lint.ts';

const config: Linter.Config[] = [
  ...createBaseConfig({
    js,
    tseslint,
    prettierConfig,
    tsconfigRootDir: import.meta.dirname,
  }),
  ...createFrontendLintConfig({
    eslintReact,
    reactHooks,
    jsxA11y,
    tanstackQuery,
    tanstackRouter,
    storybook,
  }),
  {
    files: ['.storybook/main.ts'],
    rules: {
      // 規則は作業ディレクトリからpackage.jsonを探すため、ルートから起動するコミット時の検査でも共通部品の宣言を読ませる
      'storybook/no-uninstalled-addons': [
        'error',
        { packageJsonLocation: join(import.meta.dirname, 'package.json') },
      ],
    },
  },
  prettierConfig,
];

export default config;
