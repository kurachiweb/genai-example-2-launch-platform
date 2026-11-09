import { beforeEach, describe, expect, test } from 'vitest';

import { PRODUCT_CATEGORY_OTHER_ID } from '../../../common-lib/product/product-category-constants.ts';
import {
  categoryIdOf,
  clearProductTables,
  insertCategory,
  insertLaunch,
  insertProduct,
  insertProductPreviousHandle,
  insertScreenshot,
  insertUser,
  launchIdOf,
  logoFileIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import {
  businessAt,
  businessDate,
  createTestStore,
  fileIdOf,
  NOW,
} from './testing/product-store-fixtures.ts';

const OWNER = 1;

const OTHER = 2;

beforeEach(async () => {
  await clearProductTables();
  await insertUser(OWNER);
  await insertUser(OTHER);
});

describe('D1ProductStore.findForOwner', () => {
  beforeEach(async () => {
    await insertCategory(1);
    await insertProduct(1, OWNER, {
      categoryId: categoryIdOf(1),
      hiddenAt: T0,
      version: 3,
    });
    await insertScreenshot(1, 1, 1, fileIdOf(2));
    await insertScreenshot(2, 1, 0, fileIdOf(1));
    await insertProductPreviousHandle(1, 1, 'legacy1');
    await insertLaunch(1, 1, {
      launchDate: '2026-11-01',
      outcome: 'won',
      decidedAt: businessAt('2026-11-01', 23, 59),
    });
    await insertLaunch(2, 1, { launchDate: '2026-11-20' });
  });

  test('本人の現在のハンドルで、内容・旧ハンドル・表示順のスクリーンショット・取消を含むローンチを返す', async () => {
    const { store } = createTestStore();

    const snapshot = await store.findForOwner(userIdOf(OWNER), 'product1', NOW);

    expect(snapshot).toStrictEqual({
      productId: productIdOf(1),
      ownerUserId: userIdOf(OWNER),
      handle: 'product1',
      previousHandle: 'legacy1',
      name: 'プロダクト1',
      tagline: 'タグライン1',
      category: {
        id: categoryIdOf(1),
        name: 'カテゴリ1',
        handle: 'category1',
        systemDefault: false,
        createdAt: T0,
      },
      websiteUrl: 'https://product1.example/',
      descriptionMarkdown: '説明文1',
      logoFileId: logoFileIdOf(1),
      screenshotFileIds: [fileIdOf(1), fileIdOf(2)],
      hidden: true,
      version: 3,
      launches: [
        {
          launchId: launchIdOf(2),
          productId: productIdOf(1),
          number: 2,
          launchDate: businessDate('2026-11-20'),
          status: 'scheduled',
          outcome: null,
          decidedAt: null,
        },
        {
          launchId: launchIdOf(1),
          productId: productIdOf(1),
          number: 1,
          launchDate: businessDate('2026-11-01'),
          status: 'finished',
          outcome: 'won',
          decidedAt: businessAt('2026-11-01', 23, 59),
        },
      ],
    });
  });

  test('ハンドルは大文字小文字を区別しない', async () => {
    const { store } = createTestStore();

    const snapshot = await store.findForOwner(userIdOf(OWNER), 'PRODUCT1', NOW);

    expect(snapshot?.productId).toBe(productIdOf(1));
  });

  test('旧ハンドルが論理削除されていれば旧ハンドルをnullにする', async () => {
    await insertProduct(2, OWNER);
    await insertProductPreviousHandle(2, 2, 'legacy2', { deletedAt: T0 });
    const { store } = createTestStore();

    const snapshot = await store.findForOwner(userIdOf(OWNER), 'product2', NOW);

    expect(snapshot).toMatchObject({
      previousHandle: null,
      screenshotFileIds: [],
      launches: [],
      hidden: false,
    });
  });

  test('他人のプロダクト・論理削除済み・旧ハンドル・不在はundefined', async () => {
    await insertProduct(3, OWNER, { deletedAt: T0 });
    const { store } = createTestStore();

    await expect(
      store.findForOwner(userIdOf(OTHER), 'product1', NOW),
    ).resolves.toBeUndefined();
    await expect(
      store.findForOwner(userIdOf(OWNER), 'product3', NOW),
    ).resolves.toBeUndefined();
    await expect(
      store.findForOwner(userIdOf(OWNER), 'legacy1', NOW),
    ).resolves.toBeUndefined();
    await expect(
      store.findForOwner(userIdOf(OWNER), 'missing', NOW),
    ).resolves.toBeUndefined();
  });
});

describe('D1ProductStore.resolveOwnPreviousHandle', () => {
  beforeEach(async () => {
    await insertProduct(1, OWNER);
    await insertProductPreviousHandle(1, 1, 'legacy1');
    await insertProduct(2, OTHER);
    await insertProductPreviousHandle(2, 2, 'legacy2');
    await insertProduct(3, OWNER, { deletedAt: T0 });
    await insertProductPreviousHandle(3, 3, 'legacy3');
    await insertProduct(4, OWNER);
    await insertProductPreviousHandle(4, 4, 'legacy4', { deletedAt: T0 });
  });

  test('本人のプロダクトの旧ハンドルなら現在のハンドルを返し、大文字小文字を区別しない', async () => {
    const { store } = createTestStore();

    await expect(
      store.resolveOwnPreviousHandle(userIdOf(OWNER), 'LEGACY1'),
    ).resolves.toBe('product1');
  });

  test.each([
    ['他人のプロダクトの旧ハンドル', 'legacy2'],
    ['論理削除したプロダクトの旧ハンドル', 'legacy3'],
    ['論理削除した旧ハンドル', 'legacy4'],
    ['現在のハンドル', 'product1'],
    ['どこにも無いハンドル', 'missing'],
  ])('%sはundefined', async (_case, handle) => {
    const { store } = createTestStore();

    await expect(
      store.resolveOwnPreviousHandle(userIdOf(OWNER), handle),
    ).resolves.toBeUndefined();
  });
});

describe('D1ProductStore.listForOwner', () => {
  beforeEach(async () => {
    await insertProduct(1, OWNER, { latestLaunchDate: '2026-11-20' });
    await insertProduct(2, OWNER, { latestLaunchDate: '2026-12-01' });
    await insertProduct(3, OWNER, {
      latestLaunchDate: '2026-11-20',
      hiddenAt: T0,
    });
    await insertProduct(4, OWNER, { latestLaunchDate: '2026-11-10' });
    await insertProduct(5, OWNER, {
      latestLaunchDate: '2026-12-31',
      deletedAt: T0,
    });
    await insertProduct(6, OTHER, { latestLaunchDate: '2026-12-31' });
    await insertLaunch(1, 2, { launchDate: '2026-12-01' });
  });

  test('論理削除していない本人のプロダクトを、最新のローンチ日とIDの降順にlimit件まで返す', async () => {
    const { store } = createTestStore();

    const page = await store.listForOwner({
      ownerUserId: userIdOf(OWNER),
      limit: 2,
      before: undefined,
      now: NOW,
    });

    expect(page.map((product) => product.productId)).toStrictEqual([
      productIdOf(2),
      productIdOf(3),
    ]);
    expect(page[0]?.launches.map((launch) => launch.launchId)).toStrictEqual([
      launchIdOf(1),
    ]);
    expect(page[1]).toMatchObject({
      hidden: true,
      launches: [],
      category: { id: PRODUCT_CATEGORY_OTHER_ID },
    });
  });

  test('位置を渡すとその位置より後のプロダクトを返す', async () => {
    const { store } = createTestStore();

    const page = await store.listForOwner({
      ownerUserId: userIdOf(OWNER),
      limit: 5,
      before: {
        latestLaunchDate: businessDate('2026-11-20'),
        id: productIdOf(3),
      },
      now: NOW,
    });

    expect(page.map((product) => product.productId)).toStrictEqual([
      productIdOf(1),
      productIdOf(4),
    ]);
  });

  test('プロダクトが無ければ空の一覧を返す', async () => {
    await insertUser(3);
    const { store } = createTestStore();

    await expect(
      store.listForOwner({
        ownerUserId: userIdOf(3),
        limit: 5,
        before: undefined,
        now: NOW,
      }),
    ).resolves.toStrictEqual([]);
  });
});

describe('D1ProductStore.isHandleOccupied', () => {
  beforeEach(async () => {
    await insertProduct(1, OWNER);
    await insertProduct(2, OTHER, { deletedAt: T0 });
    await insertProductPreviousHandle(1, 1, 'legacy1');
  });

  test('他のプロダクトの現在のハンドルは、大文字小文字の違いや論理削除に関わらず使用中とする', async () => {
    const { store } = createTestStore();

    await expect(store.isHandleOccupied('PRODUCT1')).resolves.toBe(true);
    await expect(
      store.isHandleOccupied('product2', productIdOf(1)),
    ).resolves.toBe(true);
  });

  test('自分の現在のハンドルと他のプロダクトの旧ハンドルは使用中としない', async () => {
    const { store } = createTestStore();

    await expect(
      store.isHandleOccupied('product1', productIdOf(1)),
    ).resolves.toBe(false);
    await expect(store.isHandleOccupied('legacy1')).resolves.toBe(false);
    await expect(store.isHandleOccupied('fresh')).resolves.toBe(false);
  });
});

describe('D1ProductStore.categoryExists', () => {
  test('カテゴリの有無を返す', async () => {
    await insertCategory(1);
    const { store } = createTestStore();

    await expect(store.categoryExists(categoryIdOf(1))).resolves.toBe(true);
    await expect(store.categoryExists(PRODUCT_CATEGORY_OTHER_ID)).resolves.toBe(
      true,
    );
    await expect(store.categoryExists(categoryIdOf(2))).resolves.toBe(false);
  });
});
