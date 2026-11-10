import { describe, expect, test } from 'bun:test';

import { FOLLOW_UP_REFETCH_LIMIT, updateCountOf } from './follow-up-refetch.ts';

describe('updateCountOf', () => {
  test('取得の成功と失敗の更新の回数の和を返し、取得が無ければ0にする', () => {
    expect(updateCountOf({ dataUpdateCount: 3, errorUpdateCount: 2 })).toBe(5);
    expect(updateCountOf(undefined)).toBe(0);
  });
});

describe('FOLLOW_UP_REFETCH_LIMIT', () => {
  test('上限は10回である', () => {
    expect(FOLLOW_UP_REFETCH_LIMIT).toBe(10);
  });
});
