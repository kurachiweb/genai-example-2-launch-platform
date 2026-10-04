import js from '@eslint/js';
import type { Linter } from 'eslint';
import prettierConfig from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

import { QUALITY_GATE_EXCLUDED_DIRS } from './config/workspace-layout.ts';
import { createBaseConfig } from './eslint.config.base.ts';

const EXTERNAL_DIRS = ['.claude', 'docs/ai-extensions', '.kiro/settings'];

// ESLintは.gitignoreを読まず、HTMLレポートにはトレースビューアのJavaScriptが含まれるため明示的に外す
const PLAYWRIGHT_OUTPUT_DIRS = ['test-results', 'playwright-report'];

// アプリと共有ディレクトリは各アプリが自分の設定で検査するため、ルートでは走査せず、アプリの設定も読み込まない
const NOT_ROOT_OWNED_DIRS = [
  'apps',
  ...QUALITY_GATE_EXCLUDED_DIRS,
  ...EXTERNAL_DIRS,
  ...PLAYWRIGHT_OUTPUT_DIRS,
];

const config: Linter.Config[] = [
  {
    name: 'root/ignores',
    ignores: NOT_ROOT_OWNED_DIRS.map((dir) => `${dir}/`),
  },
  ...createBaseConfig({
    js,
    tseslint,
    prettierConfig,
    tsconfigRootDir: import.meta.dirname,
  }),
];

export default config;
