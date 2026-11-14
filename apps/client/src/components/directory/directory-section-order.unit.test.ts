import { describe, expect, test } from 'bun:test';

import {
  DIRECTORY_PLACEMENTS,
  groupDirectorySections,
  layoutDirectoryList,
} from './directory-section-order.ts';
import type {
  DirectoryListInsert,
  DirectoryPlacement,
  DirectorySection,
} from './directory-section-types.ts';

const nothing = (): null => null;

const sectionOf = (
  id: string,
  placement: DirectoryPlacement,
  order: number,
): DirectorySection => ({ id, placement, order, component: nothing });

const insertOf = (
  id: string,
  every: number,
  order = 10,
): DirectoryListInsert => ({ id, every, order, component: nothing });

const shapeOf = (
  items: ReturnType<typeof layoutDirectoryList<string>>,
): readonly string[] =>
  items.map((item) =>
    item.kind === 'item'
      ? item.item
      : `${item.insert.id}#${String(item.position)}`,
  );

describe('DIRECTORY_PLACEMENTS', () => {
  test('置き場所はページの上から順に3つ', () => {
    expect([...DIRECTORY_PLACEMENTS]).toStrictEqual([
      'banner',
      'aside',
      'bottom',
    ]);
  });
});

describe('groupDirectorySections', () => {
  test('区画を置き場所ごとに分け、それぞれorderの小さい順に並べる', () => {
    const groups = groupDirectorySections([
      sectionOf('ads.bottom', 'bottom', 10),
      sectionOf('ads.aside-late', 'aside', 30),
      sectionOf('ads.banner', 'banner', 10),
      sectionOf('ads.aside-early', 'aside', 10),
    ]);

    expect(groups.banner.map(({ id }) => id)).toStrictEqual(['ads.banner']);
    expect(groups.aside.map(({ id }) => id)).toStrictEqual([
      'ads.aside-early',
      'ads.aside-late',
    ]);
    expect(groups.bottom.map(({ id }) => id)).toStrictEqual(['ads.bottom']);
  });
});

describe('layoutDirectoryList', () => {
  test('指定の件数ごとに差し込み、1から数えた位置を渡す', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];

    expect(
      shapeOf(layoutDirectoryList(items, [insertOf('ads.inline', 2)])),
    ).toStrictEqual(['a', 'b', 'ads.inline#1', 'c', 'd', 'ads.inline#2', 'e']);
  });

  test('件数が割り切れるときは最後の項目の後にも差し込む', () => {
    expect(
      shapeOf(
        layoutDirectoryList(['a', 'b', 'c', 'd'], [insertOf('ads.inline', 2)]),
      ),
    ).toStrictEqual(['a', 'b', 'ads.inline#1', 'c', 'd', 'ads.inline#2']);
  });

  test('同じ位置の差し込みはorderの小さい順に並べる', () => {
    expect(
      shapeOf(
        layoutDirectoryList(
          ['a', 'b'],
          [insertOf('ads.late', 2, 20), insertOf('ads.early', 1, 10)],
        ),
      ),
    ).toStrictEqual(['a', 'ads.early#1', 'b', 'ads.early#2', 'ads.late#1']);
  });

  test('項目が無ければ差し込まない', () => {
    expect(layoutDirectoryList([], [insertOf('ads.inline', 1)])).toStrictEqual(
      [],
    );
  });

  test('差し込みの間隔が1以上の整数でなければ例外にする', () => {
    expect(() =>
      layoutDirectoryList(['a'], [insertOf('ads.inline', 0)]),
    ).toThrow(RangeError);
    expect(() =>
      layoutDirectoryList(['a'], [insertOf('ads.inline', 1.5)]),
    ).toThrow(RangeError);
  });
});
