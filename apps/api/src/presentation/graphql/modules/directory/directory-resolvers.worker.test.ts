import { beforeEach, describe, expect, test } from 'vitest';

import {
  PRODUCT_CATEGORY_OTHER_HANDLE,
  PRODUCT_CATEGORY_OTHER_ID,
  PRODUCT_CATEGORY_OTHER_NAME,
} from '../../../../../common-lib/product/product-category-constants.ts';
import {
  indexProduct,
  insertQualifiers,
  winOf,
} from '../../../../../lib/workers/directory/testing/directory-listing-fixtures.ts';
import {
  fileIdOf,
  insertFile,
  objectKeyOf,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  categoryIdOf,
  insertCategory,
  insertProduct,
  insertUser,
  productIdOf,
  userIdOf,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  answerDirectoryItemMetrics,
  answerDirectoryLaunchSummaries,
  fetchDirectory,
  fetchDirectoryCategories,
  hideDirectoryOwnerSummaries,
  installDirectoryGraphQLTest,
  issueDirectoryUserSession,
  markMatchEndedEarly,
} from '../../../../../test/support/directory-graphql-operations.ts';
import { codesOf } from '../../../../../test/support/product-graphql-operations.ts';

installDirectoryGraphQLTest();

const OWNER = 1;
const RIVAL = 2;
const VIEWER = 3;

const VICTORY_PRODUCT = 1;
const BYE_PRODUCT = 2;
const EARLY_PRODUCT = 3;
const LOSER_A = 91;
const LOSER_B = 92;

const VICTORY_MATCH = 1;
const BYE_MATCH = 2;
const EARLY_MATCH = 3;

const TOOLS = 1;
const GAMES = 2;

const NO_CONDITIONS = Object.freeze({
  q: null,
  category: null,
  from: null,
  to: null,
  sort: null,
  page: null,
});

const TOOLS_CATEGORY = {
  id: categoryIdOf(TOOLS),
  name: 'カテゴリ1',
  handle: 'category1',
  systemDefault: false,
};

const OTHER_CATEGORY = {
  id: PRODUCT_CATEGORY_OTHER_ID,
  name: PRODUCT_CATEGORY_OTHER_NAME,
  handle: PRODUCT_CATEGORY_OTHER_HANDLE,
  systemDefault: true,
};

// 勝利(11/05・カテゴリ1・ロゴあり) / 不戦勝(11/03・その他・検証の済まないURL) / 早期の不戦勝(11/04・カテゴリ1)
async function seedListing(): Promise<void> {
  await insertUser(OWNER);
  await insertUser(RIVAL);
  await insertUser(VIEWER);
  await insertCategory(TOOLS);
  await insertCategory(GAMES);
  await insertFile(1, { ownerId: userIdOf(OWNER) });
  await insertProduct(VICTORY_PRODUCT, OWNER, {
    name: 'Rocketship',
    categoryId: categoryIdOf(TOOLS),
    logoFileId: fileIdOf(1),
  });
  await insertProduct(BYE_PRODUCT, RIVAL, {
    name: 'Plain',
    websiteUrl: 'javascript:alert(1)',
  });
  await insertProduct(EARLY_PRODUCT, RIVAL, {
    name: 'Rocket Garden',
    categoryId: categoryIdOf(TOOLS),
  });
  await insertProduct(LOSER_A, OWNER);
  await insertProduct(LOSER_B, OWNER);
  await insertQualifiers([
    winOf(VICTORY_MATCH, {
      product: VICTORY_PRODUCT,
      owner: OWNER,
      date: '2026-11-05',
      upvotes: 12,
      opponent: LOSER_A,
    }),
    {
      match: BYE_MATCH,
      date: '2026-11-03',
      decision: 'bye',
      sides: [{ product: BYE_PRODUCT, owner: RIVAL, result: 'bye' }],
    },
    {
      match: EARLY_MATCH,
      date: '2026-11-04',
      decision: 'walkover',
      sides: [
        {
          product: EARLY_PRODUCT,
          owner: RIVAL,
          result: 'walkover',
          upvotes: 5,
        },
        { product: LOSER_B, owner: OWNER, result: 'lost' },
      ],
    },
  ]);
  await markMatchEndedEarly(EARLY_MATCH);
}

const handlesOf = (
  items: readonly { readonly handle: string }[] | undefined,
): string[] => (items ?? []).map(({ handle }) => handle);

describe('directory: 条件の正規化', () => {
  beforeEach(seedListing);

  test('不正な値をエラーにせず既定の値へ戻し、既定の項目をnullにした条件を返す', async () => {
    const response = await fetchDirectory({
      q: '   ',
      category: 'missing-category',
      from: '2026-02-30',
      to: 'not-a-date',
      sort: 'relevance',
      page: '1.5',
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.directory).toMatchObject({
      applied: NO_CONDITIONS,
      searchTerms: [],
      businessToday: '2026-11-10',
      totalCount: 3,
      page: 1,
      pageCount: 1,
    });
    expect(handlesOf(response.data?.directory?.items)).toEqual([
      'product1',
      'product3',
      'product2',
    ]);
  });

  test('全ての項目を省いた入力では条件なしの1ページ目を返す', async () => {
    const response = await fetchDirectory({});

    expect(response.errors).toBeUndefined();
    expect(response.data?.directory?.applied).toEqual(NO_CONDITIONS);
    expect(response.data?.directory?.totalCount).toBe(3);
  });

  test('有効な条件は正規化して返し、範囲外のページでは空の一覧と総件数を返す', async () => {
    const response = await fetchDirectory({
      q: ' ＲＯＣＫＥＴ ',
      category: 'CATEGORY1',
      from: '2026-11-01',
      to: '2026-11-10',
      sort: 'upvotes',
      page: '2',
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.directory).toEqual({
      applied: {
        q: 'ＲＯＣＫＥＴ',
        category: 'category1',
        from: '2026-11-01',
        to: '2026-11-10',
        sort: 'UPVOTES',
        page: 2,
      },
      searchTerms: ['ROCKET'],
      businessToday: '2026-11-10',
      totalCount: 0,
      page: 2,
      pageCount: 0,
      items: [],
    });
  });

  test('検索語で索引から一致するプロダクトを関連度の既定で返し、強調に使う検索語を添える', async () => {
    await indexProduct(VICTORY_PRODUCT);
    await indexProduct(EARLY_PRODUCT);
    await indexProduct(BYE_PRODUCT);

    const response = await fetchDirectory({ q: 'ＲＯＣＫＥＴ' });

    expect(response.errors).toBeUndefined();
    expect(response.data?.directory?.applied).toEqual({
      ...NO_CONDITIONS,
      q: 'ＲＯＣＫＥＴ',
    });
    expect(response.data?.directory?.searchTerms).toEqual(['ROCKET']);
    expect(response.data?.directory?.totalCount).toBe(2);
    expect(handlesOf(response.data?.directory?.items).toSorted()).toEqual([
      'product1',
      'product3',
    ]);
  });

  test('カテゴリのハンドルを大文字小文字を区別せずに解決して絞り込み、保存済みのハンドルを条件に返す', async () => {
    const response = await fetchDirectory({ category: 'Category1' });

    expect(response.errors).toBeUndefined();
    expect(response.data?.directory?.applied).toEqual({
      ...NO_CONDITIONS,
      category: 'category1',
    });
    expect(response.data?.directory?.totalCount).toBe(2);
    expect(handlesOf(response.data?.directory?.items)).toEqual([
      'product1',
      'product3',
    ]);
  });

  test('既定でない並び順を条件に返して並べ替える', async () => {
    const response = await fetchDirectory({ sort: 'oldest' });

    expect(response.errors).toBeUndefined();
    expect(response.data?.directory?.applied.sort).toBe('OLDEST');
    expect(handlesOf(response.data?.directory?.items)).toEqual([
      'product2',
      'product3',
      'product1',
    ]);
  });
});

describe('directory: 項目', () => {
  beforeEach(seedListing);

  test('勝利の項目にロゴ・カテゴリ・投稿者・受賞・勝利・項目の値を返す', async () => {
    answerDirectoryLaunchSummaries({
      launches: [],
      awards: [
        {
          productId: productIdOf(VICTORY_PRODUCT),
          kind: 'week',
          label: '2026年11月第1週',
        },
        {
          productId: productIdOf(VICTORY_PRODUCT),
          kind: 'year',
          label: '2026年',
        },
      ],
    });
    answerDirectoryItemMetrics(new Map([[productIdOf(VICTORY_PRODUCT), 7]]));

    const response = await fetchDirectory(NO_CONDITIONS);

    expect(response.errors).toBeUndefined();
    expect(response.data?.directory?.items[0]).toEqual({
      handle: 'product1',
      name: 'Rocketship',
      tagline: 'タグライン1',
      category: TOOLS_CATEGORY,
      websiteUrl: 'https://product1.example/',
      logo: { id: fileIdOf(1), objectKey: objectKeyOf(1) },
      owner: { handle: 'user1', nickname: '利用者1', avatar: null },
      isViewerOwn: false,
      awards: [
        { kind: 'YEAR', count: 1, labels: ['2026年'] },
        { kind: 'WEEK', count: 1, labels: ['2026年11月第1週'] },
      ],
      win: { launchDate: '2026-11-05', kind: 'VICTORY', upvoteCount: 12 },
      metrics: [{ key: 'comments', value: 7 }],
    });
  });

  test('不戦勝はUpvote数をnull、早期の不戦勝は確定時点のUpvote数で返し、検証の済まない外部WebサイトURLとロゴの記録の無い項目は空・nullにする', async () => {
    const response = await fetchDirectory(NO_CONDITIONS);

    expect(response.errors).toBeUndefined();
    const [, early, bye] = response.data?.directory?.items ?? [];
    expect(early).toMatchObject({
      handle: 'product3',
      category: TOOLS_CATEGORY,
      websiteUrl: 'https://product3.example/',
      logo: null,
      owner: { handle: 'user2', nickname: '利用者2', avatar: null },
      win: { launchDate: '2026-11-04', kind: 'EARLY', upvoteCount: 5 },
      awards: [],
      metrics: [],
    });
    expect(bye).toMatchObject({
      handle: 'product2',
      category: OTHER_CATEGORY,
      websiteUrl: '',
      logo: null,
      win: { launchDate: '2026-11-03', kind: 'BYE', upvoteCount: null },
    });
  });

  test('閲覧者自身のプロダクトに本人の印を付ける', async () => {
    const token = await issueDirectoryUserSession(OWNER);

    const response = await fetchDirectory(NO_CONDITIONS, {
      sessionToken: token,
    });

    expect(response.errors).toBeUndefined();
    expect(
      response.data?.directory?.items.map(({ handle, isViewerOwn }) => ({
        handle,
        isViewerOwn,
      })),
    ).toEqual([
      { handle: 'product1', isViewerOwn: true },
      { handle: 'product3', isViewerOwn: false },
      { handle: 'product2', isViewerOwn: false },
    ]);
  });

  test('一覧の照会の後に表示できなくなった投稿者はnullにして項目を返す', async () => {
    hideDirectoryOwnerSummaries([RIVAL]);

    const response = await fetchDirectory(NO_CONDITIONS);

    expect(response.errors).toBeUndefined();
    expect(
      response.data?.directory?.items.map(({ handle, owner }) => ({
        handle,
        owner: owner?.handle ?? null,
      })),
    ).toEqual([
      { handle: 'product1', owner: 'user1' },
      { handle: 'product3', owner: null },
      { handle: 'product2', owner: null },
    ]);
  });

  test('項目の値の供給元が失敗しても、値を除いて一覧を返す', async () => {
    answerDirectoryItemMetrics(new Error('供給元に接続できません'));

    const response = await fetchDirectory(NO_CONDITIONS);

    expect(response.errors).toBeUndefined();
    expect(
      response.data?.directory?.items.map(({ metrics }) => metrics),
    ).toEqual([[], [], []]);
  });
});

describe('directoryCategories', () => {
  test('掲載数の多い順・同数は名称順で、掲載の無いカテゴリを含めて標準カテゴリを末尾に返す', async () => {
    await seedListing();
    await insertCategory(3, { name: 'あいう', handle: 'category3' });

    const response = await fetchDirectoryCategories();

    expect(response.errors).toBeUndefined();
    expect(response.data?.directoryCategories).toEqual([
      TOOLS_CATEGORY,
      {
        id: categoryIdOf(3),
        name: 'あいう',
        handle: 'category3',
        systemDefault: false,
      },
      {
        id: categoryIdOf(GAMES),
        name: 'カテゴリ2',
        handle: 'category2',
        systemDefault: false,
      },
      OTHER_CATEGORY,
    ]);
  });
});

describe('呼び出し元', () => {
  test.each([
    ['directory', () => fetchDirectory(NO_CONDITIONS, { caller: 'admin' })],
    [
      'directoryCategories',
      () => fetchDirectoryCategories({ caller: 'admin' }),
    ],
  ])(
    '%sは利用者側でない呼び出し元をforbiddenで拒否する',
    async (_name, call) => {
      const response = await call();

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(response.data).toBeNull();
    },
  );
});
