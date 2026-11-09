import { describe, expect, test } from 'vitest';

import { createD1ProductLifecycleCommitter } from '../infrastructure/product/d1-product-lifecycle-committer.ts';
import { PRODUCT_LIFECYCLE_SYNC_HANDLERS } from './product-lifecycle-sync-handlers.ts';

const UNUSED_ID_GENERATOR = {
  generate: (): string => {
    throw new Error('登録の検証だけを確かめるため、IDは作らない');
  },
};

describe('PRODUCT_LIFECYCLE_SYNC_HANDLERS', () => {
  test('初版の登録口は空である', () => {
    expect(PRODUCT_LIFECYCLE_SYNC_HANDLERS).toStrictEqual([]);
  });

  test('登録は<spec名>.<名詞句>の名前と種類が重複せず、ライフサイクルの確定の部品を組み立てられる', () => {
    expect(() =>
      createD1ProductLifecycleCommitter(
        {} as never,
        UNUSED_ID_GENERATOR,
        PRODUCT_LIFECYCLE_SYNC_HANDLERS,
        () => {
          throw new Error('登録の検証だけを確かめるため、処理は解決しない');
        },
      ),
    ).not.toThrow();
  });
});
