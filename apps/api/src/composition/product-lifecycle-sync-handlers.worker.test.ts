import { describe, expect, test } from 'vitest';

import { DIRECTORY_TYPES } from '../application/directory/directory-types.ts';
import { MATCH_TYPES } from '../application/match/match-types.ts';
import { createD1ProductLifecycleCommitter } from '../infrastructure/product/d1-product-lifecycle-committer.ts';
import { PRODUCT_LIFECYCLE_SYNC_HANDLERS } from './product-lifecycle-sync-handlers.ts';

const UNUSED_ID_GENERATOR = {
  generate: (): string => {
    throw new Error('登録の検証だけを確かめるため、IDは作らない');
  },
};

describe('PRODUCT_LIFECYCLE_SYNC_HANDLERS', () => {
  test('match-engineの即時の終了とdirectory-discoveryの索引文書の削除を非公開化と削除に登録し、復元には登録しない', () => {
    expect(PRODUCT_LIFECYCLE_SYNC_HANDLERS).toStrictEqual([
      {
        name: 'match-engine.product-match-closure',
        events: ['hidden', 'deleted'],
        handler: MATCH_TYPES.ProductMatchClosureSyncHandler,
      },
      {
        name: 'directory-discovery.product-index-removal',
        events: ['deleted', 'hidden'],
        handler: DIRECTORY_TYPES.ProductIndexRemovalSyncHandler,
      },
    ]);
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
