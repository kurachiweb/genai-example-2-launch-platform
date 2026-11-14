import { describe, expect, test } from 'bun:test';

import {
  groupPublishedArticles,
  moveItem,
  sortHelpArticles,
  sortHelpCategories,
  splitPinnedGroups,
} from './help-ordering.ts';

interface Category {
  readonly id: string;
  readonly sortOrder: number;
  readonly createdAt: Date;
}

interface Article {
  readonly id: string;
  readonly categoryId: string;
  readonly pinned: boolean;
  readonly sortOrder: number;
  readonly createdAt: Date;
}

const category = (
  id: string,
  sortOrder: number,
  createdAt = '2026-11-01T00:00:00Z',
): Category => ({ id, sortOrder, createdAt: new Date(createdAt) });

const article = (
  id: string,
  options: {
    readonly categoryId?: string;
    readonly pinned?: boolean;
    readonly sortOrder: number;
    readonly createdAt?: string;
  },
): Article => ({
  id,
  categoryId: options.categoryId ?? 'cat-a',
  pinned: options.pinned ?? false,
  sortOrder: options.sortOrder,
  createdAt: new Date(options.createdAt ?? '2026-11-01T00:00:00Z'),
});

const idsOf = (items: readonly { readonly id: string }[]): string[] =>
  items.map((item) => item.id);

describe('sortHelpCategories', () => {
  test('カテゴリを並び順の昇順に並べる', () => {
    const categories = [
      category('cat-c', 3),
      category('cat-a', 1),
      category('cat-b', 2),
    ];

    expect(idsOf(sortHelpCategories(categories))).toEqual([
      'cat-a',
      'cat-b',
      'cat-c',
    ]);
  });

  test('並び順が同じカテゴリは作成の古い順に並べる', () => {
    const categories = [
      category('cat-a', 1, '2026-11-03T00:00:00Z'),
      category('cat-b', 1, '2026-11-01T00:00:00Z'),
      category('cat-c', 1, '2026-11-02T00:00:00Z'),
    ];

    expect(idsOf(sortHelpCategories(categories))).toEqual([
      'cat-b',
      'cat-c',
      'cat-a',
    ]);
  });

  test('並び順と作成日時が同じカテゴリはIDの昇順に並べる', () => {
    const categories = [category('cat-b', 1), category('cat-a', 1)];

    expect(idsOf(sortHelpCategories(categories))).toEqual(['cat-a', 'cat-b']);
  });

  test('元の配列を変えず、要素の他の項目を保つ', () => {
    const named = { ...category('cat-b', 2), name: 'アカウント' };
    const categories = [named, category('cat-a', 1)];

    const sorted = sortHelpCategories(categories);

    expect(idsOf(categories)).toEqual(['cat-b', 'cat-a']);
    expect(sorted[1]).toBe(named);
  });

  test('標準カテゴリも末尾へ固定せず並び順の値どおりに並べる', () => {
    const other = { ...category('cat-other', 1), systemDefault: true };
    const categories = [category('cat-a', 2), other, category('cat-b', 3)];

    const sorted = sortHelpCategories(categories);

    expect(idsOf(sorted)).toEqual(['cat-other', 'cat-a', 'cat-b']);
  });
});

describe('sortHelpArticles', () => {
  test('ピン留めの群を先頭にし、各群を記事の並び順の昇順に並べる', () => {
    const articles = [
      article('other-1', { sortOrder: 1 }),
      article('pinned-4', { pinned: true, sortOrder: 4 }),
      article('other-3', { sortOrder: 3 }),
      article('pinned-2', { pinned: true, sortOrder: 2 }),
    ];

    expect(idsOf(sortHelpArticles(articles))).toEqual([
      'pinned-2',
      'pinned-4',
      'other-1',
      'other-3',
    ]);
  });

  test('並び順が同じ記事は作成の古い順、さらにIDの昇順に並べる', () => {
    const articles = [
      article('art-c', { sortOrder: 1, createdAt: '2026-11-01T00:00:00Z' }),
      article('art-b', { sortOrder: 1, createdAt: '2026-11-02T00:00:00Z' }),
      article('art-a', { sortOrder: 1, createdAt: '2026-11-02T00:00:00Z' }),
    ];

    expect(idsOf(sortHelpArticles(articles))).toEqual([
      'art-c',
      'art-a',
      'art-b',
    ]);
  });

  test('ピン留めを切り替えた記事は並び順の値のまま新しい群の中の相対的な位置に入る', () => {
    const before = [
      article('art-1', { pinned: true, sortOrder: 1 }),
      article('art-2', { sortOrder: 2 }),
      article('art-3', { pinned: true, sortOrder: 3 }),
      article('art-4', { sortOrder: 4 }),
    ];
    const after = before.map((item) =>
      item.id === 'art-2' ? { ...item, pinned: true } : item,
    );

    expect(idsOf(sortHelpArticles(after))).toEqual([
      'art-1',
      'art-2',
      'art-3',
      'art-4',
    ]);
  });

  test('元の配列を変えない', () => {
    const articles = [
      article('art-b', { sortOrder: 2 }),
      article('art-a', { sortOrder: 1 }),
    ];

    sortHelpArticles(articles);

    expect(idsOf(articles)).toEqual(['art-b', 'art-a']);
  });
});

describe('splitPinnedGroups', () => {
  test('ピン留めの群とそれ以外の群に分け、各群を記事の並び順で並べる', () => {
    const articles = [
      article('other-2', { sortOrder: 2 }),
      article('pinned-3', { pinned: true, sortOrder: 3 }),
      article('other-1', { sortOrder: 1 }),
      article('pinned-1', { pinned: true, sortOrder: 1 }),
    ];

    const groups = splitPinnedGroups(articles);

    expect(idsOf(groups.pinned)).toEqual(['pinned-1', 'pinned-3']);
    expect(idsOf(groups.others)).toEqual(['other-1', 'other-2']);
  });

  test('ピン留めの記事が無ければピン留めの群は空になる', () => {
    const groups = splitPinnedGroups([article('art-1', { sortOrder: 1 })]);

    expect(groups.pinned).toEqual([]);
    expect(idsOf(groups.others)).toEqual(['art-1']);
  });
});

describe('groupPublishedArticles', () => {
  test('カテゴリの並び順で並べ、各カテゴリの記事をピン留めの群を先頭に並べる', () => {
    const categories = [category('cat-b', 2), category('cat-a', 1)];
    const articles = [
      article('b-other', { categoryId: 'cat-b', sortOrder: 1 }),
      article('a-other', { categoryId: 'cat-a', sortOrder: 1 }),
      article('a-pinned', { categoryId: 'cat-a', pinned: true, sortOrder: 2 }),
    ];

    const groups = groupPublishedArticles(categories, articles);

    expect(
      groups.map((group) => ({
        category: group.category.id,
        articles: idsOf(group.articles),
      })),
    ).toEqual([
      { category: 'cat-a', articles: ['a-pinned', 'a-other'] },
      { category: 'cat-b', articles: ['b-other'] },
    ]);
  });

  test('公開の記事が1件も無いカテゴリを除く', () => {
    const categories = [
      category('cat-a', 1),
      category('cat-empty', 2),
      category('cat-c', 3),
    ];
    const articles = [
      article('a-1', { categoryId: 'cat-a', sortOrder: 1 }),
      article('c-1', { categoryId: 'cat-c', sortOrder: 1 }),
    ];

    expect(
      groupPublishedArticles(categories, articles).map(
        (group) => group.category.id,
      ),
    ).toEqual(['cat-a', 'cat-c']);
  });

  test('記事が無ければ空の一覧を返す', () => {
    expect(groupPublishedArticles([category('cat-a', 1)], [])).toEqual([]);
  });

  test('結果を順にたどってピン留めの記事だけを取り出すとフッター用の順になる', () => {
    const categories = [category('cat-b', 2), category('cat-a', 1)];
    const articles = [
      article('b-pinned-1', {
        categoryId: 'cat-b',
        pinned: true,
        sortOrder: 1,
      }),
      article('a-pinned-3', {
        categoryId: 'cat-a',
        pinned: true,
        sortOrder: 3,
      }),
      article('a-other-1', { categoryId: 'cat-a', sortOrder: 1 }),
      article('a-pinned-2', {
        categoryId: 'cat-a',
        pinned: true,
        sortOrder: 2,
      }),
    ];

    const footer = groupPublishedArticles(categories, articles).flatMap(
      (group) => group.articles.filter((item) => item.pinned),
    );

    expect(idsOf(footer)).toEqual(['a-pinned-2', 'a-pinned-3', 'b-pinned-1']);
  });
});

describe('moveItem', () => {
  const items = ['a', 'b', 'c'] as const;

  test('upで1つ前の要素と入れ替える', () => {
    expect(moveItem(items, 1, 'up')).toEqual(['b', 'a', 'c']);
  });

  test('downで1つ後の要素と入れ替える', () => {
    expect(moveItem(items, 1, 'down')).toEqual(['a', 'c', 'b']);
  });

  test('先頭のupと末尾のdownでは順を変えず、新しい配列を返す', () => {
    const top = moveItem(items, 0, 'up');
    const bottom = moveItem(items, 2, 'down');

    expect(top).toEqual(['a', 'b', 'c']);
    expect(bottom).toEqual(['a', 'b', 'c']);
    expect(top).not.toBe(items);
    expect(bottom).not.toBe(items);
  });

  test('範囲外の位置では順を変えない', () => {
    expect(moveItem(items, -1, 'down')).toEqual(['a', 'b', 'c']);
    expect(moveItem(items, 3, 'up')).toEqual(['a', 'b', 'c']);
  });

  test('元の配列を変えない', () => {
    const source = ['a', 'b', 'c'];

    moveItem(source, 0, 'down');

    expect(source).toEqual(['a', 'b', 'c']);
  });
});
