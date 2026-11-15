import { describe, expect, test } from 'bun:test';

import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import { EVENT_PRODUCT_TYPES } from './event-product-types.ts';

describe('EVENT_PRODUCT_TYPES', () => {
  test('物理削除のストア・プロダクトライフサイクルの実行器・画像の隔離と削除の処理・利用者のプロダクトの物理削除の波及処理の識別子を持つ', () => {
    const names = new Set(Object.keys(EVENT_PRODUCT_TYPES));

    expect(names.has('ProductPurgeStore')).toBe(true);
    expect(names.has('ProductLifecycleRunner')).toBe(true);
    expect(names.has('ProductImageQuarantineHandler')).toBe(true);
    expect(names.has('ProductImageErasureHandler')).toBe(true);
    expect(names.has('UserProductErasureHandler')).toBe(true);
  });

  test('識別子はグローバルのシンボル登録簿のproduct.event.<名前>である', () => {
    for (const [name, identifier] of Object.entries(EVENT_PRODUCT_TYPES)) {
      expect<symbol>(identifier).toBe(Symbol.for(`product.event.${name}`));
    }
  });

  test('両アプリ共通の識別子と重ならない', () => {
    const shared = new Set<symbol>(Object.values(PRODUCT_PLATFORM_TYPES));

    expect(
      Object.values(EVENT_PRODUCT_TYPES).filter((identifier) =>
        shared.has(identifier),
      ),
    ).toEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_PRODUCT_TYPES)).toBe(true);
  });
});
