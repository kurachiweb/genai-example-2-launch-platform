import { describe, expect, test } from 'bun:test';

import { StoreProductHandleAvailabilityChecker } from './product-handle-availability-checker.ts';
import { PRODUCT_ID, snapshotOf } from './testing/product-editor-fixtures.ts';
import {
  createFakeProductStore,
  currentUserOf,
  type FakeProductStoreOptions,
  fixedClock,
} from './testing/product-fakes.ts';

const OTHER_USER_ID = '01JC0USER00000000000000002';

function setup(options: FakeProductStoreOptions = {}) {
  const calls: string[] = [];
  const store = createFakeProductStore(calls, {
    snapshots: [snapshotOf({ previousHandle: 'old-meter' })],
    ...options,
  });
  return {
    checker: new StoreProductHandleAvailabilityChecker(store, fixedClock),
    store,
    calls,
  };
}

const user = currentUserOf();

describe('StoreProductHandleAvailabilityChecker.check', () => {
  test.each([
    ['空', ''],
    ['51文字', 'a'.repeat(51)],
    ['先頭のハイフン', '-meter'],
    ['空白', 'launch meter'],
    ['全角', 'ｌａｕｎｃｈ'],
  ])('形式違反(%s)はinvalidで、ストアに触れない', async (_label, handle) => {
    const { checker, calls } = setup();

    expect(await checker.check(user, handle, 'launch-meter')).toBe('invalid');
    expect(calls).toEqual([]);
  });

  test('50文字は形式に合う', async () => {
    const { checker } = setup();

    expect(await checker.check(user, 'a'.repeat(50), undefined)).toBe(
      'available',
    );
  });

  test('編集中のプロダクトの現在のハンドルは、大文字小文字の違いを含めて使用中の問い合わせなしでavailableになる', async () => {
    const { checker, store } = setup({ occupiedHandles: ['launch-meter'] });

    expect(await checker.check(user, 'Launch-Meter', 'launch-meter')).toBe(
      'available',
    );
    expect(store.occupiedChecks).toEqual([]);
  });

  test('編集中のプロダクトの保持中の旧ハンドルは、予約語や使用中の判定をせずにavailableになる', async () => {
    const { checker, store } = setup({
      snapshots: [snapshotOf({ previousHandle: 'Support' })],
    });

    expect(await checker.check(user, 'support', 'launch-meter')).toBe(
      'available',
    );
    expect(store.occupiedChecks).toEqual([]);
  });

  test('予約語は大文字小文字を区別せずunavailableで、使用中の問い合わせをしない', async () => {
    const { checker, store } = setup();

    expect(await checker.check(user, 'Admin', 'launch-meter')).toBe(
      'unavailable',
    );
    expect(store.occupiedChecks).toEqual([]);
  });

  test('他のプロダクトの現在のハンドルはunavailableで、編集中のプロダクトを除いて問い合わせる', async () => {
    const { checker, store } = setup({ occupiedHandles: ['rival'] });

    expect(await checker.check(user, 'Rival', 'launch-meter')).toBe(
      'unavailable',
    );
    expect(store.occupiedChecks).toEqual([
      { handle: 'Rival', exceptProductId: PRODUCT_ID },
    ]);
  });

  test('他のプロダクトの旧ハンドルは使用中に数えないため、availableになる', async () => {
    const { checker, store } = setup({
      snapshots: [
        snapshotOf({ previousHandle: 'old-meter' }),
        snapshotOf({
          productId: '01JD0PRODUCT00000000000002',
          ownerUserId: OTHER_USER_ID,
          handle: 'rival',
          previousHandle: 'old-rival',
        }),
      ],
      occupiedHandles: ['launch-meter', 'rival'],
    });

    expect(await checker.check(user, 'old-rival', 'launch-meter')).toBe(
      'available',
    );
    expect(store.occupiedChecks).toEqual([
      { handle: 'old-rival', exceptProductId: PRODUCT_ID },
    ]);
  });

  test('登録(編集中のプロダクトの指定なし)では、自分のプロダクトを読まずに全てのプロダクトの現在のハンドルと比べる', async () => {
    const { checker, store, calls } = setup({
      occupiedHandles: ['launch-meter'],
    });

    expect(await checker.check(user, 'launch-meter', undefined)).toBe(
      'unavailable',
    );
    expect(await checker.check(user, 'old-meter', undefined)).toBe('available');
    expect(calls).not.toContain('store.findForOwner');
    expect(store.occupiedChecks).toEqual([
      { handle: 'launch-meter', exceptProductId: undefined },
      { handle: 'old-meter', exceptProductId: undefined },
    ]);
  });

  test.each<[string, FakeProductStoreOptions]>([
    [
      '他人のプロダクト',
      {
        snapshots: [snapshotOf({ ownerUserId: OTHER_USER_ID })],
        occupiedHandles: ['launch-meter'],
      },
    ],
    [
      '論理削除した自分のプロダクト',
      {
        deletedProductIds: [PRODUCT_ID],
        occupiedHandles: ['launch-meter'],
      },
    ],
  ])(
    '編集中のプロダクトの指定が%sなら、登録と同じく全てのプロダクトの現在のハンドルと比べる',
    async (_label, options) => {
      const { checker, store } = setup(options);

      expect(await checker.check(user, 'launch-meter', 'launch-meter')).toBe(
        'unavailable',
      );
      expect(store.occupiedChecks).toEqual([
        { handle: 'launch-meter', exceptProductId: undefined },
      ]);
    },
  );
});
