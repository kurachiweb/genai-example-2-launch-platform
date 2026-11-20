import { describe, expect, test } from 'vitest';

import { downloadPathOf } from '../../../../../common-lib/media/upload-protocol.ts';
import {
  PRODUCT_CATEGORY_OTHER_ID,
  PRODUCT_CATEGORY_OTHER_NAME,
} from '../../../../../common-lib/product/product-category-constants.ts';
import {
  insertRatings,
  ratingIdOf,
} from '../../../../../lib/workers/engagement/testing/engagement-fixtures.ts';
import {
  fileIdOf,
  insertFile,
  insertReason,
  objectKeyOf,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  insertMatch,
  MATCH_DATE,
  matchIdOf,
} from '../../../../../lib/workers/match/testing/match-fixtures.ts';
import { readModerationRows } from '../../../../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import {
  after,
  categoryIdOf,
  insertCategory,
  insertLaunch,
  insertProduct,
  insertScreenshot,
  insertUser,
  launchIdOf,
  logoFileIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  type AdminProductFields,
  asModerator,
  asViewer,
  codesOf,
  detailsOf,
  fetchAdminProduct,
  fetchAdminProductRatings,
  fetchAdminProducts,
  fetchCategoryOptions,
  installModerationContentGraphQLTest,
  MODERATION_ADMINS,
  MODERATION_TEST_NOW,
  moderateTarget,
  asModerationAdmin,
} from '../../../../../test/support/moderation-content-graphql-operations.ts';

installModerationContentGraphQLTest();

const OWNER = 1;
const SUSPENDED_OWNER = 2;
const RATER = 3;

const VISIBLE = 1;
const HIDDEN = 2;
const OWNER_SUSPENDED = 3;
const DELETED = 4;
const MISSING_PRODUCT_ID = productIdOf(99);

const REASON = '規約に反する名称のため';
const PRODUCT_NOT_FOUND = 'product_not_found';
const PAGE_SIZE_MESSAGE = '表示する件数は1〜50件の整数で指定してください。';

const SCREENSHOT_FILE = 2;

// 1: 公開中(ロゴ・スクリーンショット・勝利したローンチ・評価あり) / 2: 非公開化中 / 3: 停止中の投稿者 / 4: 論理削除済み
async function seedProducts(): Promise<void> {
  await insertUser(OWNER);
  await insertUser(SUSPENDED_OWNER, {
    status: 'suspended',
    suspendedAt: T0,
  });
  await insertUser(RATER);
  await insertCategory(1);
  await insertProduct(VISIBLE, OWNER, {
    categoryId: categoryIdOf(1),
    createdAt: after(1_000),
  });
  await insertProduct(HIDDEN, OWNER, {
    hiddenAt: after(5_000),
    createdAt: after(2_000),
  });
  await insertProduct(OWNER_SUSPENDED, SUSPENDED_OWNER, {
    createdAt: after(3_000),
  });
  await insertProduct(DELETED, OWNER, {
    deletedAt: after(5_000),
    createdAt: after(4_000),
  });
  await insertFile(1, { id: logoFileIdOf(VISIBLE) });
  await insertFile(SCREENSHOT_FILE);
  await insertReason(SCREENSHOT_FILE, 'admin_action');
  await insertScreenshot(1, VISIBLE, 1, fileIdOf(SCREENSHOT_FILE));
  await insertLaunch(1, VISIBLE, {
    launchDate: MATCH_DATE,
    outcome: 'won',
    decidedAt: after(10_000),
  });
  await insertLaunch(3, OWNER_SUSPENDED, {
    launchDate: MATCH_DATE,
    outcome: 'lost',
    decidedAt: after(10_000),
  });
  await insertMatch({
    index: 1,
    columns: { decidedAt: after(10_000), decision: 'votes' },
    entries: [
      {
        index: 11,
        launch: 1,
        product: VISIBLE,
        owner: OWNER,
        columns: { upvoteCount: 12, result: 'won' },
      },
      {
        index: 12,
        launch: 3,
        product: OWNER_SUSPENDED,
        owner: SUSPENDED_OWNER,
        columns: { upvoteCount: 9, result: 'lost' },
      },
    ],
  });
  await insertRatings([
    {
      index: 1,
      product: VISIBLE,
      user: RATER,
      score: 5,
      columns: { updatedAt: after(2_000) },
    },
    {
      index: 2,
      product: VISIBLE,
      user: SUSPENDED_OWNER,
      score: 3,
      columns: { updatedAt: after(1_000) },
    },
    {
      index: 3,
      product: VISIBLE,
      user: OWNER,
      score: 1,
      columns: { updatedAt: after(3_000), invalidatedAt: after(3_000) },
    },
  ]);
}

const ownerOf = (index: number, suspended = false) => ({
  id: userIdOf(index),
  handle: `user${String(index)}`,
  nickname: `利用者${String(index)}`,
  suspended,
});

const OTHER_CATEGORY = Object.freeze({
  id: PRODUCT_CATEGORY_OTHER_ID,
  name: PRODUCT_CATEGORY_OTHER_NAME,
});

const NODES: Readonly<Record<string, AdminProductFields>> = Object.freeze({
  visible: {
    id: productIdOf(VISIBLE),
    handle: 'product1',
    name: 'プロダクト1',
    logo: {
      id: logoFileIdOf(VISIBLE),
      path: downloadPathOf(logoFileIdOf(VISIBLE)),
      image: {
        id: logoFileIdOf(VISIBLE),
        objectKey: objectKeyOf(1),
        fallbackFormat: 'PNG',
        width: 640,
        height: 480,
      },
      quarantined: false,
      quarantineReasons: [],
    },
    owner: ownerOf(OWNER),
    category: { id: categoryIdOf(1), name: 'カテゴリ1' },
    latestLaunchDate: MATCH_DATE,
    latestLaunchState: 'WON',
    visibility: 'VISIBLE',
  },
  hidden: {
    id: productIdOf(HIDDEN),
    handle: 'product2',
    name: 'プロダクト2',
    logo: null,
    owner: ownerOf(OWNER),
    category: OTHER_CATEGORY,
    latestLaunchDate: null,
    latestLaunchState: null,
    visibility: 'HIDDEN',
  },
  ownerSuspended: {
    id: productIdOf(OWNER_SUSPENDED),
    handle: 'product3',
    name: 'プロダクト3',
    logo: null,
    owner: ownerOf(SUSPENDED_OWNER, true),
    category: OTHER_CATEGORY,
    latestLaunchDate: MATCH_DATE,
    latestLaunchState: 'LOST',
    visibility: 'OWNER_SUSPENDED',
  },
});

describe('プロダクトの照会の認可', () => {
  test('利用者側の呼び出し元からはforbiddenで拒否する', async () => {
    const response = await fetchAdminProducts({ first: 50 });

    expect(codesOf(response)).toEqual(['forbidden']);
  });

  test('管理者のセッションが無ければunauthenticatedで拒否する', async () => {
    const response = await fetchAdminProduct(productIdOf(VISIBLE), {
      caller: 'admin',
    });

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test.each([
    ['閲覧のみの管理者', MODERATION_ADMINS.viewer],
    ['モデレーター', MODERATION_ADMINS.moderator],
    ['最上位管理者', MODERATION_ADMINS.superAdmin],
  ])(
    '%sに一覧・詳細・カテゴリの選択肢・評価の一覧を返す',
    async (_label, admin) => {
      await seedProducts();
      const options = asModerationAdmin(admin);

      const responses = await Promise.all([
        fetchAdminProducts({ first: 50 }, options),
        fetchAdminProduct(productIdOf(VISIBLE), options),
        fetchCategoryOptions(options),
        fetchAdminProductRatings(
          { productId: productIdOf(VISIBLE), first: 50 },
          options,
        ),
      ]);

      expect(responses.map(({ errors }) => errors)).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
    },
  );
});

describe('adminProducts', () => {
  test('論理削除済みを除くプロダクトを登録の新しい順に、ロゴ・投稿者・カテゴリ・最新のローンチ・公開状態とともに返す', async () => {
    await seedProducts();

    const response = await fetchAdminProducts({ first: 50 }, asViewer());

    expect(response.data?.adminProducts).toEqual({
      nodes: [NODES.ownerSuspended, NODES.hidden, NODES.visible],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });

  test.each([
    ['公開状態', { visibility: 'HIDDEN' }, [NODES.hidden]],
    ['ローンチの状態', { launchState: 'LOST' }, [NODES.ownerSuspended]],
    ['投稿者のハンドル', { ownerHandle: 'user2' }, [NODES.ownerSuspended]],
    ['カテゴリ', { categoryId: categoryIdOf(1) }, [NODES.visible]],
    ['名称', { name: 'プロダクト2' }, [NODES.hidden]],
  ])('%sで絞り込める', async (_label, filter, expected) => {
    await seedProducts();

    const response = await fetchAdminProducts(
      { filter, first: 50 },
      asViewer(),
    );

    expect(response.data?.adminProducts?.nodes).toEqual(expected);
  });

  test('前のページの続きの位置から次のページを返す', async () => {
    await seedProducts();

    const first = await fetchAdminProducts({ first: 2 }, asViewer());
    const next = await fetchAdminProducts(
      { first: 2, after: first.data?.adminProducts?.pageInfo.endCursor },
      asViewer(),
    );

    expect(first.data?.adminProducts?.pageInfo.hasNextPage).toBe(true);
    expect(next.data?.adminProducts).toEqual({
      nodes: [NODES.visible],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });

  test('不正な続きの位置は上流のinvalid_cursorと文言のまま返す', async () => {
    const response = await fetchAdminProducts(
      { first: 50, after: 'not-a-cursor' },
      asViewer(),
    );

    expect(codesOf(response)).toEqual(['invalid_cursor']);
    expect(response.errors?.[0]?.message).toBe(
      'ページの位置の指定が正しくありません。',
    );
  });

  test('表示する件数が51件ならvalidation_errorで拒否する', async () => {
    const response = await fetchAdminProducts({ first: 51 }, asViewer());

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      { field: 'first', code: 'too_big', message: PAGE_SIZE_MESSAGE },
    ]);
  });
});

describe('adminProduct', () => {
  test('説明・スクリーンショット・評価の要約・ローンチとマッチ結果を返す', async () => {
    await seedProducts();

    const response = await fetchAdminProduct(productIdOf(VISIBLE), asViewer());

    expect(response.data?.adminProduct).toEqual({
      product: NODES.visible,
      tagline: 'タグライン1',
      descriptionMarkdown: '説明文1',
      websiteUrl: 'https://product1.example/',
      screenshots: [
        {
          id: fileIdOf(SCREENSHOT_FILE),
          path: downloadPathOf(fileIdOf(SCREENSHOT_FILE)),
          image: {
            id: fileIdOf(SCREENSHOT_FILE),
            objectKey: null,
            fallbackFormat: 'PNG',
            width: 640,
            height: 480,
          },
          quarantined: true,
          quarantineReasons: ['ADMIN_ACTION'],
        },
      ],
      hiddenAt: null,
      latestHide: null,
      // 無効化した評価と停止中の評価者の評価は要約に数えない
      ratingSummary: { average: 5, count: 1 },
      launches: [
        {
          id: launchIdOf(1),
          number: 1,
          launchDate: MATCH_DATE,
          status: 'won',
          matches: [
            {
              id: matchIdOf(1),
              kind: 'qualifier',
              round: null,
              stage: null,
              matchDate: MATCH_DATE,
              upvoteCount: 12,
              result: 'won',
              phase: 'finished',
              decision: 'votes',
              opponentName: 'プロダクト3',
            },
          ],
        },
      ],
    });
  });

  test('非公開化の後は非公開化の日時と最新の理由を返す', async () => {
    await seedProducts();
    await moderateTarget(
      'hideProduct',
      { id: productIdOf(VISIBLE), reason: REASON },
      asModerator(),
    );

    const response = await fetchAdminProduct(productIdOf(VISIBLE), asViewer());

    expect(response.data?.adminProduct?.product.visibility).toBe('HIDDEN');
    expect(response.data?.adminProduct?.hiddenAt).toBe(
      MODERATION_TEST_NOW.toISOString(),
    );
    expect(response.data?.adminProduct?.latestHide).toEqual({
      reason: REASON,
      occurredAt: MODERATION_TEST_NOW.toISOString(),
    });
  });

  test.each([
    ['存在しない', MISSING_PRODUCT_ID],
    ['論理削除済みの', productIdOf(DELETED)],
  ])('%sプロダクトはnullを返す', async (_label, id) => {
    await seedProducts();

    const response = await fetchAdminProduct(id, asViewer());

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminProduct).toBeNull();
  });

  test('形式の違うIDは存在しないプロダクトと同じ文言のvalidation_errorで拒否する', async () => {
    const response = await fetchAdminProduct('not-a-ulid', asViewer());

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'id',
        code: 'invalid_format',
        message: 'プロダクトが見つかりません。',
      },
    ]);
  });
});

describe('adminModerationCategoryOptions', () => {
  test('追加したカテゴリと標準カテゴリを選択肢として返す', async () => {
    await seedProducts();

    const response = await fetchCategoryOptions(asViewer());

    expect(response.data?.adminModerationCategoryOptions).toEqual([
      { id: categoryIdOf(1), name: 'カテゴリ1' },
      OTHER_CATEGORY,
    ]);
  });
});

describe('adminProductRatings', () => {
  test('プロダクトの評価を更新の新しい順に、評価者と状態とともに返す', async () => {
    await seedProducts();

    const response = await fetchAdminProductRatings(
      { productId: productIdOf(VISIBLE), first: 50 },
      asViewer(),
    );

    const base = {
      productName: 'プロダクト1',
      productId: productIdOf(VISIBLE),
      createdAt: T0.toISOString(),
      latestInvalidation: null,
    };
    expect(response.data?.adminProductRatings).toEqual({
      nodes: [
        {
          ...base,
          id: ratingIdOf(3),
          rater: ownerOf(OWNER),
          score: 1,
          updatedAt: after(3_000).toISOString(),
          state: 'INVALIDATED',
        },
        {
          ...base,
          id: ratingIdOf(1),
          rater: ownerOf(RATER),
          score: 5,
          updatedAt: after(2_000).toISOString(),
          state: 'VALID',
        },
        {
          ...base,
          id: ratingIdOf(2),
          rater: ownerOf(SUSPENDED_OWNER, true),
          score: 3,
          updatedAt: after(1_000).toISOString(),
          state: 'VALID',
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });

  test('評価の無いプロダクトは空の一覧を返す', async () => {
    await seedProducts();

    const response = await fetchAdminProductRatings(
      { productId: productIdOf(HIDDEN), first: 50 },
      asViewer(),
    );

    expect(response.data?.adminProductRatings).toEqual({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });

  test('不正な続きの位置はinvalid_cursorで拒否する', async () => {
    await seedProducts();

    const response = await fetchAdminProductRatings(
      { productId: productIdOf(VISIBLE), first: 50, after: 'not-a-cursor' },
      asViewer(),
    );

    expect(codesOf(response)).toEqual(['invalid_cursor']);
  });
});

describe('hideProduct・unhideProduct', () => {
  test('閲覧のみの管理者の非公開化はforbiddenで拒否し、状態を変えない', async () => {
    await seedProducts();

    const response = await moderateTarget(
      'hideProduct',
      { id: productIdOf(VISIBLE), reason: REASON },
      asViewer(),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readModerationRows()).toEqual([]);
  });

  test('利用者側の呼び出し元からの非公開化は入力の検証より前にforbiddenで拒否する', async () => {
    const response = await moderateTarget('hideProduct', {
      id: 'not-a-ulid',
      reason: '',
    });

    expect(codesOf(response)).toEqual(['forbidden']);
  });

  test('モデレーターが非公開化すると状態が変わり、同じ操作の繰り返しは変化なしを返す', async () => {
    await seedProducts();

    const first = await moderateTarget(
      'hideProduct',
      { id: productIdOf(VISIBLE), reason: REASON },
      asModerator(),
    );
    const second = await moderateTarget(
      'hideProduct',
      { id: productIdOf(VISIBLE), reason: REASON },
      asModerator(),
    );

    expect(first.data?.hideProduct).toEqual({ changed: true });
    expect(second.data?.hideProduct).toEqual({ changed: false });
    expect(
      (await readModerationRows()).map(({ action, reason }) => ({
        action,
        reason,
      })),
    ).toEqual([{ action: 'product.hide', reason: REASON }]);
  });

  test('モデレーターが非公開化中のプロダクトを復元できる', async () => {
    await seedProducts();

    const response = await moderateTarget(
      'unhideProduct',
      { id: productIdOf(HIDDEN), reason: '誤った非公開化のため' },
      asModerator(),
    );

    expect(response.data?.unhideProduct).toEqual({ changed: true });
    const listed = await fetchAdminProducts(
      { filter: { visibility: 'HIDDEN' }, first: 50 },
      asViewer(),
    );
    expect(listed.data?.adminProducts?.nodes).toEqual([]);
  });

  test.each(['hideProduct', 'unhideProduct'] as const)(
    '%sは理由が無ければvalidation_errorで拒否する',
    async (operation) => {
      await seedProducts();

      const response = await moderateTarget(
        operation,
        { id: productIdOf(HIDDEN), reason: ' ' },
        asModerator(),
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        {
          field: 'reason',
          code: 'required',
          message: '理由を入力してください。',
        },
      ]);
    },
  );

  test.each([
    ['存在しない', MISSING_PRODUCT_ID],
    ['論理削除済みの', productIdOf(DELETED)],
  ])(
    '%sプロダクトの非公開化はproduct_not_foundで拒否する',
    async (_label, id) => {
      await seedProducts();

      const response = await moderateTarget(
        'hideProduct',
        { id, reason: REASON },
        asModerator(),
      );

      expect(codesOf(response)).toEqual([PRODUCT_NOT_FOUND]);
    },
  );

  test('理由が500文字を超えればvalidation_errorで拒否する', async () => {
    await seedProducts();

    const response = await moderateTarget(
      'hideProduct',
      { id: productIdOf(VISIBLE), reason: 'あ'.repeat(501) },
      asModerator(),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response).map(({ field }) => field)).toEqual(['reason']);
  });
});
