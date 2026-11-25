import { describe, expect, test } from 'bun:test';

import { chunk, IDS_PER_STATEMENT } from './statement-chunks.ts';

describe('chunk', () => {
  test('先頭から指定の件数ずつに分け、最後の組に残りを入れる', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test('件数で割り切れるときは同じ大きさの組だけにする', () => {
    expect(chunk(['a', 'b', 'c', 'd'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  test('空の一覧は組を作らない', () => {
    expect(chunk([], 90)).toEqual([]);
  });

  test('元の一覧を書き換えない', () => {
    const items = Object.freeze([1, 2, 3]);
    expect(chunk(items, 2)).toEqual([[1, 2], [3]]);
    expect(items).toEqual([1, 2, 3]);
  });
});

describe('IDS_PER_STATEMENT', () => {
  test('D1のバインド変数の上限(100)から他の条件の分を残した90件にする', () => {
    expect(IDS_PER_STATEMENT).toBe(90);
    const ids = Array.from({ length: 181 }, (_, index) => String(index));
    expect(chunk(ids, IDS_PER_STATEMENT).map((part) => part.length)).toEqual([
      90, 90, 1,
    ]);
  });
});
