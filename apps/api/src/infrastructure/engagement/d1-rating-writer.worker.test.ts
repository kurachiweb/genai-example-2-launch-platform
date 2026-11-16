import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import { products } from '../../../db/schema/product/products.ts';
import type { RatingUpsert } from '../../../lib/core/engagement/ports.ts';
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
  readRatingsOf,
  T0,
  userIdOf,
} from '../../../lib/workers/engagement/testing/engagement-fixtures.ts';
import { D1RatingWriter } from './d1-rating-writer.ts';

const OWNER = 1;
const RATER = 2;
const LISTED_PRODUCT = 1;
const UNLISTED_PRODUCT = 2;

const AT = after(60_000);

const writer = new D1RatingWriter(db, new D1RatingStatements(db));

function ratingOf(
  index: number,
  overrides: Partial<RatingUpsert> = {},
): RatingUpsert {
  return {
    ratingId: ratingIdOf(index),
    productId: productIdOf(LISTED_PRODUCT),
    userId: userIdOf(RATER),
    score: 4,
    at: AT,
    ...overrides,
  };
}

beforeEach(async () => {
  await clearEngagementTables();
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(RATER, { emailVerifiedAt: T0 });
  await insertProduct(LISTED_PRODUCT, OWNER);
  await insertLaunch(1, LISTED_PRODUCT, {
    launchDate: '2026-11-10',
    outcome: 'won',
    decidedAt: T0,
  });
  await insertProduct(UNLISTED_PRODUCT, OWNER);
  await insertLaunch(2, UNLISTED_PRODUCT);
});

describe('D1RatingWriter.upsert: 確定', () => {
  test('初めての評価を作成と更新の日時を入れて保存する', async () => {
    const outcome = await writer.upsert(ratingOf(1));

    expect(outcome).toBe('committed');
    expect(await readRating(1)).toMatchObject({
      productId: productIdOf(LISTED_PRODUCT),
      userId: userIdOf(RATER),
      score: 4,
      createdAt: AT,
      updatedAt: AT,
      invalidatedAt: null,
    });
  });

  test('2回目の評価は同じ行の値と更新の日時だけを上書きし、IDと作成日時と無効化の印を保つ', async () => {
    await insertRating({
      index: 1,
      product: LISTED_PRODUCT,
      user: RATER,
      score: 2,
      columns: { invalidatedAt: after(1) },
    });

    const outcome = await writer.upsert(ratingOf(2, { score: 5 }));

    expect(outcome).toBe('committed');
    expect(await readRatingsOf(LISTED_PRODUCT)).toEqual([
      expect.objectContaining({
        id: ratingIdOf(1),
        score: 5,
        createdAt: T0,
        updatedAt: AT,
        invalidatedAt: after(1),
      }),
    ]);
  });
});

describe('D1RatingWriter.upsert: 条件の違反', () => {
  test('判定の後にプロダクトが非公開化されていれば、評価を書き込まずrejectedを返す', async () => {
    await insertRating({
      index: 1,
      product: LISTED_PRODUCT,
      user: RATER,
      score: 2,
    });
    await db
      .update(products)
      .set({ hiddenAt: T0 })
      .where(eq(products.id, productIdOf(LISTED_PRODUCT)));

    const outcome = await writer.upsert(ratingOf(2, { score: 5 }));

    expect(outcome).toBe('rejected');
    expect(await readRatingsOf(LISTED_PRODUCT)).toEqual([
      expect.objectContaining({ id: ratingIdOf(1), score: 2, updatedAt: T0 }),
    ]);
  });

  test('判定の後に評価者が停止されていれば、評価を書き込まずrejectedを返す', async () => {
    await db
      .update(users)
      .set({ status: 'suspended' })
      .where(eq(users.id, userIdOf(RATER)));

    const outcome = await writer.upsert(ratingOf(1));

    expect(outcome).toBe('rejected');
    expect(await countRatings()).toBe(0);
  });

  test('勝ちのローンチが無く未掲載のプロダクトへの評価を書き込まずrejectedを返す', async () => {
    const outcome = await writer.upsert(
      ratingOf(1, { productId: productIdOf(UNLISTED_PRODUCT) }),
    );

    expect(outcome).toBe('rejected');
    expect(await countRatings()).toBe(0);
  });

  test('条件の違反以外のD1の例外は、rejectedにせずそのまま投げる', async () => {
    await insertRating({
      index: 1,
      product: LISTED_PRODUCT,
      user: OWNER,
      score: 2,
    });

    await expect(writer.upsert(ratingOf(1))).rejects.toThrow(
      /UNIQUE constraint failed: product_ratings\.id/u,
    );
    expect(await countRatings()).toBe(1);
  });
});
