import { beforeEach, describe, expect, test } from 'vitest';

import { OWN_PRODUCT_RATING_MESSAGE } from '../../../../../common-lib/engagement/engagement-rules.ts';
import {
  after,
  insertLaunch,
  insertProduct,
  insertRating,
  insertUser,
  productIdOf,
  readRatingsOf,
  T0,
  userIdOf,
} from '../../../../../lib/workers/engagement/testing/engagement-fixtures.ts';
import { ENGAGEMENT_ERRORS } from '../../../../application/engagement/engagement-errors.ts';
import {
  cancelProductRating,
  ENGAGEMENT_TEST_NOW,
  fetchProductRating,
  installEngagementGraphQLTest,
  issueEngagementUserSession,
  rateProduct,
} from '../../../../../test/support/engagement-graphql-operations.ts';
import {
  botTokenFor,
  type GatewayCallOptions,
  stubExternalServices,
} from '../../../../../test/support/graphql-gateway.ts';
import {
  codesOf,
  detailsOf,
} from '../../../../../test/support/product-graphql-operations.ts';

installEngagementGraphQLTest();

const OWNER = 1;
const RATER = 2;
const NEWCOMER = 3;
const UNVERIFIED = 4;
const SUSPENDED = 5;
const INVALIDATED_RATER = 6;

const LISTED = 1;
const UNLISTED = 2;
const MISSING = 99;

const WON_LAUNCH = 1;

const RATER_RATING = 1;
const UNVERIFIED_RATING = 2;
const INVALIDATED_RATING = 3;

const VALIDATION_MESSAGE = '入力内容を確認してください。';
const RATING_MESSAGE = '評価は1〜5で選んでください。';

// 評価の操作にbot対策を課さないことを確かめるため、どの操作にもトークンを添えて送る
const BOT_TOKEN = botTokenFor('rating');

const INVALIDATED_AT = after(60_000);

// プロダクト1は利用者1の掲載中のプロダクトで、利用者2が4、未確認の利用者4が3、利用者6が管理者に無効化された1で評価済み。プロダクト2は利用者1の未掲載のプロダクト
async function seed(): Promise<void> {
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(RATER, { emailVerifiedAt: T0 });
  await insertUser(NEWCOMER, { emailVerifiedAt: T0 });
  await insertUser(UNVERIFIED);
  await insertUser(SUSPENDED, {
    emailVerifiedAt: T0,
    status: 'suspended',
    suspendedAt: T0,
  });
  await insertUser(INVALIDATED_RATER, { emailVerifiedAt: T0 });
  await insertProduct(LISTED, OWNER);
  await insertLaunch(WON_LAUNCH, LISTED, {
    launchDate: '2026-11-05',
    outcome: 'won',
    decidedAt: T0,
  });
  await insertProduct(UNLISTED, OWNER);
  await insertRating({
    index: RATER_RATING,
    product: LISTED,
    user: RATER,
    score: 4,
  });
  await insertRating({
    index: UNVERIFIED_RATING,
    product: LISTED,
    user: UNVERIFIED,
    score: 3,
  });
  await insertRating({
    index: INVALIDATED_RATING,
    product: LISTED,
    user: INVALIDATED_RATER,
    score: 1,
    columns: { invalidatedAt: INVALIDATED_AT },
  });
}

beforeEach(seed);

const ratingOf = (
  fields: {
    readonly average: number | null;
    readonly count: number;
    readonly viewerScore: number | null;
  },
  product = LISTED,
) => ({ productId: productIdOf(product), ...fields });

const SEEDED_SUMMARY = { average: 3.5, count: 2 } as const;

async function scoresOf(product: number) {
  const rows = await readRatingsOf(product);
  return Object.fromEntries(
    rows.map(({ userId, score, invalidatedAt }) => [
      userId,
      { score, invalidatedAt },
    ]),
  );
}

async function sessionOf(user: number): Promise<GatewayCallOptions> {
  return {
    sessionToken: await issueEngagementUserSession(user),
    botToken: BOT_TOKEN,
  };
}

describe('productRating: 評価欄の値の照会', () => {
  test('呼び出し元が利用者側でなければforbiddenで拒否する', async () => {
    const response = await fetchProductRating(productIdOf(LISTED), {
      caller: 'admin',
    });

    expect(codesOf(response)).toEqual(['forbidden']);
  });

  test.each(
    ['I', 'L', 'O', 'U']
      .map((letter) => `${productIdOf(LISTED).slice(0, 25)}${letter}`)
      .concat(productIdOf(LISTED).toLowerCase()),
  )(
    '大文字のULIDでないプロダクトのID(%s)を、評価先が見つからない文言のvalidation_errorにする',
    async (productId) => {
      const response = await fetchProductRating(productId);

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        {
          field: 'productId',
          code: 'invalid_format',
          message: ENGAGEMENT_ERRORS.rating_target_not_found.message,
        },
      ]);
    },
  );

  test('ULIDでないプロダクトのIDを、評価先が見つからない文言のvalidation_errorにする', async () => {
    const response = await fetchProductRating('product-1');

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'productId',
        code: 'invalid_format',
        message: ENGAGEMENT_ERRORS.rating_target_not_found.message,
      },
    ]);
  });

  test('未ログインの閲覧者には、無効化した評価を除く平均と件数を自分の評価nullで返し、bot判定を使わない', async () => {
    const calls = stubExternalServices();

    const response = await fetchProductRating(productIdOf(LISTED), {
      botToken: BOT_TOKEN,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.productRating).toEqual(
      ratingOf({ ...SEEDED_SUMMARY, viewerScore: null }),
    );
    expect(calls.siteverifyTokens).toEqual([]);
  });

  test('ログイン中の閲覧者には自分の評価を返し、未評価ならnullを返す', async () => {
    const rater = await fetchProductRating(
      productIdOf(LISTED),
      await sessionOf(RATER),
    );
    const newcomer = await fetchProductRating(
      productIdOf(LISTED),
      await sessionOf(NEWCOMER),
    );

    expect(rater.data?.productRating).toEqual(
      ratingOf({ ...SEEDED_SUMMARY, viewerScore: 4 }),
    );
    expect(newcomer.data?.productRating).toEqual(
      ratingOf({ ...SEEDED_SUMMARY, viewerScore: null }),
    );
  });

  test('管理者に無効化された評価は、集計に含めずに本人の評価として返す', async () => {
    const response = await fetchProductRating(
      productIdOf(LISTED),
      await sessionOf(INVALIDATED_RATER),
    );

    expect(response.data?.productRating).toEqual(
      ratingOf({ ...SEEDED_SUMMARY, viewerScore: 1 }),
    );
  });

  test('未掲載の他者のプロダクトと存在しないプロダクトはnullを返し、未掲載でも投稿者本人には自分の評価nullで返す', async () => {
    const newcomer = await sessionOf(NEWCOMER);

    const unlisted = await fetchProductRating(productIdOf(UNLISTED), newcomer);
    const missing = await fetchProductRating(productIdOf(MISSING), newcomer);
    const anonymous = await fetchProductRating(productIdOf(UNLISTED));
    const owner = await fetchProductRating(
      productIdOf(UNLISTED),
      await sessionOf(OWNER),
    );

    for (const response of [unlisted, missing, anonymous]) {
      expect(response.errors).toBeUndefined();
      expect(response.data?.productRating).toBeNull();
    }
    expect(owner.data?.productRating).toEqual(
      ratingOf({ average: null, count: 0, viewerScore: null }, UNLISTED),
    );
  });
});

type Operation = 'rateProduct' | 'cancelProductRating';

const OPERATIONS: readonly Operation[] = ['rateProduct', 'cancelProductRating'];

function send(
  operation: Operation,
  product: number,
  options: GatewayCallOptions,
) {
  return operation === 'rateProduct'
    ? rateProduct({ productId: productIdOf(product), score: 5 }, options)
    : cancelProductRating(productIdOf(product), options);
}

describe('rateProduct・cancelProductRating: 拒否', () => {
  test.each(OPERATIONS)(
    '管理者側の呼び出し元からの%sをforbiddenで拒否する',
    async (operation) => {
      const response = await send(operation, LISTED, {
        ...(await sessionOf(RATER)),
        caller: 'admin',
      });

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(await scoresOf(LISTED)).toMatchObject({
        [userIdOf(RATER)]: { score: 4 },
      });
    },
  );

  test.each(OPERATIONS)(
    'ログインしていなければ%sをunauthenticatedで拒否する',
    async (operation) => {
      const before = await scoresOf(LISTED);

      const response = await send(operation, LISTED, { botToken: BOT_TOKEN });

      expect(codesOf(response)).toEqual(['unauthenticated']);
      expect(await scoresOf(LISTED)).toEqual(before);
    },
  );

  test.each(OPERATIONS)(
    '停止中の利用者の%sをaccount_unavailableで拒否する',
    async (operation) => {
      await insertRating({
        index: 9,
        product: LISTED,
        user: SUSPENDED,
        score: 2,
      });
      const before = await scoresOf(LISTED);

      const response = await send(
        operation,
        LISTED,
        await sessionOf(SUSPENDED),
      );

      expect(codesOf(response)).toEqual(['account_unavailable']);
      expect(await scoresOf(LISTED)).toEqual(before);
    },
  );

  test('メールアドレスが未確認の利用者の評価をemail_not_verifiedで拒否し、評価を変えない', async () => {
    const before = await scoresOf(LISTED);

    const response = await rateProduct(
      { productId: productIdOf(LISTED), score: 5 },
      await sessionOf(UNVERIFIED),
    );

    expect(codesOf(response)).toEqual(['email_not_verified']);
    expect(await scoresOf(LISTED)).toEqual(before);
  });

  test.each(OPERATIONS)(
    '未掲載の他者のプロダクトと存在しないプロダクトへの%sをrating_target_not_foundにする',
    async (operation) => {
      const options = await sessionOf(NEWCOMER);

      const unlisted = await send(operation, UNLISTED, options);
      const missing = await send(operation, MISSING, options);

      for (const response of [unlisted, missing]) {
        expect(codesOf(response)).toEqual(['rating_target_not_found']);
        expect(response.errors?.[0]?.message).toBe(
          ENGAGEMENT_ERRORS.rating_target_not_found.message,
        );
      }
      expect(await readRatingsOf(UNLISTED)).toEqual([]);
    },
  );

  test.each(OPERATIONS)(
    'ULIDでないプロダクトのIDへの%sを、評価先が見つからない文言のvalidation_errorにする',
    async (operation) => {
      const options = await sessionOf(RATER);

      const response =
        operation === 'rateProduct'
          ? await rateProduct({ productId: 'product-1', score: 5 }, options)
          : await cancelProductRating('product-1', options);

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        {
          field: 'productId',
          code: 'invalid_format',
          message: ENGAGEMENT_ERRORS.rating_target_not_found.message,
        },
      ]);
    },
  );

  test.each([0, 6, -1])(
    '評価の%iを、文言規則の文言のvalidation_errorにして評価を変えない',
    async (score) => {
      const before = await scoresOf(LISTED);

      const response = await rateProduct(
        { productId: productIdOf(LISTED), score },
        await sessionOf(RATER),
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(response.errors?.[0]?.message).toBe(VALIDATION_MESSAGE);
      expect(detailsOf(response)).toEqual([
        { field: 'score', code: 'invalid_value', message: RATING_MESSAGE },
      ]);
      expect(await scoresOf(LISTED)).toEqual(before);
    },
  );

  test('投稿者本人の評価をrating_own_productで拒否し、未掲載の自分のプロダクトでも保存しない', async () => {
    const options = await sessionOf(OWNER);

    const listed = await rateProduct(
      { productId: productIdOf(LISTED), score: 5 },
      options,
    );
    const unlisted = await rateProduct(
      { productId: productIdOf(UNLISTED), score: 5 },
      options,
    );

    for (const response of [listed, unlisted]) {
      expect(codesOf(response)).toEqual(['rating_own_product']);
      expect(response.errors?.[0]?.message).toBe(OWN_PRODUCT_RATING_MESSAGE);
    }
    expect(await scoresOf(LISTED)).not.toHaveProperty(userIdOf(OWNER));
    expect(await readRatingsOf(UNLISTED)).toEqual([]);
  });
});

describe('rateProduct: 評価', () => {
  test('未評価の利用者の評価を保存し、bot判定を使わずに評価欄の値を返す', async () => {
    const calls = stubExternalServices();

    const response = await rateProduct(
      { productId: productIdOf(LISTED), score: 5 },
      await sessionOf(NEWCOMER),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.rateProduct).toEqual(
      ratingOf({ average: 4, count: 3, viewerScore: 5 }),
    );
    expect(calls.siteverifyTokens).toEqual([]);
    expect(await scoresOf(LISTED)).toMatchObject({
      [userIdOf(NEWCOMER)]: { score: 5, invalidatedAt: null },
    });
  });

  test('評価済みの利用者の評価を1件のまま上書きする', async () => {
    const response = await rateProduct(
      { productId: productIdOf(LISTED), score: 2 },
      await sessionOf(RATER),
    );

    expect(response.data?.rateProduct).toEqual(
      ratingOf({ average: 2.5, count: 2, viewerScore: 2 }),
    );
    const rows = await readRatingsOf(LISTED);
    expect(rows.filter(({ userId }) => userId === userIdOf(RATER))).toEqual([
      expect.objectContaining({ score: 2, updatedAt: ENGAGEMENT_TEST_NOW }),
    ]);
  });

  test('管理者に無効化された評価の上書きは、無効化を保ったまま新しい値を本人の評価として返す', async () => {
    const response = await rateProduct(
      { productId: productIdOf(LISTED), score: 5 },
      await sessionOf(INVALIDATED_RATER),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.rateProduct).toEqual(
      ratingOf({ ...SEEDED_SUMMARY, viewerScore: 5 }),
    );
    expect(await scoresOf(LISTED)).toMatchObject({
      [userIdOf(INVALIDATED_RATER)]: {
        score: 5,
        invalidatedAt: INVALIDATED_AT,
      },
    });
  });
});

describe('cancelProductRating: 取消', () => {
  test('自分の評価を物理削除し、bot判定を使わずに評価欄の値を返す', async () => {
    const calls = stubExternalServices();

    const response = await cancelProductRating(
      productIdOf(LISTED),
      await sessionOf(RATER),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.cancelProductRating).toEqual(
      ratingOf({ average: 3, count: 1, viewerScore: null }),
    );
    expect(calls.siteverifyTokens).toEqual([]);
    expect(await scoresOf(LISTED)).not.toHaveProperty(userIdOf(RATER));
  });

  test('メールアドレスが未確認の利用者でも自分の評価を取り消せる', async () => {
    const response = await cancelProductRating(
      productIdOf(LISTED),
      await sessionOf(UNVERIFIED),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.cancelProductRating).toEqual(
      ratingOf({ average: 4, count: 1, viewerScore: null }),
    );
    expect(await scoresOf(LISTED)).not.toHaveProperty(userIdOf(UNVERIFIED));
  });

  test('管理者に無効化された評価を無効化の状態ごと物理削除する', async () => {
    const response = await cancelProductRating(
      productIdOf(LISTED),
      await sessionOf(INVALIDATED_RATER),
    );

    expect(response.data?.cancelProductRating).toEqual(
      ratingOf({ ...SEEDED_SUMMARY, viewerScore: null }),
    );
    expect(await scoresOf(LISTED)).not.toHaveProperty(
      userIdOf(INVALIDATED_RATER),
    );
  });

  test('評価の無い利用者と投稿者本人の取消は、何も消さずに自分の評価nullの値を返す', async () => {
    const before = await scoresOf(LISTED);

    const newcomer = await cancelProductRating(
      productIdOf(LISTED),
      await sessionOf(NEWCOMER),
    );
    const owner = await cancelProductRating(
      productIdOf(LISTED),
      await sessionOf(OWNER),
    );

    for (const response of [newcomer, owner]) {
      expect(response.errors).toBeUndefined();
      expect(response.data?.cancelProductRating).toEqual(
        ratingOf({ ...SEEDED_SUMMARY, viewerScore: null }),
      );
    }
    expect(await scoresOf(LISTED)).toEqual(before);
  });
});
