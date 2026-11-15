import { describe, expect, test } from 'bun:test';

import type { LaunchRecord } from '../../../lib/core/product/ports.ts';
import { fromBusinessDateTime } from '../../../lib/core/time/business-time.ts';
import { computeLaunchDateWindow } from '../../domain/product/launch-date-rules.ts';
import { toMyProductView } from './my-product-view.ts';
import { encodeMyProductsCursor } from './my-products-cursor.ts';
import { StoreMyProductsReader } from './my-products-reader.ts';
import type { ProductSnapshot } from './ports.ts';
import { PRODUCT_STATE_BATCH_MAX } from './product-state-evaluator.ts';
import type { ProductState } from './product-state-evaluator.ts';
import {
  day,
  FINISHED_LAUNCH,
  NEW_PLAN,
  PRODUCT_ID,
  rejectionOf,
  snapshotOf,
  stateWith,
} from './testing/product-editor-fixtures.ts';
import {
  createFakeProductStore,
  createFakeStateEvaluator,
  currentUserOf,
  type FakeProductStoreOptions,
  fixedClock,
  PRODUCT_NOW,
  USER_ID,
} from './testing/product-fakes.ts';

const OTHER_USER_ID = '01JC0USER00000000000000002';

const productIdOf = (index: number): string =>
  `01JD0PRODUCT${String(index).padStart(14, '0')}`;

const launchOf = (productId: string, launchDate: string): LaunchRecord => ({
  ...FINISHED_LAUNCH,
  launchId: `01JD0LAUNCH${productId.slice(-15)}`,
  productId,
  launchDate: day(launchDate),
});

// 番号が大きいほど最新のローンチ日が新しい
const listedSnapshotOf = (index: number): ProductSnapshot => {
  const productId = productIdOf(index);
  return snapshotOf({
    productId,
    handle: `product-${String(index)}`,
    launches: [
      launchOf(productId, `2026-09-${String(index).padStart(2, '0')}`),
    ],
  });
};

const stateFor = (productId: string): ProductState => ({
  ...stateWith(NEW_PLAN),
  productId,
});

function setup(options: FakeProductStoreOptions = {}) {
  const calls: string[] = [];
  const store = createFakeProductStore(calls, options);
  const fakeEvaluator = createFakeStateEvaluator(calls, stateFor);
  const reader = new StoreMyProductsReader(
    store,
    fakeEvaluator.evaluator,
    fixedClock,
  );
  return { reader, store, calls, ...fakeEvaluator };
}

const user = currentUserOf();

describe('StoreMyProductsReader.list', () => {
  const ownSnapshots = Array.from({ length: 21 }, (_, index) =>
    listedSnapshotOf(index + 1),
  );
  const others = [
    {
      ...listedSnapshotOf(28),
      ownerUserId: OTHER_USER_ID,
    },
    listedSnapshotOf(29),
  ];
  const options: FakeProductStoreOptions = {
    snapshots: [...ownSnapshots, ...others],
    deletedProductIds: [productIdOf(29)],
  };

  test('先頭のページは、論理削除していない自分のプロダクトを最新のローンチ日の新しい順に20件と続きの有無を返し、状態の判定を1回だけ呼ぶ', async () => {
    const { reader, store, requests, calls } = setup(options);

    const page = await reader.list(user, { first: 20, after: undefined });

    expect(store.listRequests).toEqual([
      {
        ownerUserId: USER_ID,
        limit: 21,
        before: undefined,
        now: PRODUCT_NOW,
      },
    ]);
    expect(page.nodes.map(({ productId }) => productId)).toEqual(
      Array.from({ length: 20 }, (_, index) => productIdOf(21 - index)),
    );
    expect(page.hasNextPage).toBe(true);
    expect(page.endCursor).toBe(
      encodeMyProductsCursor({
        latestLaunchDate: day('2026-09-02'),
        id: productIdOf(2),
      }),
    );
    expect(calls.filter((call) => call === 'evaluator.evaluate')).toHaveLength(
      1,
    );
    expect(requests).toEqual([
      {
        ownerUserId: USER_ID,
        products: page.nodes.map(({ productId }) => {
          const snapshot = ownSnapshots.find(
            (own) => own.productId === productId,
          );
          return {
            productId,
            hidden: false,
            launches: snapshot?.launches ?? [],
          };
        }),
        at: PRODUCT_NOW,
      },
    ]);
  });

  test('各項目は、ストアの内容と判定した状態と投稿者から組み立てた自分のプロダクトの表示になる', async () => {
    const suspended = currentUserOf({ status: 'suspended' });
    const { reader } = setup(options);

    const page = await reader.list(suspended, { first: 1, after: undefined });

    const [snapshot] = ownSnapshots.slice(-1);
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) {
      return;
    }
    expect(page.nodes).toEqual([
      toMyProductView(snapshot, stateFor(snapshot.productId), suspended.user),
    ]);
    expect(page.nodes[0]?.listed).toBe(false);
  });

  test('前のページの終わりのカーソルを渡すと、その位置より後から続きを返し、最後のページでは続きが無い', async () => {
    const { reader, store, calls } = setup(options);
    const first = await reader.list(user, { first: 20, after: undefined });

    const second = await reader.list(user, {
      first: 20,
      after: first.endCursor ?? undefined,
    });

    expect(store.listRequests[1]?.before).toEqual({
      latestLaunchDate: day('2026-09-02'),
      id: productIdOf(2),
    });
    expect(second.nodes.map(({ productId }) => productId)).toEqual([
      productIdOf(1),
    ]);
    expect(second.hasNextPage).toBe(false);
    expect(second.endCursor).toBe(
      encodeMyProductsCursor({
        latestLaunchDate: day('2026-09-01'),
        id: productIdOf(1),
      }),
    );
    expect(calls.filter((call) => call === 'evaluator.evaluate')).toHaveLength(
      2,
    );
  });

  test('カーソルの位置は、取消を含む最新のローンチ日にする', async () => {
    const canceled: LaunchRecord = {
      ...launchOf(PRODUCT_ID, '2026-11-05'),
      launchId: '01JD0LAUNCH000000000000002',
      number: 0,
      status: 'canceled',
      outcome: null,
      decidedAt: null,
    };
    const { reader } = setup({
      snapshots: [snapshotOf({ launches: [canceled, FINISHED_LAUNCH] })],
    });

    const page = await reader.list(user, { first: 20, after: undefined });

    expect(page.endCursor).toBe(
      encodeMyProductsCursor({
        latestLaunchDate: day('2026-11-05'),
        id: PRODUCT_ID,
      }),
    );
  });

  test('自分のプロダクトが無ければ、空の一覧と続きの無いことと空のカーソルを返す', async () => {
    const { reader } = setup({ ...options, snapshots: others });

    expect(await reader.list(user, { first: 20, after: undefined })).toEqual({
      nodes: [],
      hasNextPage: false,
      endCursor: null,
    });
  });

  test('読めないカーソルはinvalid_cursorで拒否し、ストアを読まない', async () => {
    const { reader, calls } = setup(options);

    const error = await rejectionOf(
      reader.list(user, { first: 20, after: 'not-a-cursor' }),
    );

    expect(error).toMatchObject({ code: 'invalid_cursor' });
    expect(calls).toEqual([]);
  });

  test.each([0, PRODUCT_STATE_BATCH_MAX + 1])(
    '件数%iは状態の判定の上限の範囲外のため、ストアを読まずにRangeErrorにする',
    async (first) => {
      const { reader, calls } = setup(options);

      let rejection: unknown;
      try {
        await reader.list(user, { first, after: undefined });
      } catch (error: unknown) {
        rejection = error;
      }

      expect(rejection).toBeInstanceOf(RangeError);
      expect(calls).toEqual([]);
    },
  );
});

describe('StoreMyProductsReader.find', () => {
  test('自分のプロダクトの現在のハンドルなら、状態付きの表示を返す', async () => {
    const snapshot = snapshotOf();
    const { reader, requests } = setup({ snapshots: [snapshot] });

    expect(await reader.find(user, 'launch-meter')).toEqual({
      kind: 'product',
      product: toMyProductView(snapshot, stateFor(PRODUCT_ID), user.user),
    });
    expect(requests).toEqual([
      {
        ownerUserId: USER_ID,
        products: [
          { productId: PRODUCT_ID, hidden: false, launches: [FINISHED_LAUNCH] },
        ],
        at: PRODUCT_NOW,
      },
    ]);
  });

  test('自分のプロダクトの旧ハンドルなら、状態を判定せずに現在のハンドルへの転送を返す', async () => {
    const { reader, calls } = setup({
      snapshots: [snapshotOf({ previousHandle: 'old-meter' })],
    });

    expect(await reader.find(user, 'Old-Meter')).toEqual({
      kind: 'redirect',
      handle: 'launch-meter',
    });
    expect(calls).not.toContain('evaluator.evaluate');
  });

  test.each<[string, FakeProductStoreOptions, string]>([
    [
      '他人のプロダクトの現在のハンドル',
      { snapshots: [snapshotOf({ ownerUserId: OTHER_USER_ID })] },
      'launch-meter',
    ],
    [
      '他人のプロダクトの旧ハンドル',
      {
        snapshots: [
          snapshotOf({
            ownerUserId: OTHER_USER_ID,
            previousHandle: 'old-meter',
          }),
        ],
      },
      'old-meter',
    ],
    [
      '論理削除した自分のプロダクトの現在のハンドル',
      { snapshots: [snapshotOf()], deletedProductIds: [PRODUCT_ID] },
      'launch-meter',
    ],
    [
      '論理削除した自分のプロダクトの旧ハンドル',
      {
        snapshots: [snapshotOf({ previousHandle: 'old-meter' })],
        deletedProductIds: [PRODUCT_ID],
      },
      'old-meter',
    ],
    ['存在しないハンドル', { snapshots: [snapshotOf()] }, 'unknown-product'],
  ])('%sはnot-foundになる', async (_label, options, handle) => {
    const { reader, calls } = setup(options);

    expect(await reader.find(user, handle)).toEqual({ kind: 'not-found' });
    expect(calls).not.toContain('evaluator.evaluate');
  });

  test.each(['', '-launch', 'a'.repeat(51), 'ローンチ'])(
    '形式に合わないハンドル「%s」は、ストアを読まずにnot-foundになる',
    async (handle) => {
      const { reader, calls } = setup({ snapshots: [snapshotOf()] });

      expect(await reader.find(user, handle)).toEqual({ kind: 'not-found' });
      expect(calls).toEqual([]);
    },
  );
});

describe('StoreMyProductsReader.newProductWindow', () => {
  test('基準のローンチの無い登録の選べる日を、指定の時点から求める', () => {
    const { reader, calls } = setup();

    const window = reader.newProductWindow(user, PRODUCT_NOW);

    expect(window).toEqual(
      computeLaunchDateWindow({
        now: PRODUCT_NOW,
        basis: null,
        entitled: false,
      }),
    );
    expect(window.earliest).toBe(day('2026-10-24'));
    expect(window.latest).toBe(day('2027-01-21'));
    expect(calls).toEqual([]);
  });

  test('選択の締め切りの後は、選べる最も早い日が2日後になる', () => {
    const { reader } = setup();
    const lateNight = fromBusinessDateTime(day('2026-10-23'), {
      hour: 23,
      minute: 50,
    });

    expect(reader.newProductWindow(user, lateNight).earliest).toBe(
      day('2026-10-25'),
    );
  });
});

describe('StoreMyProductsReader.ownerStatus', () => {
  test('自分のプロダクトなら、取消を除く直近のローンチと判定した状態を返す', async () => {
    const snapshot = snapshotOf({ hidden: true });
    const state: ProductState = {
      ...stateFor(PRODUCT_ID),
      latestLaunch: FINISHED_LAUNCH,
    };
    const calls: string[] = [];
    const store = createFakeProductStore(calls, { snapshots: [snapshot] });
    const fakeEvaluator = createFakeStateEvaluator(calls, () => state);
    const reader = new StoreMyProductsReader(
      store,
      fakeEvaluator.evaluator,
      fixedClock,
    );

    expect(await reader.ownerStatus(user, 'launch-meter')).toEqual({
      latestLaunch: FINISHED_LAUNCH,
      state,
    });
    expect(fakeEvaluator.requests).toEqual([
      {
        ownerUserId: USER_ID,
        products: [
          { productId: PRODUCT_ID, hidden: true, launches: [FINISHED_LAUNCH] },
        ],
        at: PRODUCT_NOW,
      },
    ]);
  });

  test.each<[string, FakeProductStoreOptions, string]>([
    [
      '他人のプロダクト',
      { snapshots: [snapshotOf({ ownerUserId: OTHER_USER_ID })] },
      'launch-meter',
    ],
    [
      '論理削除した自分のプロダクト',
      { snapshots: [snapshotOf()], deletedProductIds: [PRODUCT_ID] },
      'launch-meter',
    ],
    [
      '自分のプロダクトの旧ハンドル',
      { snapshots: [snapshotOf({ previousHandle: 'old-meter' })] },
      'old-meter',
    ],
    ['存在しないハンドル', { snapshots: [snapshotOf()] }, 'unknown-product'],
  ])('%sはnullになる', async (_label, options, handle) => {
    const { reader, calls } = setup(options);

    expect(await reader.ownerStatus(user, handle)).toBeNull();
    expect(calls).not.toContain('evaluator.evaluate');
  });

  test('形式に合わないハンドルは、ストアを読まずにnullになる', async () => {
    const { reader, calls } = setup({ snapshots: [snapshotOf()] });

    expect(await reader.ownerStatus(user, '-launch')).toBeNull();
    expect(calls).toEqual([]);
  });
});
