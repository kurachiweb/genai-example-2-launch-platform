import { describe, expect, test } from 'vitest';

import {
  PRODUCT_CATEGORY_OTHER_HANDLE,
  PRODUCT_CATEGORY_OTHER_ID,
  PRODUCT_CATEGORY_OTHER_NAME,
} from '../../../../../common-lib/product/product-category-constants.ts';
import {
  categoryIdOf,
  insertCategory,
  insertProductPreviousHandle,
  insertUser,
  launchIdOf,
  logoFileIdOf,
  T0,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  codesOf,
  detailsOf,
  fetchMyProduct,
  fetchMyProducts,
  fetchNewProductLaunchWindow,
  fetchProductHandleAvailability,
  fetchProductOwnerStatus,
  insertOwnedProduct,
  installProductGraphQLTest,
  issueProductUserSession,
  kickoffOf,
  PRODUCT_TEST_NOW,
} from '../../../../../test/support/product-graphql-operations.ts';
import { computeLaunchDateWindow } from '../../../../domain/product/launch-date-rules.ts';

const ALICE = 1;
const BOB = 2;

const FIRST_OUT_OF_RANGE_MESSAGE =
  '表示する件数は1〜20件の整数で指定してください。';

const INVALID_CURSOR_MESSAGE = 'ページの位置の指定が正しくありません。';

const HANDLE_TOO_LONG_MESSAGE = 'ハンドルは50文字以内で入力してください。';

const OTHER_CATEGORY = Object.freeze({
  id: PRODUCT_CATEGORY_OTHER_ID,
  name: PRODUCT_CATEGORY_OTHER_NAME,
  handle: PRODUCT_CATEGORY_OTHER_HANDLE,
  systemDefault: true,
});

installProductGraphQLTest();

async function insertAlice(): Promise<string> {
  await insertUser(ALICE, { handle: 'alice', emailVerifiedAt: T0 });
  return issueProductUserSession(ALICE);
}

async function insertBob(): Promise<void> {
  await insertUser(BOB, { handle: 'bob', emailVerifiedAt: T0 });
}

// アリスのプロダクトAlpha(旧ハンドルold-alpha)・論理削除したプロダクト、ボブのプロダクトとその旧ハンドルを作る
async function insertHandleSamples(): Promise<void> {
  await insertBob();
  await insertOwnedProduct(
    1,
    ALICE,
    { launchDate: '2026-11-20' },
    { handle: 'Alpha' },
  );
  await insertProductPreviousHandle(1, 1, 'old-alpha');
  await insertOwnedProduct(
    2,
    BOB,
    { launchDate: '2026-11-20' },
    { handle: 'bob-product' },
  );
  await insertProductPreviousHandle(2, 2, 'old-bob');
  await insertOwnedProduct(
    3,
    ALICE,
    { launchDate: '2026-11-20' },
    { handle: 'deleted-product', deletedAt: T0 },
  );
}

describe('呼び出し元とログインの確認', () => {
  test.each([
    ['myProducts', () => fetchMyProducts({ first: 21 }, { caller: 'admin' })],
    ['myProduct', () => fetchMyProduct('product1', { caller: 'admin' })],
    [
      'newProductLaunchWindow',
      () => fetchNewProductLaunchWindow({ caller: 'admin' }),
    ],
    [
      'productHandleAvailability',
      () =>
        fetchProductHandleAvailability(
          { handle: 'x'.repeat(51) },
          { caller: 'admin' },
        ),
    ],
    [
      'productOwnerStatus',
      () => fetchProductOwnerStatus('product1', { caller: 'admin' }),
    ],
  ])(
    '管理者側の呼び出し元からの%sは、入力の検証の前にforbiddenで拒否する',
    async (_name, call) => {
      await insertAlice();

      const response = await call();

      expect(codesOf(response)).toEqual(['forbidden']);
    },
  );

  test.each([
    ['myProducts', () => fetchMyProducts({ first: 20 })],
    ['myProduct', () => fetchMyProduct('product1')],
    ['newProductLaunchWindow', () => fetchNewProductLaunchWindow()],
    [
      'productHandleAvailability',
      () => fetchProductHandleAvailability({ handle: 'product1' }),
    ],
    ['productOwnerStatus', () => fetchProductOwnerStatus('product1')],
  ])(
    'ログインしていなければ%sをunauthenticatedで拒否する',
    async (_name, call) => {
      await insertAlice();

      const response = await call();

      expect(codesOf(response)).toEqual(['unauthenticated']);
    },
  );
});

describe('myProducts', () => {
  test('論理削除していない自分のプロダクトを最新のローンチ日の新しい順に返す', async () => {
    const token = await insertAlice();
    await insertBob();
    await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-20' });
    await insertOwnedProduct(2, ALICE, { launchDate: '2026-11-25' });
    await insertOwnedProduct(
      3,
      ALICE,
      { launchDate: '2026-11-30' },
      { deletedAt: T0 },
    );
    await insertOwnedProduct(4, BOB, { launchDate: '2026-11-21' });

    const response = await fetchMyProducts(
      { first: 20 },
      { sessionToken: token },
    );

    expect(response.errors).toBeUndefined();
    expect(
      response.data?.myProducts?.nodes.map(({ handle }) => handle),
    ).toEqual(['product2', 'product1']);
    expect(response.data?.myProducts?.pageInfo.hasNextPage).toBe(false);
  });

  test('プロダクトの項目・カテゴリ・直近のローンチ・計画を返す', async () => {
    const token = await insertAlice();
    await insertCategory(1, { name: '開発ツール', handle: 'dev-tools' });
    await insertOwnedProduct(
      1,
      ALICE,
      { launchDate: '2026-11-20' },
      {
        handle: 'Alpha',
        name: 'アルファ',
        tagline: '一言の説明',
        categoryId: categoryIdOf(1),
        websiteUrl: 'https://alpha.example/',
        descriptionMarkdown: '# 説明文',
        version: 3,
      },
    );

    const response = await fetchMyProducts(
      { first: 20 },
      { sessionToken: token },
    );

    const window = computeLaunchDateWindow({
      now: PRODUCT_TEST_NOW,
      basis: null,
      entitled: false,
    });
    expect(response.data?.myProducts?.nodes).toEqual([
      {
        __typename: 'MyProduct',
        handle: 'Alpha',
        previousHandle: null,
        name: 'アルファ',
        tagline: '一言の説明',
        category: {
          id: categoryIdOf(1),
          name: '開発ツール',
          handle: 'dev-tools',
          systemDefault: false,
        },
        websiteUrl: 'https://alpha.example/',
        description: '# 説明文',
        logoFileId: logoFileIdOf(1),
        logo: null,
        screenshots: [],
        hidden: false,
        listed: false,
        version: 3,
        latestLaunch: {
          id: launchIdOf(1),
          number: 1,
          launchDate: '2026-11-20',
          kickoffAt: kickoffOf('2026-11-20'),
          status: 'SCHEDULED',
          outcome: null,
          summary: { label: 'キックオフ予定', inMatch: false },
        },
        plan: {
          mode: 'RESCHEDULE',
          currentLaunchDate: '2026-11-20',
          window: {
            earliest: window.earliest,
            latest: window.latest,
            unavailable: window.unavailable.map((range) => ({
              from: range.from,
              to: range.to,
              reason: range.reason.toUpperCase(),
            })),
            relaunchIntervalDays: null,
          },
          blocks: [],
          locked: false,
          locks: [],
          lockUnknown: false,
          ultrasEntitled: false,
        },
      },
    ]);
  });

  test('カーソルで続きのページを返す', async () => {
    const token = await insertAlice();
    await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-20' });
    await insertOwnedProduct(2, ALICE, { launchDate: '2026-11-25' });
    await insertOwnedProduct(3, ALICE, { launchDate: '2026-11-30' });

    const first = await fetchMyProducts({ first: 2 }, { sessionToken: token });
    const second = await fetchMyProducts(
      { first: 2, after: first.data?.myProducts?.pageInfo.endCursor ?? null },
      { sessionToken: token },
    );

    expect(first.data?.myProducts?.nodes.map(({ handle }) => handle)).toEqual([
      'product3',
      'product2',
    ]);
    expect(first.data?.myProducts?.pageInfo.hasNextPage).toBe(true);
    expect(second.data?.myProducts?.nodes.map(({ handle }) => handle)).toEqual([
      'product1',
    ]);
    expect(second.data?.myProducts?.pageInfo.hasNextPage).toBe(false);
    expect(typeof second.data?.myProducts?.pageInfo.endCursor).toBe('string');
  });

  test('明示したnullのカーソルは未指定と同じに扱い、0件なら空のページを返す', async () => {
    const token = await insertAlice();

    const response = await fetchMyProducts(
      { first: 20, after: null },
      { sessionToken: token },
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.myProducts).toEqual({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });

  test.each([0, 21])(
    '件数%iはvalidation_errorと件数の範囲の文言で拒否する',
    async (first) => {
      const token = await insertAlice();

      const response = await fetchMyProducts(
        { first },
        { sessionToken: token },
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({
          field: 'first',
          message: FIRST_OUT_OF_RANGE_MESSAGE,
        }),
      ]);
    },
  );

  test('257文字のカーソルはvalidation_errorで拒否する', async () => {
    const token = await insertAlice();

    const response = await fetchMyProducts(
      { first: 20, after: 'a'.repeat(257) },
      { sessionToken: token },
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'after',
        message: INVALID_CURSOR_MESSAGE,
      }),
    ]);
  });

  test('壊れたカーソルはinvalid_cursorで拒否する', async () => {
    const token = await insertAlice();

    const response = await fetchMyProducts(
      { first: 20, after: 'not-a-cursor' },
      { sessionToken: token },
    );

    expect(codesOf(response)).toEqual(['invalid_cursor']);
  });
});

describe('myProduct', () => {
  test('現在のハンドルの自分のプロダクトを大文字小文字を区別せずに返す', async () => {
    const token = await insertAlice();
    await insertHandleSamples();

    const response = await fetchMyProduct('alpha', { sessionToken: token });

    expect(response.data?.myProduct).toEqual(
      expect.objectContaining({
        __typename: 'MyProduct',
        handle: 'Alpha',
        previousHandle: 'old-alpha',
        category: OTHER_CATEGORY,
      }),
    );
  });

  test('自分のプロダクトの旧ハンドルなら転送先の現在のハンドルを返す', async () => {
    const token = await insertAlice();
    await insertHandleSamples();

    const response = await fetchMyProduct('OLD-alpha', { sessionToken: token });

    expect(response.data?.myProduct).toEqual({
      __typename: 'MyProductRedirect',
      handle: 'Alpha',
    });
  });

  test.each([
    ['他人のプロダクト', 'bob-product'],
    ['論理削除したプロダクト', 'deleted-product'],
    ['他人のプロダクトの旧ハンドル', 'old-bob'],
    ['存在しないハンドル', 'nothing'],
    ['形式に合わないハンドル', '-invalid'],
  ])('%sはnullを返す', async (_name, handle) => {
    const token = await insertAlice();
    await insertHandleSamples();

    const response = await fetchMyProduct(handle, { sessionToken: token });

    expect(response.errors).toBeUndefined();
    expect(response.data?.myProduct).toBeNull();
  });
});

describe('newProductLaunchWindow', () => {
  test('現在の時刻で登録画面の選べる日を返す', async () => {
    const token = await insertAlice();

    const response = await fetchNewProductLaunchWindow({ sessionToken: token });

    const window = computeLaunchDateWindow({
      now: PRODUCT_TEST_NOW,
      basis: null,
      entitled: false,
    });
    expect(response.errors).toBeUndefined();
    expect(response.data?.newProductLaunchWindow).toEqual({
      earliest: window.earliest,
      latest: window.latest,
      unavailable: window.unavailable.map((range) => ({
        from: range.from,
        to: range.to,
        reason: range.reason.toUpperCase(),
      })),
      relaunchIntervalDays: null,
    });
  });
});

describe('productHandleAvailability', () => {
  test.each([
    ['使われていないハンドル', { handle: 'fresh' }, 'AVAILABLE'],
    [
      '他のプロダクトの現在のハンドル',
      { handle: 'BOB-product' },
      'UNAVAILABLE',
    ],
    [
      '論理削除したプロダクトの現在のハンドル',
      { handle: 'deleted-product' },
      'UNAVAILABLE',
    ],
    ['他のプロダクトの旧ハンドル', { handle: 'old-bob' }, 'AVAILABLE'],
    ['予約語', { handle: 'admin' }, 'UNAVAILABLE'],
    ['形式の違反', { handle: '-invalid' }, 'INVALID'],
    ['空のハンドル', { handle: '' }, 'INVALID'],
    [
      '編集中のプロダクトの現在のハンドル',
      { handle: 'ALPHA', productHandle: 'alpha' },
      'AVAILABLE',
    ],
    [
      '編集中のプロダクトの保持中の旧ハンドル',
      { handle: 'old-alpha', productHandle: 'alpha' },
      'AVAILABLE',
    ],
    [
      '登録での自分の他のプロダクトの現在のハンドル',
      { handle: 'alpha' },
      'UNAVAILABLE',
    ],
    [
      '明示したnullの編集中のハンドル',
      { handle: 'alpha', productHandle: null },
      'UNAVAILABLE',
    ],
  ])('%sは%sを返す', async (_name, variables, expected) => {
    const token = await insertAlice();
    await insertHandleSamples();

    const response = await fetchProductHandleAvailability(variables, {
      sessionToken: token,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.productHandleAvailability).toBe(expected);
  });

  test('50文字のハンドルは判定し、51文字はvalidation_errorで拒否する', async () => {
    const token = await insertAlice();

    const accepted = await fetchProductHandleAvailability(
      { handle: 'a'.repeat(50) },
      { sessionToken: token },
    );
    const rejected = await fetchProductHandleAvailability(
      { handle: 'a'.repeat(51) },
      { sessionToken: token },
    );

    expect(accepted.data?.productHandleAvailability).toBe('AVAILABLE');
    expect(codesOf(rejected)).toEqual(['validation_error']);
    expect(detailsOf(rejected)).toEqual([
      expect.objectContaining({
        field: 'handle',
        message: HANDLE_TOO_LONG_MESSAGE,
      }),
    ]);
  });
});

describe('productOwnerStatus', () => {
  test('本人のプロダクトの直近のローンチと計画を返す', async () => {
    const token = await insertAlice();
    await insertHandleSamples();

    const response = await fetchProductOwnerStatus('ALPHA', {
      sessionToken: token,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.productOwnerStatus).toMatchObject({
      latestLaunch: {
        id: launchIdOf(1),
        status: 'SCHEDULED',
      },
      plan: {
        mode: 'RESCHEDULE',
        currentLaunchDate: '2026-11-20',
        locked: false,
      },
    });
  });

  test.each([
    ['他人のプロダクト', 'bob-product'],
    ['論理削除したプロダクト', 'deleted-product'],
    ['自分のプロダクトの旧ハンドル', 'old-alpha'],
    ['存在しないハンドル', 'nothing'],
  ])('%sはnullを返す', async (_name, handle) => {
    const token = await insertAlice();
    await insertHandleSamples();

    const response = await fetchProductOwnerStatus(handle, {
      sessionToken: token,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.productOwnerStatus).toBeNull();
  });
});
