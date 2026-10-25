import js from '@eslint/js';
import type { Linter } from 'eslint';
import prettierConfig from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

import { createBaseConfig } from '../../eslint.config.base.ts';

const config: Linter.Config[] = createBaseConfig({
  js,
  tseslint,
  prettierConfig,
  tsconfigRootDir: import.meta.dirname,
});

export default config;
