import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { launchComments } from '../../../db/schema/engagement/launch-comments.ts';
import { productRatings } from '../../../db/schema/engagement/product-ratings.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { products } from '../../../db/schema/product/products.ts';
import { insertUsers } from '../identity/testing/identity-store-fixtures.ts';
import { insertProducts } from '../product/testing/product-fixtures.ts';
import { D1EngagementErasureStore } from './d1-engagement-erasure-store.ts';
import {
  after,
  clearEngagementTables,
  commentIdOf,
  countComments,
  countRatings,
  db,
  insertComment,
  insertComments,
  insertLaunch,
  insertProduct,
  insertRating,
  insertRatings,
  insertUser,
  productIdOf,
  ratingIdOf,
  readComment,
  readRating,
  T0,
  userIdOf,
} from './testing/engagement-fixtures.ts';

const OWNER = 1;
const ERASED = 2;
const OTHER = 3;
const PRODUCT = 1;
const OTHER_PRODUCT = 2;
const LAUNCH = 1;
const OTHER_PRODUCT_LAUNCH = 2;
const SECOND_LAUNCH = 3;
const LIMIT = 500;

const WITHDRAWN_AT = after(1_000);
const ERASED_AT = after(60_000);

const store = new D1EngagementErasureStore(db);

// identity-authの物理削除(eventのD1IdentityPurgeStore)の最後の文。利用者を外部キーで参照する行が残れば失敗する
async function purgeUserRow(index: number): Promise<void> {
  await db.delete(users).where(eq(users.id, userIdOf(index)));
}

// product-launchの物理削除(eventのD1ProductPurgeStore)のうち、コメントと評価が外部キーで参照するローンチとプロダクトの文
async function purgeProductRows(index: number): Promise<void> {
  await db.batch([
    db
      .delete(productLaunches)
      .where(eq(productLaunches.productId, productIdOf(index))),
    db.delete(products).where(eq(products.id, productIdOf(index))),
  ]);
}

async function allComments() {
  return db.select().from(launchComments).orderBy(asc(launchComments.id));
}

async function allRatings() {
  return db.select().from(productRatings).orderBy(asc(productRatings.id));
}

function range(first: number, length: number): number[] {
  return Array.from({ length }, (_, offset) => first + offset);
}

beforeEach(async () => {
  await clearEngagementTables();
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(ERASED, { emailVerifiedAt: T0, deletedAt: WITHDRAWN_AT });
  await insertUser(OTHER, { emailVerifiedAt: T0 });
  await insertProduct(PRODUCT, OWNER);
  await insertProduct(OTHER_PRODUCT, OWNER);
  await insertLaunch(LAUNCH, PRODUCT, {
    launchDate: '2026-11-10',
    outcome: 'won',
  });
  await insertLaunch(OTHER_PRODUCT_LAUNCH, OTHER_PRODUCT);
  await insertLaunch(SECOND_LAUNCH, PRODUCT);
});

describe('D1EngagementErasureStore.eraseAccount', () => {
  async function insertAccountFixtures(): Promise<void> {
    await insertComment({
      index: 1,
      product: PRODUCT,
      launch: LAUNCH,
      author: ERASED,
      columns: { deletedAt: WITHDRAWN_AT },
    });
    await insertComment({
      index: 2,
      product: PRODUCT,
      launch: LAUNCH,
      author: OTHER,
      parent: { index: 1, root: 1 },
      depth: 2,
    });
    await insertComment({
      index: 3,
      product: PRODUCT,
      launch: LAUNCH,
      author: OTHER,
    });
    await insertComment({
      index: 4,
      product: PRODUCT,
      launch: LAUNCH,
      author: ERASED,
      parent: { index: 3, root: 3 },
      depth: 2,
      columns: { deletedAt: WITHDRAWN_AT, hiddenAt: T0 },
    });
    await insertComment({
      index: 5,
      product: OTHER_PRODUCT,
      launch: OTHER_PRODUCT_LAUNCH,
      author: ERASED,
      columns: { deletedAt: T0 },
    });
    await insertRating({
      index: 1,
      product: PRODUCT,
      user: ERASED,
      columns: { deletedAt: WITHDRAWN_AT },
    });
    await insertRating({
      index: 2,
      product: OTHER_PRODUCT,
      user: ERASED,
      columns: { deletedAt: WITHDRAWN_AT, invalidatedAt: T0 },
    });
    await insertRating({ index: 3, product: PRODUCT, user: OTHER });
  }

  test('利用者の全てのコメントの紐付けを外して本文を空にし行と返信を残し、評価を物理削除し、残りが無いことを返す', async () => {
    await insertAccountFixtures();

    const result = await store.eraseAccount({
      userId: userIdOf(ERASED),
      at: ERASED_AT,
      limit: LIMIT,
    });

    expect(result).toEqual({ remaining: false });
    for (const index of [1, 4, 5]) {
      expect(await readComment(index)).toMatchObject({
        body: '',
        authorUserId: null,
        anonymizedAt: ERASED_AT,
        updatedAt: ERASED_AT,
      });
    }
    expect(await readComment(4)).toMatchObject({ hiddenAt: T0 });
    expect(await readComment(2)).toMatchObject({
      parentId: commentIdOf(1),
      authorUserId: userIdOf(OTHER),
      body: 'コメント2',
      anonymizedAt: null,
    });
    expect(await readComment(3)).toMatchObject({
      authorUserId: userIdOf(OTHER),
      body: 'コメント3',
    });
    expect(await countComments()).toBe(5);
    expect(await readRating(1)).toBeUndefined();
    expect(await readRating(2)).toBeUndefined();
    expect(await readRating(3)).toBeDefined();
  });

  test('処理の前は利用者の物理削除が外部キーで失敗し、処理の後は成功する', async () => {
    await insertAccountFixtures();

    await expect(purgeUserRow(ERASED)).rejects.toThrow();

    await store.eraseAccount({
      userId: userIdOf(ERASED),
      at: ERASED_AT,
      limit: LIMIT,
    });

    await expect(purgeUserRow(ERASED)).resolves.toBeUndefined();
  });

  test('同じ利用者で2回実行しても結果が変わらない', async () => {
    await insertAccountFixtures();
    await store.eraseAccount({
      userId: userIdOf(ERASED),
      at: ERASED_AT,
      limit: LIMIT,
    });
    const comments = await allComments();
    const ratings = await allRatings();

    const second = await store.eraseAccount({
      userId: userIdOf(ERASED),
      at: after(120_000),
      limit: LIMIT,
    });

    expect(second).toEqual({ remaining: false });
    expect(await allComments()).toEqual(comments);
    expect(await allRatings()).toEqual(ratings);
  });

  test('コメントと評価をそれぞれ500件までにし、残りがあれば次の呼び出しで続きを処理する', async () => {
    const total = LIMIT + 1;
    const ratedProducts = range(100, total);
    await insertProducts(ratedProducts, OWNER);
    await insertComments(
      range(1, total).map((index) => ({
        index,
        product: PRODUCT,
        launch: LAUNCH,
        author: ERASED,
        columns: { deletedAt: WITHDRAWN_AT },
      })),
    );
    await insertRatings(
      ratedProducts.map((product, offset) => ({
        index: offset + 1,
        product,
        user: ERASED,
        columns: { deletedAt: WITHDRAWN_AT },
      })),
    );

    const first = await store.eraseAccount({
      userId: userIdOf(ERASED),
      at: ERASED_AT,
      limit: LIMIT,
    });

    expect(first).toEqual({ remaining: true });
    expect(
      await db.$count(
        launchComments,
        eq(launchComments.authorUserId, userIdOf(ERASED)),
      ),
    ).toBe(1);
    expect(await countRatings()).toBe(1);

    const second = await store.eraseAccount({
      userId: userIdOf(ERASED),
      at: ERASED_AT,
      limit: LIMIT,
    });

    expect(second).toEqual({ remaining: false });
    expect(
      await db.$count(
        launchComments,
        eq(launchComments.authorUserId, userIdOf(ERASED)),
      ),
    ).toBe(0);
    expect(await countRatings()).toBe(0);
    expect(await countComments()).toBe(total);
    await expect(purgeUserRow(ERASED)).resolves.toBeUndefined();
  });

  test('コメントと評価の無い利用者は何も変えず残りが無いことを返す', async () => {
    await insertComment({
      index: 1,
      product: PRODUCT,
      launch: LAUNCH,
      author: OTHER,
    });

    const result = await store.eraseAccount({
      userId: userIdOf(ERASED),
      at: ERASED_AT,
      limit: LIMIT,
    });

    expect(result).toEqual({ remaining: false });
    expect(await readComment(1)).toMatchObject({
      authorUserId: userIdOf(OTHER),
      anonymizedAt: null,
    });
  });
});

describe('D1EngagementErasureStore.eraseProduct', () => {
  async function insertProductFixtures(): Promise<void> {
    await insertComment({
      index: 1,
      product: PRODUCT,
      launch: LAUNCH,
      author: OTHER,
    });
    await insertComment({
      index: 2,
      product: PRODUCT,
      launch: LAUNCH,
      author: OWNER,
      parent: { index: 1, root: 1 },
      depth: 2,
    });
    await insertComment({
      index: 3,
      product: PRODUCT,
      launch: LAUNCH,
      author: null,
      parent: { index: 2, root: 1 },
      depth: 3,
      columns: { body: '', deletedAt: T0, anonymizedAt: after(10) },
    });
    await insertComment({
      index: 4,
      product: PRODUCT,
      launch: SECOND_LAUNCH,
      author: ERASED,
      columns: { deletedAt: WITHDRAWN_AT, hiddenAt: T0 },
    });
    await insertComment({
      index: 5,
      product: OTHER_PRODUCT,
      launch: OTHER_PRODUCT_LAUNCH,
      author: OTHER,
    });
    await insertRating({ index: 1, product: PRODUCT, user: OTHER });
    await insertRating({
      index: 2,
      product: PRODUCT,
      user: ERASED,
      columns: { deletedAt: WITHDRAWN_AT, invalidatedAt: T0 },
    });
    await insertRating({ index: 3, product: OTHER_PRODUCT, user: OTHER });
  }

  test('他の利用者のものと返信を含むプロダクトの全てのコメントと評価を物理削除し、他のプロダクトの行を残す', async () => {
    await insertProductFixtures();

    const result = await store.eraseProduct({
      productId: productIdOf(PRODUCT),
      limit: LIMIT,
    });

    expect(result).toEqual({ remaining: false });
    expect((await allComments()).map((row) => row.id)).toEqual([
      commentIdOf(5),
    ]);
    expect((await allRatings()).map((row) => row.id)).toEqual([ratingIdOf(3)]);
  });

  test('処理の前はプロダクトの物理削除が外部キーで失敗し、処理の後は成功する', async () => {
    await insertProductFixtures();

    await expect(purgeProductRows(PRODUCT)).rejects.toThrow();

    await store.eraseProduct({ productId: productIdOf(PRODUCT), limit: LIMIT });

    await expect(purgeProductRows(PRODUCT)).resolves.toBeUndefined();
  });

  test('同じプロダクトで2回実行しても結果が変わらない', async () => {
    await insertProductFixtures();
    await store.eraseProduct({ productId: productIdOf(PRODUCT), limit: LIMIT });
    const comments = await allComments();
    const ratings = await allRatings();

    const second = await store.eraseProduct({
      productId: productIdOf(PRODUCT),
      limit: LIMIT,
    });

    expect(second).toEqual({ remaining: false });
    expect(await allComments()).toEqual(comments);
    expect(await allRatings()).toEqual(ratings);
  });

  test('500件の区切りが返信の木の途中に来ても階層の深い順に消して外部キーで失敗せず、残りを次の呼び出しで消す', async () => {
    const threads = (LIMIT + 1) / 3;
    const raters = range(1_000, LIMIT + 1);
    await insertUsers(raters, { emailVerifiedAt: T0 });
    // スレッドごとに第1〜第3階層を続けて入れ、挿入の順で区切ると親だけが消えて子が残る並びにする
    await insertComments(
      range(0, threads).flatMap((thread) => {
        const root = thread * 3 + 1;
        return [
          { index: root, product: PRODUCT, launch: LAUNCH, author: OTHER },
          {
            index: root + 1,
            product: PRODUCT,
            launch: LAUNCH,
            author: OWNER,
            parent: { index: root, root },
            depth: 2 as const,
          },
          {
            index: root + 2,
            product: PRODUCT,
            launch: LAUNCH,
            author: OTHER,
            parent: { index: root + 1, root },
            depth: 3 as const,
          },
        ];
      }),
    );
    await insertRatings(
      raters.map((user, offset) => ({
        index: offset + 1,
        product: PRODUCT,
        user,
      })),
    );

    const first = await store.eraseProduct({
      productId: productIdOf(PRODUCT),
      limit: LIMIT,
    });

    expect(first).toEqual({ remaining: true });
    const left = await allComments();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ depth: 1 });
    expect(await countRatings()).toBe(1);

    const second = await store.eraseProduct({
      productId: productIdOf(PRODUCT),
      limit: LIMIT,
    });

    expect(second).toEqual({ remaining: false });
    expect(await countComments()).toBe(0);
    expect(await countRatings()).toBe(0);
    await expect(purgeProductRows(PRODUCT)).resolves.toBeUndefined();
  });
});
