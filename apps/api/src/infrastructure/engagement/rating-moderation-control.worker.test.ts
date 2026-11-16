import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import { productRatings } from '../../../db/schema/engagement/product-ratings.ts';
import { D1RatingStore } from '../../../lib/workers/engagement/d1-rating-store.ts';
import { D1RatingStatements } from '../../../lib/workers/engagement/rating-statements.ts';
import {
  after,
  clearEngagementTables,
  countRatings,
  db,
  insertLaunch,
  insertProduct,
  insertRating,
  insertUser,
  productIdOf,
  ratingIdOf,
  readRating,
  T0,
  userIdOf,
} from '../../../lib/workers/engagement/testing/engagement-fixtures.ts';
import {
  D1RatingModerationControl,
  type RatingModerationControl,
} from './rating-moderation-control.ts';

const OWNER = 1;
const RATER = 2;
const OTHER_RATER = 3;
const PRODUCT = 1;
const LAUNCH = 1;
const RATING = 1;
const OTHER_RATING = 2;
const MISSING = 99;
const AT = after(60_000);
const LATER = after(120_000);

const control: RatingModerationControl = new D1RatingModerationControl(
  new D1RatingStatements(db),
);
const store = new D1RatingStore(db);

// 呼び出し側の記録の文の代わりに、別の評価を挿入する文を渡す
function recordStatement(index: number): BatchItem<'sqlite'> {
  return db.insert(productRatings).values({
    id: ratingIdOf(index),
    productId: productIdOf(PRODUCT),
    userId: userIdOf(index),
    score: 3,
    createdAt: AT,
    updatedAt: AT,
  });
}

async function summaryOfProduct() {
  return (await store.summaries([productIdOf(PRODUCT)])).get(
    productIdOf(PRODUCT),
  );
}

beforeEach(async () => {
  await clearEngagementTables();
  for (const index of [OWNER, RATER, OTHER_RATER, 10, 11]) {
    await insertUser(index, { emailVerifiedAt: T0 });
  }
  await insertProduct(PRODUCT, OWNER);
  await insertLaunch(LAUNCH, PRODUCT, {
    launchDate: '2026-11-10',
    outcome: 'won',
    decidedAt: T0,
  });
  await insertRating({
    index: RATING,
    product: PRODUCT,
    user: RATER,
    score: 5,
  });
  await insertRating({
    index: OTHER_RATING,
    product: PRODUCT,
    user: OTHER_RATER,
    score: 1,
  });
});

describe('RatingModerationControl.invalidate', () => {
  test('有効な評価に無効化の日時を入れてchangedを返し、渡した文を同じ一括の書き込みで確定する', async () => {
    const result = await control.invalidate({
      ratingId: ratingIdOf(RATING),
      at: AT,
      statements: [recordStatement(10), recordStatement(11)],
    });

    expect(result).toBe('changed');
    expect(await readRating(RATING)).toMatchObject({ invalidatedAt: AT });
    expect(await readRating(10)).toBeDefined();
    expect(await readRating(11)).toBeDefined();
  });

  test('渡した文が失敗すると無効化も取り消される', async () => {
    await expect(
      control.invalidate({
        ratingId: ratingIdOf(RATING),
        at: AT,
        statements: [recordStatement(OTHER_RATING)],
      }),
    ).rejects.toThrow(/UNIQUE constraint failed: product_ratings\./u);
    expect(await readRating(RATING)).toMatchObject({ invalidatedAt: null });
  });

  test('渡す文が無くても無効化を確定する', async () => {
    const result = await control.invalidate({
      ratingId: ratingIdOf(RATING),
      at: AT,
    });

    expect(result).toBe('changed');
    expect(await readRating(RATING)).toMatchObject({ invalidatedAt: AT });
  });

  test('無効化済みの評価は変えずにunchangedを返し、渡した文を流さない', async () => {
    await control.invalidate({ ratingId: ratingIdOf(RATING), at: AT });
    const before = await countRatings();

    const result = await control.invalidate({
      ratingId: ratingIdOf(RATING),
      at: LATER,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('unchanged');
    expect(await readRating(RATING)).toMatchObject({ invalidatedAt: AT });
    expect(await countRatings()).toBe(before);
  });

  test('存在しない評価はrating_not_foundの見つからないエラーにし、渡した文を流さない', async () => {
    const before = await countRatings();

    await expect(
      control.invalidate({
        ratingId: ratingIdOf(MISSING),
        at: AT,
        statements: [recordStatement(10)],
      }),
    ).rejects.toMatchObject({ kind: 'not_found', code: 'rating_not_found' });
    expect(await countRatings()).toBe(before);
  });

  test('評価者の退会で論理削除された評価はrating_not_foundの見つからないエラーにする', async () => {
    await insertRating({
      index: 3,
      product: PRODUCT,
      user: 10,
      columns: { deletedAt: T0 },
    });

    await expect(
      control.invalidate({ ratingId: ratingIdOf(3), at: AT }),
    ).rejects.toMatchObject({ kind: 'not_found', code: 'rating_not_found' });
  });
});

describe('RatingModerationControl.revalidate', () => {
  test('無効化済みの評価の無効化を取り消してchangedを返し、渡した文を同じ一括の書き込みで確定する', async () => {
    await control.invalidate({ ratingId: ratingIdOf(RATING), at: AT });

    const result = await control.revalidate({
      ratingId: ratingIdOf(RATING),
      at: LATER,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('changed');
    expect(await readRating(RATING)).toMatchObject({ invalidatedAt: null });
    expect(await readRating(10)).toBeDefined();
  });

  test('無効化されていない評価は変えずにunchangedを返し、渡した文を流さない', async () => {
    const before = await countRatings();

    const result = await control.revalidate({
      ratingId: ratingIdOf(RATING),
      at: AT,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('unchanged');
    expect(await countRatings()).toBe(before);
  });

  test('存在しない評価はrating_not_foundの見つからないエラーにする', async () => {
    await expect(
      control.revalidate({ ratingId: ratingIdOf(MISSING), at: AT }),
    ).rejects.toMatchObject({ kind: 'not_found', code: 'rating_not_found' });
  });
});

describe('RatingModerationControl: 集計への反映', () => {
  test('無効化の次の読み取りから平均値と件数に含めず、無効化の取消で元の平均値と件数に戻す', async () => {
    const before = await summaryOfProduct();

    await control.invalidate({ ratingId: ratingIdOf(RATING), at: AT });
    const invalidated = await summaryOfProduct();
    await control.revalidate({ ratingId: ratingIdOf(RATING), at: LATER });
    const restored = await summaryOfProduct();

    expect(before).toEqual({ average: 3, count: 2 });
    expect(invalidated).toEqual({ average: 1, count: 1 });
    expect(restored).toEqual(before);
  });
});
