import { describe, expect, test } from 'vitest';

import { DIRECTORY_TYPES } from '../application/directory/directory-types.ts';
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
  test('directory-discoveryの索引の更新待ちの処理だけを登録する', () => {
    expect(PRODUCT_SAVE_HOOKS).toStrictEqual([
      {
        name: 'directory-discovery.product-index-refresh',
        hook: DIRECTORY_TYPES.ProductIndexRefreshSaveHook,
      },
    ]);
  });

  test('登録は<spec名>.<名詞句>の名前が重複せず、保存の登録口の部品を組み立てられる', () => {
    expect(() =>
      createProductSaveHooks(PRODUCT_SAVE_HOOKS, resolveStub),
    ).not.toThrow();
  });
});
