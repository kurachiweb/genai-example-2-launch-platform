import { beforeEach, describe, expect, test } from 'vitest';

import { D1CommentThreadQuery } from './d1-comment-thread-query.ts';
import {
  after,
  clearEngagementTables,
  db,
  insertComment,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  productIdOf,
  T0,
} from './testing/engagement-fixtures.ts';
import {
  insertLaunches,
  insertProducts,
} from '../product/testing/product-fixtures.ts';

const COMMENTER = 1;
const WITHDRAWN = 2;
const SUSPENDED = 3;
const PRODUCT = 1;
const OTHER_PRODUCT = 2;
const LAUNCH = 1;
const SECOND_LAUNCH = 2;
const OTHER_PRODUCT_LAUNCH = 3;

const query = new D1CommentThreadQuery(db);

async function insertRemovedComments(
  launch: number,
  product: number,
  firstIndex: number,
): Promise<void> {
  await insertComment({
    index: firstIndex,
    product,
    launch,
    author: WITHDRAWN,
  });
  await insertComment({
    index: firstIndex + 1,
    product,
    launch,
    author: COMMENTER,
    columns: { deletedAt: after(10) },
  });
  await insertComment({
    index: firstIndex + 2,
    product,
    launch,
    author: SUSPENDED,
  });
  await insertComment({
    index: firstIndex + 3,
    product,
    launch,
    author: COMMENTER,
    columns: { hiddenAt: after(10) },
  });
  await insertComment({
    index: firstIndex + 4,
    product,
    launch,
    author: null,
    columns: { body: '', deletedAt: after(5), anonymizedAt: after(10) },
  });
}

beforeEach(async () => {
  await clearEngagementTables();
  await insertUser(COMMENTER, { emailVerifiedAt: T0 });
  await insertUser(WITHDRAWN, { emailVerifiedAt: T0, deletedAt: after(1) });
  await insertUser(SUSPENDED, { emailVerifiedAt: T0, status: 'suspended' });
  await insertProduct(PRODUCT, COMMENTER);
  await insertProduct(OTHER_PRODUCT, COMMENTER);
  await insertLaunch(LAUNCH, PRODUCT, {
    launchDate: '2026-11-10',
    outcome: 'won',
    decidedAt: T0,
  });
  await insertLaunch(SECOND_LAUNCH, PRODUCT);
  await insertLaunch(OTHER_PRODUCT_LAUNCH, OTHER_PRODUCT);
  await insertComment({
    index: 1,
    product: PRODUCT,
    launch: LAUNCH,
    author: COMMENTER,
  });
  await insertComment({
    index: 2,
    product: PRODUCT,
    launch: LAUNCH,
    author: COMMENTER,
    parent: { index: 1, root: 1 },
    depth: 2,
  });
  await insertComment({
    index: 3,
    product: PRODUCT,
    launch: SECOND_LAUNCH,
    author: COMMENTER,
  });
  await insertComment({
    index: 4,
    product: OTHER_PRODUCT,
    launch: OTHER_PRODUCT_LAUNCH,
    author: COMMENTER,
  });
  await insertRemovedComments(LAUNCH, PRODUCT, 10);
  await insertRemovedComments(SECOND_LAUNCH, PRODUCT, 20);
});

describe('D1CommentThreadQuery', () => {
  describe('countsByLaunch', () => {
    test('プロダクトのローンチごとに、返信を含む表示できるコメントだけを数える', async () => {
      expect(await query.countsByLaunch(productIdOf(PRODUCT))).toEqual(
        new Map([
          [launchIdOf(LAUNCH), 2],
          [launchIdOf(SECOND_LAUNCH), 1],
        ]),
      );
    });

    test('置き換え表示のコメントしか無いローンチは結果に含めない', async () => {
      await insertRemovedComments(OTHER_PRODUCT_LAUNCH, OTHER_PRODUCT, 30);

      expect(await query.countsByLaunch(productIdOf(OTHER_PRODUCT))).toEqual(
        new Map([[launchIdOf(OTHER_PRODUCT_LAUNCH), 1]]),
      );
    });
  });

  describe('countsByProduct', () => {
    test('プロダクトごとに、全ローンチの表示できるコメントだけを数え、コメントの無いプロダクトは結果に含めない', async () => {
      await insertProduct(3, COMMENTER);

      expect(
        await query.countsByProduct([
          productIdOf(PRODUCT),
          productIdOf(OTHER_PRODUCT),
          productIdOf(3),
          productIdOf(PRODUCT),
        ]),
      ).toEqual(
        new Map([
          [productIdOf(PRODUCT), 3],
          [productIdOf(OTHER_PRODUCT), 1],
        ]),
      );
    });

    test('空の識別の一覧には空の結果を返す', async () => {
      expect(await query.countsByProduct([])).toEqual(new Map());
    });

    test('91件以上の識別も90件ずつ読んで全て数える', async () => {
      const indexes = Array.from({ length: 91 }, (_, offset) => 101 + offset);
      await insertProducts(indexes, COMMENTER);
      await insertLaunches(
        indexes.map((index) => ({ index, productIndex: index })),
      );
      for (const index of [101, 191]) {
        await insertComment({
          index,
          product: index,
          launch: index,
          author: COMMENTER,
        });
      }

      expect(await query.countsByProduct(indexes.map(productIdOf))).toEqual(
        new Map([
          [productIdOf(101), 1],
          [productIdOf(191), 1],
        ]),
      );
    });
  });
});
