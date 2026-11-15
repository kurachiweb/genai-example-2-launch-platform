import { describe, expect, test } from 'bun:test';

import { VUE_FEATURE_FLAGS } from './vue-feature-flags.ts';

describe('Vueの機能フラグ', () => {
  test('esm-bundler版のVueが参照する3つのフラグを無効の式として定義する', () => {
    expect(VUE_FEATURE_FLAGS).toEqual({
      __VUE_OPTIONS_API__: 'false',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    });
  });
});
