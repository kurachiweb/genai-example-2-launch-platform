import { describe, expect, test } from 'bun:test';

import {
  directoryPaginationItems,
  type DirectoryPaginationItem,
} from './directory-pagination-items.ts';

// 期待値を「1 … 4 5 6 … 62」のように読める形で書くための変換
const shapeOf = (items: readonly DirectoryPaginationItem[]): string =>
  items
    .map((item) => (item.kind === 'gap' ? '…' : String(item.page)))
    .join(' ');

describe('directoryPaginationItems', () => {
  test('先頭・末尾・現在のページの前後1つを並べ、2ページ以上空く間を省略の印にする', () => {
    expect(shapeOf(directoryPaginationItems(5, 62))).toBe('1 … 4 5 6 … 62');
  });

  test('先頭のページでは前のページを出さず、次のページと末尾の間を省く', () => {
    expect(shapeOf(directoryPaginationItems(1, 62))).toBe('1 2 … 62');
  });

  test('末尾のページでは次のページを出さず、先頭と前のページの間を省く', () => {
    expect(shapeOf(directoryPaginationItems(62, 62))).toBe('1 … 61 62');
  });

  test('先頭との間が1ページ分だけ空くときは省かずにその番号を出す', () => {
    expect(shapeOf(directoryPaginationItems(4, 62))).toBe('1 2 3 4 5 … 62');
  });

  test('末尾との間が1ページ分だけ空くときは省かずにその番号を出す', () => {
    expect(shapeOf(directoryPaginationItems(59, 62))).toBe(
      '1 … 58 59 60 61 62',
    );
  });

  test('先頭と隣り合うときは間を空けずに並べる', () => {
    expect(shapeOf(directoryPaginationItems(3, 62))).toBe('1 2 3 4 … 62');
  });

  test('両側とも1ページ分だけ空くときは全てのページを並べる', () => {
    expect(shapeOf(directoryPaginationItems(4, 7))).toBe('1 2 3 4 5 6 7');
  });

  test('ページが少ないときは同じページを重ねずに並べる', () => {
    expect(shapeOf(directoryPaginationItems(1, 2))).toBe('1 2');
    expect(shapeOf(directoryPaginationItems(2, 3))).toBe('1 2 3');
    expect(shapeOf(directoryPaginationItems(1, 1))).toBe('1');
  });

  test('現在のページを印付きで返す', () => {
    expect(directoryPaginationItems(2, 3)).toStrictEqual([
      { kind: 'page', page: 1, current: false },
      { kind: 'page', page: 2, current: true },
      { kind: 'page', page: 3, current: false },
    ]);
  });

  test('省略の印は直前のページの番号を持ち、並びの中で区別できる', () => {
    expect(
      directoryPaginationItems(5, 62).filter((item) => item.kind === 'gap'),
    ).toStrictEqual([
      { kind: 'gap', after: 1 },
      { kind: 'gap', after: 6 },
    ]);
  });
});
