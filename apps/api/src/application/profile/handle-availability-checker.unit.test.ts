import { describe, expect, test } from 'bun:test';

import { StoreHandleAvailabilityChecker } from './handle-availability-checker.ts';
import {
  createFakeProfileStore,
  type FakeProfileStoreOptions,
  snapshotOf,
  USER_ID,
} from './testing/profile-fakes.ts';

function setup(options: FakeProfileStoreOptions = {}) {
  const calls: string[] = [];
  const store = createFakeProfileStore(calls, options);
  return { checker: new StoreHandleAvailabilityChecker(store), store, calls };
}

describe('StoreHandleAvailabilityChecker.check', () => {
  test.each([
    ['空', ''],
    ['26文字', 'a'.repeat(26)],
    ['先頭のハイフン', '-alice'],
    ['空白', 'a b'],
    ['全角', 'ａｌｉｃｅ'],
  ])('形式違反(%s)はinvalidで、ポートに触れない', async (_label, handle) => {
    const { checker, calls } = setup();

    expect(await checker.check(USER_ID, handle)).toBe('invalid');
    expect(calls).toEqual([]);
  });

  test('本人の現在のハンドルは、大文字小文字の違いを含めて使用中の問い合わせなしでavailableになる', async () => {
    const { checker, store } = setup({
      snapshot: snapshotOf({ handle: 'Alice' }),
      occupiedHandles: ['alice'],
    });

    expect(await checker.check(USER_ID, 'ALICE')).toBe('available');
    expect(store.occupiedQueries).toEqual([]);
  });

  test('本人の保持中の旧ハンドルは予約語でも使用中でもavailableになる', async () => {
    const { checker, store } = setup({
      snapshot: snapshotOf({ handle: 'alice2', previousHandle: 'Support' }),
      occupiedHandles: ['support'],
    });

    expect(await checker.check(USER_ID, 'support')).toBe('available');
    expect(store.occupiedQueries).toEqual([]);
  });

  test('予約語はunavailableで、使用中の問い合わせをしない', async () => {
    const { checker, store } = setup();

    expect(await checker.check(USER_ID, 'Admin')).toBe('unavailable');
    expect(store.occupiedQueries).toEqual([]);
  });

  test('他人の現在のハンドルはunavailableになり、本人を除いて問い合わせる', async () => {
    const { checker, store } = setup({ occupiedHandles: ['bob'] });

    expect(await checker.check(USER_ID, 'Bob')).toBe('unavailable');
    expect(store.occupiedQueries).toEqual([
      { handle: 'Bob', options: { exceptUserId: USER_ID } },
    ]);
  });

  test('他人の旧ハンドルなど誰も現在使っていない文字列はavailableになる', async () => {
    const { checker } = setup({ occupiedHandles: ['bob'] });

    expect(await checker.check(USER_ID, 'bob-previous')).toBe('available');
  });

  test('利用者の行が無くても形式・予約語・使用中だけで判定する', async () => {
    const { checker } = setup({
      snapshot: undefined,
      occupiedHandles: ['bob'],
    });

    expect(await checker.check(USER_ID, 'bob')).toBe('unavailable');
    expect(await checker.check(USER_ID, 'carol')).toBe('available');
  });
});
