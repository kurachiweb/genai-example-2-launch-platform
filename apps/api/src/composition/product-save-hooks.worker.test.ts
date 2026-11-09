import { describe, expect, test } from 'vitest';

import {
  createProductSaveHooks,
  type ProductSaveHook,
} from '../infrastructure/product/product-save-hooks.ts';
import { PRODUCT_SAVE_HOOKS } from './product-save-hooks.ts';

const STUB_HOOK: ProductSaveHook = {
  statementsFor: () => Promise.resolve([]),
  afterCommit: () => Promise.resolve(),
};

// 登録の検証だけを確かめるため、どの識別子にも何もしない処理を返す
const resolveStub: Parameters<typeof createProductSaveHooks>[1] = () =>
  STUB_HOOK as never;

describe('PRODUCT_SAVE_HOOKS', () => {
  test('初版の登録口は空である', () => {
    expect(PRODUCT_SAVE_HOOKS).toStrictEqual([]);
  });

  test('登録は<spec名>.<名詞句>の名前が重複せず、保存の登録口の部品を組み立てられる', () => {
    expect(() =>
      createProductSaveHooks(PRODUCT_SAVE_HOOKS, resolveStub),
    ).not.toThrow();
  });
});
