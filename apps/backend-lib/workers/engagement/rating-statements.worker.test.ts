import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { products } from '../../../db/schema/product/products.ts';
import type { RatingUpsert } from '../../core/engagement/ports.ts';
import { D1CommentStatements } from './comment-statements.ts';
import { isEngagementGuardViolation } from './engagement-guard.ts';
import { D1RatingStatements } from './rating-statements.ts';
import {
  after,
  clearEngagementTables,
  commentIdOf,
  countComments,
  countRatings,
  db,
  insertLaunch,
  insertProduct,
  insertRating,
  insertUser,
  launchIdOf,
  productIdOf,
  RATING_GUARD_VIOLATION,
  ratingIdOf,
  readRating,
  readRatingsOf,
  T0,
  userIdOf,
} from './testing/engagement-fixtures.ts';

const OWNER = 1;
const RATER = 2;
const UNVERIFIED = 3;
const LISTED_PRODUCT = 1;
const UNLISTED_PRODUCT = 2;
const WON_LAUNCH = 1;
const UNLISTED_LAUNCH = 2;

const AT = after(60_000);
const LATER = after(120_000);

const statements = new D1RatingStatements(db);
const comments = new D1CommentStatements(db);

function rating(overrides: Partial<RatingUpsert> = {}): RatingUpsert {
  return {
    ratingId: ratingIdOf(1),
    productId: productIdOf(LISTED_PRODUCT),
    userId: userIdOf(RATER),
    score: 4,
    at: AT,
    ...overrides,
  };
}

async function upsert(
  input: RatingUpsert,
  ...rest: BatchItem<'sqlite'>[]
): Promise<void> {
  await db.batch([statements.upsertStatement(input), ...rest]);
}

async function rejectionOf(
  input: RatingUpsert,
  ...rest: BatchItem<'sqlite'>[]
): Promise<unknown> {
  try {
    await upsert(input, ...rest);
  } catch (error) {
    return error;
  }
  throw new Error('一括の書き込みが失敗しませんでした');
}

// 違反の原因が条件の列であること、一括の書き込みの他の文も残らないことを確かめる
async function expectRejected(input: RatingUpsert): Promise<void> {
  const before = await countRatings();
  await expect(
    upsert(
      input,
      statements.upsertStatement(
        rating({ ratingId: ratingIdOf(99), userId: userIdOf(OWNER) }),
      ),
    ),
  ).rejects.toThrow(RATING_GUARD_VIOLATION);
  expect(await countRatings()).toBe(before);
}

beforeEach(async () => {
  await clearEngagementTables();
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(RATER, { emailVerifiedAt: T0 });
  await insertUser(UNVERIFIED);
  await insertProduct(LISTED_PRODUCT, OWNER);
  await insertLaunch(WON_LAUNCH, LISTED_PRODUCT, {
    launchDate: '2026-11-10',
    outcome: 'won',
    decidedAt: T0,
  });
  await insertProduct(UNLISTED_PRODUCT, OWNER);
  await insertLaunch(UNLISTED_LAUNCH, UNLISTED_PRODUCT);
});

describe('RatingStatements.upsertStatement', () => {
  test('初めての評価を作成と更新の日時を入れて保存する', async () => {
    await upsert(rating());

    expect(await readRating(1)).toEqual({
      id: ratingIdOf(1),
      productId: productIdOf(LISTED_PRODUCT),
      userId: userIdOf(RATER),
      score: 4,
      invalidatedAt: null,
      createdAt: AT,
      updatedAt: AT,
      deletedAt: null,
    });
  });

  test('同じ利用者の2回目の評価は、最初の行の識別と作成の日時のまま値と更新の日時を上書きし1件のままにする', async () => {
    await upsert(rating());

    await upsert(rating({ ratingId: ratingIdOf(2), score: 2, at: LATER }));

    expect(await readRatingsOf(LISTED_PRODUCT)).toEqual([
      expect.objectContaining({
        id: ratingIdOf(1),
        score: 2,
        createdAt: AT,
        updatedAt: LATER,
      }),
    ]);
  });

  test('無効化された評価を上書きしても無効化の印を保つ(仮3)', async () => {
    await insertRating({
      index: 1,
      product: LISTED_PRODUCT,
      user: RATER,
      score: 1,
      columns: { invalidatedAt: T0 },
    });

    await upsert(rating({ ratingId: ratingIdOf(2), score: 5, at: LATER }));

    expect(await readRating(1)).toMatchObject({
      score: 5,
      invalidatedAt: T0,
      updatedAt: LATER,
    });
    expect(await countRatings()).toBe(1);
  });

  test('別の利用者の評価は別の行として保存する', async () => {
    await upsert(rating());

    await upsert(
      rating({ ratingId: ratingIdOf(2), userId: userIdOf(OWNER), score: 1 }),
    );

    expect(await countRatings()).toBe(2);
  });

  test.each([
    [
      'プロダクトが非公開化された',
      () =>
        db
          .update(products)
          .set({ hiddenAt: AT })
          .where(eq(products.id, productIdOf(LISTED_PRODUCT))),
    ],
    [
      'プロダクトが論理削除された',
      () =>
        db
          .update(products)
          .set({ deletedAt: AT })
          .where(eq(products.id, productIdOf(LISTED_PRODUCT))),
    ],
    [
      'プロダクトの投稿者が停止された',
      () =>
        db
          .update(users)
          .set({ status: 'suspended' })
          .where(eq(users.id, userIdOf(OWNER))),
    ],
    [
      'プロダクトの勝ったローンチが取り消された',
      () =>
        db
          .update(productLaunches)
          .set({ cancelledAt: AT })
          .where(eq(productLaunches.id, launchIdOf(WON_LAUNCH))),
    ],
    [
      '評価者が停止された',
      () =>
        db
          .update(users)
          .set({ status: 'suspended' })
          .where(eq(users.id, userIdOf(RATER))),
    ],
    [
      '評価者が退会した',
      () =>
        db
          .update(users)
          .set({ deletedAt: AT })
          .where(eq(users.id, userIdOf(RATER))),
    ],
  ])('%s後は一括の書き込みごと失敗する', async (_, change) => {
    await change();

    await expectRejected(rating());
  });

  test('未掲載のプロダクトへの評価は一括の書き込みごと失敗する', async () => {
    await expectRejected(rating({ productId: productIdOf(UNLISTED_PRODUCT) }));
  });

  test('評価者がメールアドレスを確認していなければ一括の書き込みごと失敗する', async () => {
    await expectRejected(rating({ userId: userIdOf(UNVERIFIED) }));
  });

  test('存在しない利用者の評価は一括の書き込みごと失敗する', async () => {
    await expectRejected(rating({ userId: userIdOf(9) }));
  });

  test('既存の評価があっても、条件の違反では上書きせず一括の書き込みごと失敗する', async () => {
    await upsert(rating());
    await db
      .update(products)
      .set({ hiddenAt: AT })
      .where(eq(products.id, productIdOf(LISTED_PRODUCT)));

    await expectRejected(rating({ score: 1, at: LATER }));

    expect(await readRating(1)).toMatchObject({ score: 4, updatedAt: AT });
  });

  test('評価の違反とコメントの違反を同じ判定で条件の違反と分かる', async () => {
    const ratingViolation = await rejectionOf(
      rating({ productId: productIdOf(UNLISTED_PRODUCT) }),
    );
    const commentViolation = await rejectionOf(
      rating(),
      comments.insertStatement({
        commentId: commentIdOf(1),
        productId: productIdOf(UNLISTED_PRODUCT),
        launchId: launchIdOf(UNLISTED_LAUNCH),
        parent: null,
        authorUserId: userIdOf(RATER),
        bodyMarkdown: '本文',
        requireListed: true,
        at: AT,
      }),
    );

    expect(isEngagementGuardViolation(ratingViolation)).toBe(true);
    expect(isEngagementGuardViolation(commentViolation)).toBe(true);
    expect(await countRatings()).toBe(0);
    expect(await countComments()).toBe(0);
  });

  test('条件の違反でない失敗は条件の違反と判定しない', async () => {
    await upsert(rating());

    const error = await rejectionOf(
      rating({ ratingId: ratingIdOf(1), userId: userIdOf(OWNER) }),
    );

    expect(error).toEqual(expect.any(Error));
    expect(isEngagementGuardViolation(error)).toBe(false);
    expect(isEngagementGuardViolation(new Error('D1_ERROR'))).toBe(false);
    expect(isEngagementGuardViolation('NOT NULL')).toBe(false);
  });
});
