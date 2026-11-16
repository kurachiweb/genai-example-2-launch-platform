import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import { insertProducts } from '../product/testing/product-fixtures.ts';
import { D1RatingStore } from './d1-rating-store.ts';
import {
  after,
  clearEngagementTables,
  countRatings,
  db,
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
const OTHER_RATER = 3;
const WITHDRAWN = 4;
const SUSPENDED = 5;
const PRODUCT = 1;
const OTHER_PRODUCT = 2;
const EMPTY_PRODUCT = 3;

const store = new D1RatingStore(db);

async function setUserColumns(
  index: number,
  columns: Partial<typeof users.$inferInsert>,
): Promise<void> {
  await db
    .update(users)
    .set(columns)
    .where(eq(users.id, userIdOf(index)));
}

beforeEach(async () => {
  await clearEngagementTables();
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(RATER, { emailVerifiedAt: T0 });
  await insertUser(OTHER_RATER, { emailVerifiedAt: T0 });
  await insertUser(WITHDRAWN, { emailVerifiedAt: T0, deletedAt: after(1) });
  await insertUser(SUSPENDED, { emailVerifiedAt: T0, status: 'suspended' });
  await insertProduct(PRODUCT, OWNER);
  await insertProduct(OTHER_PRODUCT, OWNER);
  await insertProduct(EMPTY_PRODUCT, OWNER);
});

describe('D1RatingStore.remove', () => {
  test('自分の評価を物理削除してtrueを返し、他者と他のプロダクトの評価は残す', async () => {
    await insertRating({ index: 1, product: PRODUCT, user: RATER });
    await insertRating({ index: 2, product: PRODUCT, user: OTHER_RATER });
    await insertRating({ index: 3, product: OTHER_PRODUCT, user: RATER });

    const removed = await store.remove({
      productId: productIdOf(PRODUCT),
      userId: userIdOf(RATER),
    });

    expect(removed).toBe(true);
    expect(await readRating(1)).toBeUndefined();
    expect(await readRating(2)).toBeDefined();
    expect(await readRating(3)).toBeDefined();
  });

  test('評価が無くても失敗せずfalseを返す', async () => {
    expect(
      await store.remove({
        productId: productIdOf(PRODUCT),
        userId: userIdOf(RATER),
      }),
    ).toBe(false);
  });

  test('無効化された評価も無効化の印ごと行を消す(仮3)', async () => {
    await insertRating({
      index: 1,
      product: PRODUCT,
      user: RATER,
      columns: { invalidatedAt: T0 },
    });

    expect(
      await store.remove({
        productId: productIdOf(PRODUCT),
        userId: userIdOf(RATER),
      }),
    ).toBe(true);
    expect(await countRatings()).toBe(0);
  });
});

describe('D1RatingStore.findScore', () => {
  test('自分の評価の識別と値を返す', async () => {
    await insertRating({ index: 1, product: PRODUCT, user: RATER, score: 5 });
    await insertRating({
      index: 2,
      product: PRODUCT,
      user: OTHER_RATER,
      score: 1,
    });

    expect(
      await store.findScore({
        productId: productIdOf(PRODUCT),
        userId: userIdOf(RATER),
      }),
    ).toEqual({ ratingId: ratingIdOf(1), score: 5 });
  });

  test('無効化された評価も自分の評価として返す(仮3)', async () => {
    await insertRating({
      index: 1,
      product: PRODUCT,
      user: RATER,
      score: 2,
      columns: { invalidatedAt: T0 },
    });

    expect(
      await store.findScore({
        productId: productIdOf(PRODUCT),
        userId: userIdOf(RATER),
      }),
    ).toEqual({ ratingId: ratingIdOf(1), score: 2 });
  });

  test('評価が無ければundefinedを返す', async () => {
    await insertRating({ index: 1, product: OTHER_PRODUCT, user: RATER });

    expect(
      await store.findScore({
        productId: productIdOf(PRODUCT),
        userId: userIdOf(RATER),
      }),
    ).toBeUndefined();
  });

  test('論理削除された評価は返さない', async () => {
    await insertRating({
      index: 1,
      product: PRODUCT,
      user: RATER,
      columns: { deletedAt: T0 },
    });

    expect(
      await store.findScore({
        productId: productIdOf(PRODUCT),
        userId: userIdOf(RATER),
      }),
    ).toBeUndefined();
  });
});

describe('D1RatingStore.summaries', () => {
  beforeEach(async () => {
    await insertRating({ index: 1, product: PRODUCT, user: RATER, score: 5 });
    await insertRating({
      index: 2,
      product: PRODUCT,
      user: OTHER_RATER,
      score: 4,
    });
    await insertRating({
      index: 3,
      product: PRODUCT,
      user: OWNER,
      score: 1,
      columns: { invalidatedAt: T0 },
    });
    await insertRating({
      index: 4,
      product: PRODUCT,
      user: WITHDRAWN,
      score: 1,
      columns: { deletedAt: after(1) },
    });
    await insertRating({
      index: 5,
      product: PRODUCT,
      user: SUSPENDED,
      score: 1,
    });
    await insertRating({
      index: 6,
      product: OTHER_PRODUCT,
      user: RATER,
      score: 2,
    });
  });

  test('有効な評価だけの丸めない平均値と件数を返し、無効化・論理削除・停止中の評価者の評価を除く(仮2)', async () => {
    await insertRating({
      index: 7,
      product: OTHER_PRODUCT,
      user: OTHER_RATER,
      score: 3,
    });
    await insertRating({
      index: 8,
      product: OTHER_PRODUCT,
      user: OWNER,
      score: 3,
    });

    expect(
      await store.summaries([productIdOf(PRODUCT), productIdOf(OTHER_PRODUCT)]),
    ).toEqual(
      new Map([
        [productIdOf(PRODUCT), { average: 4.5, count: 2 }],
        [productIdOf(OTHER_PRODUCT), { average: 8 / 3, count: 3 }],
      ]),
    );
  });

  test('有効な評価の無いプロダクトと重複した識別は、平均値null・件数0の1件として返す', async () => {
    await insertRating({
      index: 7,
      product: EMPTY_PRODUCT,
      user: RATER,
      columns: { invalidatedAt: T0 },
    });

    expect(
      await store.summaries([
        productIdOf(EMPTY_PRODUCT),
        productIdOf(EMPTY_PRODUCT),
        productIdOf(9),
      ]),
    ).toEqual(
      new Map([
        [productIdOf(EMPTY_PRODUCT), { average: null, count: 0 }],
        [productIdOf(9), { average: null, count: 0 }],
      ]),
    );
  });

  test('停止が解除されると評価者の評価が平均値と件数へ戻る', async () => {
    await setUserColumns(SUSPENDED, { status: 'active' });

    expect(await store.summaries([productIdOf(PRODUCT)])).toEqual(
      new Map([[productIdOf(PRODUCT), { average: 10 / 3, count: 3 }]]),
    );
  });

  test('評価者が停止されると次の集計から除く', async () => {
    await setUserColumns(RATER, { status: 'suspended' });

    expect(await store.summaries([productIdOf(PRODUCT)])).toEqual(
      new Map([[productIdOf(PRODUCT), { average: 4, count: 1 }]]),
    );
  });

  test('空の識別の一覧には空の結果を返す', async () => {
    expect(await store.summaries([])).toEqual(new Map());
  });

  test('91件以上の識別も90件ずつ読んで全て集計する', async () => {
    const indexes = Array.from({ length: 91 }, (_, offset) => 101 + offset);
    await insertProducts(indexes, OWNER);
    await insertRating({ index: 101, product: 101, user: RATER, score: 2 });
    await insertRating({ index: 191, product: 191, user: RATER, score: 5 });

    const summaries = await store.summaries(indexes.map(productIdOf));

    expect(summaries.size).toBe(91);
    expect(summaries.get(productIdOf(101))).toEqual({ average: 2, count: 1 });
    expect(summaries.get(productIdOf(191))).toEqual({ average: 5, count: 1 });
    expect(summaries.get(productIdOf(150))).toEqual({
      average: null,
      count: 0,
    });
  });
});
