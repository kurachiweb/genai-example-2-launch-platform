import { describe, expect, test, vi } from 'vitest';

import { MY_PRODUCT_SECTIONS } from '../../composition/my-product-sections.ts';
import { PRODUCT_DELETE_NOTICES } from '../../composition/product-delete-notices.ts';
import { WeekEntryDeleteNotice } from '../week-tournament/week-entry-delete-notice.tsx';
import { WeekEntryMyProductSection } from '../week-tournament/week-entry-my-product-section.tsx';

// 実行の関数はサーバー専用の処理を読み込むため、登録箇所の部品を読み込むテストでは差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const SECTION_ID_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u;

describe('自分のプロダクトの区画と削除の注意書きの登録箇所', () => {
  test('自分のプロダクトの区画にはtournament-weekの参加費の導線(10)を登録する', () => {
    expect(
      MY_PRODUCT_SECTIONS.map(({ id, order }) => ({ id, order })),
    ).toStrictEqual([{ id: 'tournament-week.entry', order: 10 }]);
    expect(MY_PRODUCT_SECTIONS[0]?.component).toBe(WeekEntryMyProductSection);
  });

  test('削除の注意書きにはtournament-weekの参加資格の喪失(10)を登録する', () => {
    expect(
      PRODUCT_DELETE_NOTICES.map(({ id, order }) => ({ id, order })),
    ).toStrictEqual([{ id: 'tournament-week.entry-loss', order: 10 }]);
    expect(PRODUCT_DELETE_NOTICES[0]?.component).toBe(WeekEntryDeleteNotice);
  });

  test.each([
    ['自分のプロダクトの区画', MY_PRODUCT_SECTIONS],
    ['削除の注意書き', PRODUCT_DELETE_NOTICES],
  ] as const)(
    '%sのidは重複せず`<spec名>.<名詞句>`の形で、orderは有限の数である',
    (_name, entries) => {
      const ids = entries.map(({ id }) => id);

      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => SECTION_ID_PATTERN.test(id))).toBe(true);
      expect(entries.every(({ order }) => Number.isFinite(order))).toBe(true);
    },
  );
});
