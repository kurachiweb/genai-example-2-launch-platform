import { describe, expect, test } from 'bun:test';

import {
  typeOnlyImportsOf,
  valueModuleReferencesOf,
} from './module-references.ts';

describe('valueModuleReferencesOf', () => {
  test.each([
    "import js from '@eslint/js';",
    "import { type Linter } from 'eslint';",
    "import './side-effect.ts';",
    "export { createBaseConfig } from './base.ts';",
    "export * from './base.ts';",
    "import base = require('./base.ts');",
    "const loaded = await import('./base.ts');",
    "const loaded = require('./base.ts');",
  ])('%sを値の参照として検出する', (source) => {
    expect(valueModuleReferencesOf(source)).toHaveLength(1);
  });

  test.each([
    "import type js from '@eslint/js';",
    "import type { Linter } from 'eslint';",
    "export type { Linter } from 'eslint';",
    'export const value = 1;',
  ])('%sを値の参照として検出しない', (source) => {
    expect(valueModuleReferencesOf(source)).toEqual([]);
  });
});

describe('typeOnlyImportsOf', () => {
  test('型としてのみ参照するimport文だけを返す', () => {
    const source = [
      "import type js from '@eslint/js';",
      "import type { Config } from 'prettier';",
      "import { type Linter } from 'eslint';",
      "import base from './base.ts';",
    ].join('\n');

    expect(typeOnlyImportsOf(source)).toEqual([
      "import type js from '@eslint/js';",
      "import type { Config } from 'prettier';",
    ]);
  });

  test('import文が無ければ空を返す', () => {
    expect(typeOnlyImportsOf('export const value = 1;')).toEqual([]);
  });
});
