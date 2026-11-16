import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import { productRatings } from '../../../db/schema/engagement/product-ratings.ts';
import { D1RatingStatements } from './rating-statements.ts';
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
} from './testing/engagement-fixtures.ts';

const OWNER = 1;
const RATER = 2;
const PRODUCT = 1;
const LAUNCH = 1;
const RATING = 1;
const AT = after(60_000);
const EARLIER = after(30_000);

const statements = new D1RatingStatements(db);

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

async function setRatingColumns(
  columns: Partial<typeof productRatings.$inferInsert>,
): Promise<void> {
  await db
    .update(productRatings)
    .set(columns)
    .where(eq(productRatings.id, ratingIdOf(RATING)));
}

// 状態を読んだ後、一括の書き込みの直前に別の操作が同じ評価を変えた状況を作る
function racingDatabase(race: () => Promise<void>): Database {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === 'batch') {
        return async (items: Parameters<Database['batch']>[0]) => {
          await race();
          return target.batch(items);
        };
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

beforeEach(async () => {
  await clearEngagementTables();
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(RATER, { emailVerifiedAt: T0 });
  for (const index of [10, 11]) {
    await insertUser(index, { emailVerifiedAt: T0 });
  }
  await insertProduct(PRODUCT, OWNER);
  await insertLaunch(LAUNCH, PRODUCT, {
    launchDate: '2026-11-10',
    outcome: 'won',
    decidedAt: T0,
  });
  await insertRating({ index: RATING, product: PRODUCT, user: RATER });
});

describe('RatingStatements.setInvalidated(無効化)', () => {
  test('有効な評価に無効化の日時を入れ、changedを返す', async () => {
    const before = await readRating(RATING);

    const result = await statements.setInvalidated({
      ratingId: ratingIdOf(RATING),
      invalidated: true,
      at: AT,
    });

    expect(result).toBe('changed');
    expect(await readRating(RATING)).toEqual({
      ...before,
      invalidatedAt: AT,
      updatedAt: AT,
    });
  });

  test('渡した文を同じ一括の書き込みで確定する', async () => {
    await statements.setInvalidated({
      ratingId: ratingIdOf(RATING),
      invalidated: true,
      at: AT,
      statements: [recordStatement(10), recordStatement(11)],
    });

    expect(await readRating(10)).toBeDefined();
    expect(await readRating(11)).toBeDefined();
  });

  test('渡した文が失敗すると無効化も取り消される', async () => {
    await expect(
      statements.setInvalidated({
        ratingId: ratingIdOf(RATING),
        invalidated: true,
        at: AT,
        statements: [recordStatement(RATING)],
      }),
    ).rejects.toThrow(/UNIQUE constraint failed/u);

    expect((await readRating(RATING))?.invalidatedAt).toBeNull();
  });

  test('既に無効化されていれば変更せず、渡した文も実行せずにunchangedを返す', async () => {
    await setRatingColumns({ invalidatedAt: EARLIER });
    const before = await readRating(RATING);

    const result = await statements.setInvalidated({
      ratingId: ratingIdOf(RATING),
      invalidated: true,
      at: AT,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('unchanged');
    expect(await readRating(RATING)).toEqual(before);
    expect(await readRating(10)).toBeUndefined();
  });

  test('存在しない評価は渡した文も実行せずにnot-foundを返す', async () => {
    const count = await countRatings();

    const result = await statements.setInvalidated({
      ratingId: ratingIdOf(50),
      invalidated: true,
      at: AT,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('not-found');
    expect(await countRatings()).toBe(count);
  });

  test('退会で論理削除された評価は渡した文も実行せずにnot-foundを返す', async () => {
    await setRatingColumns({ deletedAt: EARLIER });

    const result = await statements.setInvalidated({
      ratingId: ratingIdOf(RATING),
      invalidated: true,
      at: AT,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('not-found');
    expect((await readRating(RATING))?.invalidatedAt).toBeNull();
    expect(await readRating(10)).toBeUndefined();
  });

  test('状態を読んだ後に別の操作が無効化していれば、渡した文ごと取り消してunchangedを返す', async () => {
    const racing = new D1RatingStatements(
      racingDatabase(() => setRatingColumns({ invalidatedAt: EARLIER })),
    );

    const result = await racing.setInvalidated({
      ratingId: ratingIdOf(RATING),
      invalidated: true,
      at: AT,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('unchanged');
    expect((await readRating(RATING))?.invalidatedAt).toEqual(EARLIER);
    expect(await readRating(10)).toBeUndefined();
  });

  test('状態を読んだ後に評価者が退会していれば、渡した文ごと取り消してnot-foundを返す', async () => {
    const racing = new D1RatingStatements(
      racingDatabase(() => setRatingColumns({ deletedAt: EARLIER })),
    );

    const result = await racing.setInvalidated({
      ratingId: ratingIdOf(RATING),
      invalidated: true,
      at: AT,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('not-found');
    expect((await readRating(RATING))?.invalidatedAt).toBeNull();
    expect(await readRating(10)).toBeUndefined();
  });
});

describe('RatingStatements.setInvalidated(無効化の取消)', () => {
  beforeEach(async () => {
    await setRatingColumns({ invalidatedAt: EARLIER });
  });

  test('無効化された評価の無効化の日時を外し、changedを返す', async () => {
    const result = await statements.setInvalidated({
      ratingId: ratingIdOf(RATING),
      invalidated: false,
      at: AT,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('changed');
    expect(await readRating(RATING)).toMatchObject({
      invalidatedAt: null,
      updatedAt: AT,
      score: 3,
    });
    expect(await readRating(10)).toBeDefined();
  });

  test('無効化されていなければ変更せず、渡した文も実行せずにunchangedを返す', async () => {
    await setRatingColumns({ invalidatedAt: null });
    const before = await readRating(RATING);

    const result = await statements.setInvalidated({
      ratingId: ratingIdOf(RATING),
      invalidated: false,
      at: AT,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('unchanged');
    expect(await readRating(RATING)).toEqual(before);
    expect(await readRating(10)).toBeUndefined();
  });

  test('存在しない評価はnot-foundを返す', async () => {
    expect(
      await statements.setInvalidated({
        ratingId: ratingIdOf(50),
        invalidated: false,
        at: AT,
      }),
    ).toBe('not-found');
  });

  test('状態を読んだ後に別の操作が無効化を取り消していれば、渡した文ごと取り消してunchangedを返す', async () => {
    const racing = new D1RatingStatements(
      racingDatabase(() => setRatingColumns({ invalidatedAt: null })),
    );

    const result = await racing.setInvalidated({
      ratingId: ratingIdOf(RATING),
      invalidated: false,
      at: AT,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('unchanged');
    expect((await readRating(RATING))?.invalidatedAt).toBeNull();
    expect(await readRating(10)).toBeUndefined();
  });
});
