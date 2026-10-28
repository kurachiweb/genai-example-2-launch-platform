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
import { createFrontendLintConfig } from './lib/config/frontend-lint.ts';

// 共有ディレクトリの静的解析は検査担当の共通部品が受け持つため、配置先を重ねて検査しない
const config: Linter.Config[] = [
  {
    name: 'admin/ignores',
    ignores: ['lib/', 'src/graphql/generated/', 'src/routeTree.gen.ts'],
  },
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
  prettierConfig,
];

export default config;
