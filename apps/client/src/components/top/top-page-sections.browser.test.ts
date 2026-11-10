import { describe, expect, test, vi } from 'vitest';

import {
  QUALIFIER_LIST_INSERTS,
  TOP_PAGE_SECTIONS,
} from '../../composition/top-page-sections.ts';
import { FullTimeCountdownSection } from './full-time-countdown-section.tsx';
import { TOP_PAGE_PLACEMENTS } from './top-page-section-order.ts';

// 実行の関数はサーバー専用の処理を読み込むため、登録箇所の部品を読み込むテストでは差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const SECTION_ID_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u;

describe('トップページの区画の登録箇所', () => {
  test('区画にはmatch-engineのカウントダウン(上部の行の10)と予選(本文の30)を登録し、差し込みの登録箇所は空である', () => {
    expect(
      TOP_PAGE_SECTIONS.map(({ id, placement, order }) => ({
        id,
        placement,
        order,
      })),
    ).toStrictEqual([
      { id: 'match-engine.countdown', placement: 'banner', order: 10 },
      { id: 'match-engine.qualifiers', placement: 'main', order: 30 },
    ]);
    expect(TOP_PAGE_SECTIONS[0]?.component).toBe(FullTimeCountdownSection);
    expect(QUALIFIER_LIST_INSERTS).toStrictEqual([]);
  });

  test.each([
    ['トップページの区画', TOP_PAGE_SECTIONS],
    ['予選の一覧の差し込み', QUALIFIER_LIST_INSERTS],
  ] as const)(
    '%sのidは重複せず`<spec名>.<名詞句>`の形で、orderは有限の数である',
    (_name, entries) => {
      const ids = entries.map(({ id }) => id);

      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => SECTION_ID_PATTERN.test(id))).toBe(true);
      expect(entries.every(({ order }) => Number.isFinite(order))).toBe(true);
    },
  );

  test('区画の置き場所は5つのいずれかで、差し込みの間隔は1以上の整数である', () => {
    expect(
      TOP_PAGE_SECTIONS.every(({ placement }) =>
        TOP_PAGE_PLACEMENTS.includes(placement),
      ),
    ).toBe(true);
    expect(
      QUALIFIER_LIST_INSERTS.every(
        ({ every }) => Number.isInteger(every) && every >= 1,
      ),
    ).toBe(true);
  });
});
