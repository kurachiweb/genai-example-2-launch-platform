import { describe, expect, test } from 'bun:test';

import {
  PRODUCT_LAUNCH_SECTIONS,
  PRODUCT_OWNER_ACTIONS,
  PRODUCT_PAGE_SECTIONS,
} from '../../composition/product-page-sections.ts';
import { PRODUCT_PAGE_PLACEMENTS } from './product-page-section-order.ts';
import type { ProductPagePlacement } from './product-page-section-types.ts';

const SECTION_ID_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u;

const PLACEMENTS: readonly ProductPagePlacement[] = PRODUCT_PAGE_PLACEMENTS;

describe('プロダクト詳細ページの登録箇所', () => {
  test('ローンチの区画と投稿者本人向けの操作の登録箇所は初版では空である', () => {
    expect(PRODUCT_LAUNCH_SECTIONS).toStrictEqual([]);
    expect(PRODUCT_OWNER_ACTIONS).toStrictEqual([]);
  });

  test.each([
    ['詳細ページの区画', PRODUCT_PAGE_SECTIONS],
    ['ローンチの区画', PRODUCT_LAUNCH_SECTIONS],
    ['投稿者本人向けの操作', PRODUCT_OWNER_ACTIONS],
  ] as const)(
    '%sのidは重複せず`<spec名>.<名詞句>`の形で、orderは有限の数である',
    (_name, entries) => {
      const ids = entries.map(({ id }) => id);

      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => SECTION_ID_PATTERN.test(id))).toBe(true);
      expect(entries.every(({ order }) => Number.isFinite(order))).toBe(true);
    },
  );

  test('詳細ページの区画の置き場所は4つのいずれかである', () => {
    expect(
      PRODUCT_PAGE_SECTIONS.every(({ placement }) =>
        PLACEMENTS.includes(placement),
      ),
    ).toBe(true);
  });
});
