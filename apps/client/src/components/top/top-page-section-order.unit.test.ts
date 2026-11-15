import { describe, expect, test } from 'bun:test';

import {
  groupTopPageSections,
  layoutQualifierList,
  orderTopPageSections,
  qualifierInsertCount,
  TOP_PAGE_PLACEMENTS,
} from './top-page-section-order.ts';
import type {
  QualifierListInsert,
  TopPagePlacement,
  TopPageSection,
} from './top-page-section-types.ts';

const noop = () => null;

const section = (
  id: string,
  placement: TopPagePlacement,
  order: number,
): TopPageSection => ({ id, placement, order, component: noop });

const insert = (
  id: string,
  every: number,
  order = 10,
): QualifierListInsert => ({ id, every, order, component: noop });

const describeItems = (
  items: ReturnType<typeof layoutQualifierList<string>>,
): readonly string[] =>
  items.map((item) =>
    item.kind === 'card'
      ? item.card
      : `${item.insert.id}#${String(item.position)}`,
  );

describe('トップページの区画の順序', () => {
  test('登録の順によらず、orderの小さい順に並べ、元の一覧を変えない', () => {
    const sections = Object.freeze([
      section('match-engine.qualifiers', 'main', 30),
      section('tournament-year.matches', 'main', 10),
      section('tournament-week.matches', 'main', 20),
    ]);

    const ordered = orderTopPageSections(sections);

    expect(ordered.map(({ id }) => id)).toStrictEqual([
      'tournament-year.matches',
      'tournament-week.matches',
      'match-engine.qualifiers',
    ]);
    expect(sections[0]?.id).toBe('match-engine.qualifiers');
  });

  test('同じorderの登録は、登録の順を保つ', () => {
    const sections = [
      section('a.first', 'banner', 20),
      section('b.second', 'banner', 20),
    ];

    expect(orderTopPageSections(sections).map(({ id }) => id)).toStrictEqual([
      'a.first',
      'b.second',
    ]);
  });
});

describe('トップページの区画の置き場所ごとの振り分け', () => {
  test('置き場所は上部の行・全幅の注目・本文・横の列・フッター直上の5つである', () => {
    expect(TOP_PAGE_PLACEMENTS).toStrictEqual([
      'banner',
      'showcase',
      'main',
      'aside',
      'bottom',
    ]);
  });

  test('区画を置き場所ごとに分け、置き場所の中はorderの小さい順に並べる', () => {
    const sections = Object.freeze([
      section('sponsorship.silver', 'bottom', 10),
      section('match-engine.qualifiers', 'main', 30),
      section('sponsorship.legend', 'banner', 20),
      section('sponsorship.gold', 'aside', 10),
      section('match-engine.countdown', 'banner', 10),
      section('tournament-year.final', 'showcase', 10),
      section('tournament-year.matches', 'main', 10),
    ]);

    const groups = groupTopPageSections(sections);
    const idsOf = (placement: TopPagePlacement) =>
      groups[placement].map(({ id }) => id);

    expect(idsOf('banner')).toStrictEqual([
      'match-engine.countdown',
      'sponsorship.legend',
    ]);
    expect(idsOf('showcase')).toStrictEqual(['tournament-year.final']);
    expect(idsOf('main')).toStrictEqual([
      'tournament-year.matches',
      'match-engine.qualifiers',
    ]);
    expect(idsOf('aside')).toStrictEqual(['sponsorship.gold']);
    expect(idsOf('bottom')).toStrictEqual(['sponsorship.silver']);
  });

  test('登録の無い置き場所は空の一覧にする', () => {
    const groups = groupTopPageSections([
      section('match-engine.qualifiers', 'main', 30),
    ]);

    expect(Object.keys(groups)).toStrictEqual([...TOP_PAGE_PLACEMENTS]);
    expect(groups.banner).toStrictEqual([]);
    expect(groups.showcase).toStrictEqual([]);
    expect(groups.aside).toStrictEqual([]);
    expect(groups.bottom).toStrictEqual([]);
  });

  test('登録が無ければ全ての置き場所が空になる', () => {
    const groups = groupTopPageSections([]);

    expect(TOP_PAGE_PLACEMENTS.every((p) => groups[p].length === 0)).toBe(true);
  });
});

describe('予選の一覧の差し込みの位置', () => {
  const CARDS = ['c1', 'c2', 'c3', 'c4', 'c5'];

  test('差し込みが無ければ対戦カードだけを順に並べる', () => {
    expect(describeItems(layoutQualifierList(CARDS, []))).toStrictEqual(CARDS);
  });

  test('指定の件数ごとに対戦カードの間へ差し込み、何番目の差し込みかを1から数える', () => {
    const items = layoutQualifierList(CARDS, [insert('sponsorship.gold', 2)]);

    expect(describeItems(items)).toStrictEqual([
      'c1',
      'c2',
      'sponsorship.gold#1',
      'c3',
      'c4',
      'sponsorship.gold#2',
      'c5',
    ]);
  });

  test('件数が間隔で割り切れるときは、最後の対戦カードの後にも差し込む', () => {
    const items = layoutQualifierList(
      ['c1', 'c2', 'c3', 'c4'],
      [insert('sponsorship.gold', 2)],
    );

    expect(describeItems(items)).toStrictEqual([
      'c1',
      'c2',
      'sponsorship.gold#1',
      'c3',
      'c4',
      'sponsorship.gold#2',
    ]);
  });

  test('割り切れない余りの対戦カードの後には差し込まない', () => {
    expect(
      describeItems(
        layoutQualifierList(
          ['c1', 'c2', 'c3'],
          [insert('sponsorship.gold', 2)],
        ),
      ),
    ).toStrictEqual(['c1', 'c2', 'sponsorship.gold#1', 'c3']);
  });

  test('対戦カードが指定の件数に満たなければ差し込まない', () => {
    expect(
      describeItems(
        layoutQualifierList(['c1'], [insert('sponsorship.gold', 2)]),
      ),
    ).toStrictEqual(['c1']);
    expect(
      describeItems(layoutQualifierList([], [insert('sponsorship.gold', 1)])),
    ).toStrictEqual([]);
  });

  test('1件ごとの差し込みは全ての対戦カードの後に入る', () => {
    expect(
      describeItems(
        layoutQualifierList(['c1', 'c2', 'c3'], [insert('a.every-card', 1)]),
      ),
    ).toStrictEqual([
      'c1',
      'a.every-card#1',
      'c2',
      'a.every-card#2',
      'c3',
      'a.every-card#3',
    ]);
  });

  test('一覧に置いた差し込みの数は、差し込みの回数と一致する', () => {
    for (const cardCount of [0, 1, 2, 3, 4, 5, 9]) {
      for (const every of [1, 2, 3, 4]) {
        const cards = Array.from(
          { length: cardCount },
          (_, i) => `c${String(i)}`,
        );
        const placed = layoutQualifierList(cards, [
          insert('a.x', every),
        ]).filter(({ kind }) => kind === 'insert').length;

        expect(placed).toBe(qualifierInsertCount(cardCount, every));
      }
    }
  });

  test('同じ位置に入る複数の差し込みはorderの小さい順に並べ、それぞれ自分の回数を数える', () => {
    const items = layoutQualifierList(CARDS, [
      insert('b.every-four', 4, 20),
      insert('a.every-two', 2, 10),
    ]);

    expect(describeItems(items)).toStrictEqual([
      'c1',
      'c2',
      'a.every-two#1',
      'c3',
      'c4',
      'a.every-two#2',
      'b.every-four#1',
      'c5',
    ]);
  });

  test('差し込みの間隔が1以上の整数でなければRangeErrorにする', () => {
    for (const every of [0, -2, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        layoutQualifierList(CARDS, [insert('a.bad', every)]),
      ).toThrow(RangeError);
    }
  });

  test('元の一覧を変えない', () => {
    const cards = Object.freeze(['c1', 'c2', 'c3']);
    const inserts = Object.freeze([
      insert('b.second', 1, 20),
      insert('a.first', 1, 10),
    ]);

    layoutQualifierList(cards, inserts);

    expect(cards).toStrictEqual(['c1', 'c2', 'c3']);
    expect(inserts.map(({ id }) => id)).toStrictEqual(['b.second', 'a.first']);
  });
});

describe('予選の一覧の差し込みの回数', () => {
  test.each([
    [0, 2, 0],
    [1, 2, 0],
    [2, 2, 1],
    [3, 2, 1],
    [4, 2, 2],
    [5, 2, 2],
    [3, 1, 3],
    [8, 3, 2],
  ])(
    '対戦カード%i件・%i件ごとなら%i回差し込む',
    (cardCount, every, expected) => {
      expect(qualifierInsertCount(cardCount, every)).toBe(expected);
    },
  );

  test('差し込みの間隔が1以上の整数でなければRangeErrorにする', () => {
    for (const every of [0, -2, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => qualifierInsertCount(4, every)).toThrow(RangeError);
    }
  });

  test('対戦カードの件数が0以上の整数でなければRangeErrorにする', () => {
    for (const cardCount of [-1, 2.5, Number.NaN]) {
      expect(() => qualifierInsertCount(cardCount, 2)).toThrow(RangeError);
    }
  });
});
