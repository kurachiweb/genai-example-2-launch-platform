import { beforeEach, describe, expect, test } from 'vitest';

import {
  PRODUCT_CATEGORY_OTHER_HANDLE,
  PRODUCT_CATEGORY_OTHER_ID,
  PRODUCT_CATEGORY_OTHER_NAME,
} from '../../../common-lib/product/product-category-constants.ts';
import {
  categoryIdOf,
  clearProductTables,
  db,
  insertCategory,
  insertLaunch,
  insertLaunches,
  insertProduct,
  insertUser,
  logoFileIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import { D1LaunchHistoryStore } from './d1-launch-history-store.ts';
import { businessAt, businessDate } from './testing/product-store-fixtures.ts';

const OWNER = 1;

const OTHER = 2;

const SUSPENDED = 3;

const WON = {
  outcome: 'won',
  decidedAt: businessAt('2026-11-01', 23, 59),
} as const;

const createStore = (): D1LaunchHistoryStore => new D1LaunchHistoryStore(db);

const idsOf = (rows: readonly { readonly productId: string }[]): string[] =>
  rows.map(({ productId }) => productId);

beforeEach(async () => {
  await clearProductTables();
  await insertUser(OWNER);
  await insertUser(OTHER);
  await insertUser(SUSPENDED, { status: 'suspended' });
});

describe('D1LaunchHistoryStore: 対象と件数', () => {
  beforeEach(async () => {
    // 1: 掲載済み / 2: 未掲載 / 3: 非公開化中の掲載済み / 4: 論理削除した掲載済み / 5: 勝利のローンチが取消 / 6: 他人の掲載済み
    await insertProduct(1, OWNER, { latestLaunchDate: '2026-11-01' });
    await insertProduct(2, OWNER, { latestLaunchDate: '2026-11-02' });
    await insertProduct(3, OWNER, {
      latestLaunchDate: '2026-11-03',
      hiddenAt: T0,
    });
    await insertProduct(4, OWNER, {
      latestLaunchDate: '2026-11-04',
      deletedAt: T0,
    });
    await insertProduct(5, OWNER, { latestLaunchDate: '2026-11-05' });
    await insertProduct(6, OTHER, { latestLaunchDate: '2026-11-06' });
    await insertLaunches([
      {
        index: 1,
        productIndex: 1,
        columns: { launchDate: '2026-11-01', ...WON },
      },
      { index: 2, productIndex: 2, columns: { launchDate: '2026-11-02' } },
      {
        index: 3,
        productIndex: 3,
        columns: { launchDate: '2026-11-03', ...WON },
      },
      {
        index: 4,
        productIndex: 4,
        columns: { launchDate: '2026-11-04', ...WON },
      },
      {
        index: 5,
        productIndex: 5,
        columns: { launchDate: '2026-11-05', ...WON, cancelledAt: T0 },
      },
      {
        index: 6,
        productIndex: 6,
        columns: { launchDate: '2026-11-06', ...WON },
      },
    ]);
  });

  test('他人向けには、その利用者の掲載済み(可視で取消でない勝利のローンチがある)プロダクトだけを数えて返す', async () => {
    const store = createStore();

    const rows = await store.list({
      userId: userIdOf(OWNER),
      scope: 'public',
      limit: 21,
      before: undefined,
    });
    const count = await store.count({
      userId: userIdOf(OWNER),
      scope: 'public',
    });

    expect(idsOf(rows)).toEqual([productIdOf(1)]);
    expect(count).toBe(1);
  });

  test('本人向けには、論理削除と非公開化を除く自分のプロダクトを未掲載を含めて新しい順に数えて返す', async () => {
    const store = createStore();

    const rows = await store.list({
      userId: userIdOf(OWNER),
      scope: 'owner',
      limit: 21,
      before: undefined,
    });
    const count = await store.count({
      userId: userIdOf(OWNER),
      scope: 'owner',
    });

    expect(idsOf(rows)).toEqual([
      productIdOf(5),
      productIdOf(2),
      productIdOf(1),
    ]);
    expect(count).toBe(3);
  });

  test('本人向けには、投稿者が停止中でもプロダクトを返し、他人向けには返さない', async () => {
    await insertProduct(7, SUSPENDED, { latestLaunchDate: '2026-11-07' });
    await insertLaunch(7, 7, { launchDate: '2026-11-07', ...WON });
    const store = createStore();

    const owner = await store.list({
      userId: userIdOf(SUSPENDED),
      scope: 'owner',
      limit: 21,
      before: undefined,
    });
    const publicRows = await store.list({
      userId: userIdOf(SUSPENDED),
      scope: 'public',
      limit: 21,
      before: undefined,
    });

    expect(idsOf(owner)).toEqual([productIdOf(7)]);
    expect(
      await store.count({ userId: userIdOf(SUSPENDED), scope: 'owner' }),
    ).toBe(1);
    expect(publicRows).toEqual([]);
    expect(
      await store.count({ userId: userIdOf(SUSPENDED), scope: 'public' }),
    ).toBe(0);
  });

  test('プロダクトの無い利用者は0件の空の一覧になる', async () => {
    await insertUser(4);
    const store = createStore();

    expect(
      await store.list({
        userId: userIdOf(4),
        scope: 'owner',
        limit: 21,
        before: undefined,
      }),
    ).toEqual([]);
    expect(await store.count({ userId: userIdOf(4), scope: 'owner' })).toBe(0);
  });
});

describe('D1LaunchHistoryStore: 項目の内容', () => {
  test('プロダクトの要約の項目と、並びの位置に使う最新のローンチ日を返す', async () => {
    await insertCategory(1);
    await insertProduct(1, OWNER, {
      categoryId: categoryIdOf(1),
      latestLaunchDate: '2026-11-20',
    });
    await insertProduct(2, OWNER, { latestLaunchDate: '2026-11-01' });
    await insertLaunch(1, 1, { launchDate: '2026-11-01', ...WON });
    await insertLaunch(2, 1, { launchDate: '2026-11-20' });
    await insertLaunch(3, 2, { launchDate: '2026-11-01' });
    const store = createStore();

    const rows = await store.list({
      userId: userIdOf(OWNER),
      scope: 'owner',
      limit: 21,
      before: undefined,
    });

    expect(rows).toStrictEqual([
      {
        productId: productIdOf(1),
        ownerUserId: userIdOf(OWNER),
        handle: 'product1',
        name: 'プロダクト1',
        tagline: 'タグライン1',
        category: {
          id: categoryIdOf(1),
          name: 'カテゴリ1',
          handle: 'category1',
        },
        websiteUrl: 'https://product1.example/',
        logoFileId: logoFileIdOf(1),
        hidden: false,
        visible: true,
        listed: true,
        createdAt: T0,
        latestLaunchDate: businessDate('2026-11-20'),
      },
      {
        productId: productIdOf(2),
        ownerUserId: userIdOf(OWNER),
        handle: 'product2',
        name: 'プロダクト2',
        tagline: 'タグライン2',
        category: {
          id: PRODUCT_CATEGORY_OTHER_ID,
          name: PRODUCT_CATEGORY_OTHER_NAME,
          handle: PRODUCT_CATEGORY_OTHER_HANDLE,
        },
        websiteUrl: 'https://product2.example/',
        logoFileId: logoFileIdOf(2),
        hidden: false,
        visible: true,
        listed: false,
        createdAt: T0,
        latestLaunchDate: businessDate('2026-11-01'),
      },
    ]);
  });
});

describe('D1LaunchHistoryStore: 並びとページ', () => {
  // 25件を、5件ずつ同じ最新のローンチ日にして並べる
  const INDEXES = Array.from({ length: 25 }, (_, index) => index + 1);

  const dateOf = (index: number): string =>
    `2026-11-${String(Math.ceil(index / 5)).padStart(2, '0')}`;

  beforeEach(async () => {
    for (const index of INDEXES) {
      await insertProduct(index, OWNER, { latestLaunchDate: dateOf(index) });
    }
    await insertLaunches(
      INDEXES.map((index) => ({
        index,
        productIndex: index,
        columns: { launchDate: dateOf(index), ...WON },
      })),
    );
  });

  // 最新のローンチ日の降順、同じ日はIDの降順
  const expectedOrder = INDEXES.toSorted((left, right) =>
    dateOf(left) === dateOf(right)
      ? right - left
      : dateOf(right).localeCompare(dateOf(left)),
  ).map(productIdOf);

  test('最新のローンチ日の新しい順(同じ日はIDの降順)に上限の件数まで返し、位置より後から続きを返す', async () => {
    const store = createStore();

    const first = await store.list({
      userId: userIdOf(OWNER),
      scope: 'public',
      limit: 21,
      before: undefined,
    });
    const last = first[19];
    if (last === undefined) {
      throw new Error('20件目がありません');
    }
    const rest = await store.list({
      userId: userIdOf(OWNER),
      scope: 'public',
      limit: 21,
      before: { latestLaunchDate: last.latestLaunchDate, id: last.productId },
    });

    expect(idsOf(first)).toEqual(expectedOrder.slice(0, 21));
    expect(idsOf(rest)).toEqual(expectedOrder.slice(20));
    expect(
      await store.count({ userId: userIdOf(OWNER), scope: 'public' }),
    ).toBe(25);
  });

  test('同じ最新のローンチ日の途中の位置からも、残りのIDを取りこぼさずに続ける', async () => {
    const store = createStore();

    const rows = await store.list({
      userId: userIdOf(OWNER),
      scope: 'owner',
      limit: 3,
      before: {
        latestLaunchDate: businessDate(dateOf(13)),
        id: productIdOf(13),
      },
    });

    expect(idsOf(rows)).toEqual([
      productIdOf(12),
      productIdOf(11),
      productIdOf(10),
    ]);
  });
});
