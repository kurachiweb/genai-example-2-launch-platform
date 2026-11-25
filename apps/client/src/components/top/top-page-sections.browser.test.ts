import { describe, expect, test, vi } from 'vitest';

import {
  QUALIFIER_LIST_INSERTS,
  TOP_PAGE_SECTIONS,
} from '../../composition/top-page-sections.ts';
import { FullTimeCountdownSection } from './full-time-countdown-section.tsx';
import { GoldListInsert } from '../sponsorship/gold-list-insert.tsx';
import { GoldListPlacement } from '../sponsorship/gold-list-placement.tsx';
import { LegendPlacement } from '../sponsorship/legend-placement.tsx';
import { TopPageSilverPlacement } from '../sponsorship/top-page-silver-placement.tsx';
import { WeekFinalShowcase } from '../week-tournament/week-final-showcase.tsx';
import { WeekTournamentSection } from '../week-tournament/week-tournament-section.tsx';
import { YearFinalShowcase } from '../year-tournament/year-final-showcase.tsx';
import { YearTournamentSection } from '../year-tournament/year-tournament-section.tsx';
import {
  groupTopPageSections,
  TOP_PAGE_PLACEMENTS,
} from './top-page-section-order.ts';

// 実行の関数はサーバー専用の処理を読み込むため、登録箇所の部品を読み込むテストでは差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const SECTION_ID_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u;

const componentOf = (id: string) =>
  TOP_PAGE_SECTIONS.find((section) => section.id === id)?.component;

describe('トップページの区画の登録箇所', () => {
  test('区画にはmatch-engineのカウントダウン(上部の行の10)・tournament-yearの決勝(全幅の注目の10)・tournament-weekの決勝(全幅の注目の20)・tournament-yearのYearトーナメント(本文の10)・tournament-weekのWeekトーナメント(本文の20)・match-engineの予選(本文の30)・sponsorshipのLegend(上部の行の5)・Gold(横の列の10)・Silver(フッター直上の10)を登録し、予選の一覧にはsponsorshipのGoldの差し込み(10、2件ごと)を登録する', () => {
    expect(
      TOP_PAGE_SECTIONS.map(({ id, placement, order }) => ({
        id,
        placement,
        order,
      })),
    ).toStrictEqual([
      { id: 'match-engine.countdown', placement: 'banner', order: 10 },
      { id: 'tournament-year.final', placement: 'showcase', order: 10 },
      { id: 'tournament-week.final', placement: 'showcase', order: 20 },
      { id: 'tournament-year.matches', placement: 'main', order: 10 },
      { id: 'tournament-week.matches', placement: 'main', order: 20 },
      { id: 'match-engine.qualifiers', placement: 'main', order: 30 },
      { id: 'sponsorship.legend', placement: 'banner', order: 5 },
      { id: 'sponsorship.gold', placement: 'aside', order: 10 },
      { id: 'sponsorship.silver', placement: 'bottom', order: 10 },
    ]);
    expect(componentOf('match-engine.countdown')).toBe(
      FullTimeCountdownSection,
    );
    expect(componentOf('tournament-year.final')).toBe(YearFinalShowcase);
    expect(componentOf('tournament-week.final')).toBe(WeekFinalShowcase);
    expect(componentOf('tournament-year.matches')).toBe(YearTournamentSection);
    expect(componentOf('tournament-week.matches')).toBe(WeekTournamentSection);
    expect(componentOf('sponsorship.legend')).toBe(LegendPlacement);
    expect(componentOf('sponsorship.gold')).toBe(GoldListPlacement);
    expect(componentOf('sponsorship.silver')).toBe(TopPageSilverPlacement);
    expect(
      QUALIFIER_LIST_INSERTS.map(({ id, order, every }) => ({
        id,
        order,
        every,
      })),
    ).toStrictEqual([{ id: 'sponsorship.gold-insert', order: 10, every: 2 }]);
    expect(QUALIFIER_LIST_INSERTS[0]?.component).toBe(GoldListInsert);
  });

  test('上部の行ではLegendの区画を、カウントダウンの区画より前に描く', () => {
    expect(
      groupTopPageSections(TOP_PAGE_SECTIONS).banner.map(({ id }) => id),
    ).toStrictEqual(['sponsorship.legend', 'match-engine.countdown']);
  });

  test('本文ではYearトーナメントの区画を、Weekトーナメントの区画と予選の区画より上に描く', () => {
    expect(
      groupTopPageSections(TOP_PAGE_SECTIONS).main.map(({ id }) => id),
    ).toStrictEqual([
      'tournament-year.matches',
      'tournament-week.matches',
      'match-engine.qualifiers',
    ]);
  });

  test('全幅の注目ではYearトーナメントの決勝の区画を、Weekトーナメントの決勝の区画より上に描く', () => {
    expect(
      groupTopPageSections(TOP_PAGE_SECTIONS).showcase.map(({ id }) => id),
    ).toStrictEqual(['tournament-year.final', 'tournament-week.final']);
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
