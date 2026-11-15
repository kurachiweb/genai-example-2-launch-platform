import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { products } from '../../../db/schema/product/products.ts';
import { launchComments } from '../../../db/schema/engagement/launch-comments.ts';
import type {
  CommentInsert,
  RatingUpsert,
} from '../../../lib/core/engagement/ports.ts';
import { D1CommentStatements } from '../../../lib/workers/engagement/comment-statements.ts';
import { D1RatingStatements } from '../../../lib/workers/engagement/rating-statements.ts';
import {
  after,
  clearEngagementTables,
  commentIdOf,
  countComments,
  countRatings,
  db,
  insertComment,
  insertLaunch,
  insertProduct,
  insertRating,
  insertUser,
  launchIdOf,
  productIdOf,
  ratingIdOf,
  readComment,
  readRating,
  readRatingsOf,
  T0,
  userIdOf,
} from '../../../lib/workers/engagement/testing/engagement-fixtures.ts';
import { D1CommentWriter } from './d1-comment-writer.ts';

const OWNER = 1;
const COMMENTER = 2;
const LISTED_PRODUCT = 1;
const UNLISTED_PRODUCT = 2;
const WON_LAUNCH = 1;
const CURRENT_LAUNCH = 2;
const UNLISTED_LAUNCH = 3;
const PARENT = 1;

const AT = after(60_000);

// 一括の書き込みの回数と文の数を数えるため、batchだけを記録して本物へ渡す
function recordingDatabase(): {
  readonly database: Database;
  readonly batches: number[];
} {
  const batches: number[] = [];
  const database = new Proxy(db, {
    get(target, property, receiver) {
      if (property === 'batch') {
        return (items: Parameters<Database['batch']>[0]) => {
          batches.push(items.length);
          return target.batch(items);
        };
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  return { database, batches };
}

const recording = recordingDatabase();
const writer = new D1CommentWriter(
  recording.database,
  new D1CommentStatements(db),
  new D1RatingStatements(db),
);

function topLevel(
  index: number,
  overrides: Partial<CommentInsert> = {},
): CommentInsert {
  return {
    commentId: commentIdOf(index),
    productId: productIdOf(LISTED_PRODUCT),
    launchId: launchIdOf(CURRENT_LAUNCH),
    parent: null,
    authorUserId: userIdOf(COMMENTER),
    bodyMarkdown: `本文${String(index)}`,
    requireListed: true,
    at: AT,
    ...overrides,
  };
}

function ratingOf(
  index: number,
  overrides: Partial<RatingUpsert> = {},
): RatingUpsert {
  return {
    ratingId: ratingIdOf(index),
    productId: productIdOf(LISTED_PRODUCT),
    userId: userIdOf(COMMENTER),
    score: 4,
    at: AT,
    ...overrides,
  };
}

const replyToParent = (index: number): CommentInsert =>
  topLevel(index, {
    parent: {
      commentId: commentIdOf(PARENT),
      rootId: commentIdOf(PARENT),
      depth: 1,
    },
  });

beforeEach(async () => {
  recording.batches.length = 0;
  await clearEngagementTables();
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(COMMENTER, { emailVerifiedAt: T0 });
  await insertProduct(LISTED_PRODUCT, OWNER);
  await insertLaunch(WON_LAUNCH, LISTED_PRODUCT, {
    launchDate: '2026-11-10',
    outcome: 'won',
    decidedAt: T0,
  });
  await insertLaunch(CURRENT_LAUNCH, LISTED_PRODUCT);
  await insertProduct(UNLISTED_PRODUCT, OWNER);
  await insertLaunch(UNLISTED_LAUNCH, UNLISTED_PRODUCT);
  await insertComment({
    index: PARENT,
    product: LISTED_PRODUCT,
    launch: CURRENT_LAUNCH,
    author: OWNER,
  });
});

describe('D1CommentWriter.post: 確定', () => {
  test('評価を添えた投稿は、コメントと評価を1回の一括の書き込みで保存する', async () => {
    const outcome = await writer.post({
      comment: topLevel(10),
      rating: ratingOf(1),
    });

    expect(outcome).toBe('committed');
    expect(recording.batches).toEqual([2]);
    expect(await readComment(10)).toMatchObject({
      authorUserId: userIdOf(COMMENTER),
      body: '本文10',
      depth: 1,
      createdAt: AT,
    });
    expect(await readRating(1)).toMatchObject({
      productId: productIdOf(LISTED_PRODUCT),
      userId: userIdOf(COMMENTER),
      score: 4,
      createdAt: AT,
    });
  });

  test('評価を添えた投稿は、既存の自分の評価を同じ一括の書き込みで上書きする', async () => {
    await insertRating({
      index: 1,
      product: LISTED_PRODUCT,
      user: COMMENTER,
      score: 2,
    });

    await writer.post({
      comment: topLevel(10),
      rating: ratingOf(2, { score: 5 }),
    });

    expect(await readRatingsOf(LISTED_PRODUCT)).toEqual([
      expect.objectContaining({ id: ratingIdOf(1), score: 5, updatedAt: AT }),
    ]);
  });

  test('評価を添えない投稿はコメントだけを書き込み、既存の評価を変えない', async () => {
    await insertRating({
      index: 1,
      product: LISTED_PRODUCT,
      user: COMMENTER,
      score: 2,
    });
    const before = await readRating(1);

    const outcome = await writer.post({
      comment: topLevel(10),
      rating: undefined,
    });

    expect(outcome).toBe('committed');
    expect(recording.batches).toEqual([1]);
    expect(await readComment(10)).toBeDefined();
    expect(await readRating(1)).toEqual(before);
  });

  test('表示できる親への返信を保存する', async () => {
    const outcome = await writer.post({
      comment: replyToParent(10),
      rating: undefined,
    });

    expect(outcome).toBe('committed');
    expect(await readComment(10)).toMatchObject({
      parentId: commentIdOf(PARENT),
      rootId: commentIdOf(PARENT),
      depth: 2,
    });
  });
});

describe('D1CommentWriter.post: 条件の違反', () => {
  test('評価の文の違反では、コメントも残さずrejectedを返す', async () => {
    const outcome = await writer.post({
      comment: topLevel(10, {
        productId: productIdOf(UNLISTED_PRODUCT),
        launchId: launchIdOf(UNLISTED_LAUNCH),
        authorUserId: userIdOf(OWNER),
        requireListed: false,
      }),
      rating: ratingOf(1, {
        productId: productIdOf(UNLISTED_PRODUCT),
        userId: userIdOf(OWNER),
      }),
    });

    expect(outcome).toBe('rejected');
    expect(await readComment(10)).toBeUndefined();
    expect(await countRatings()).toBe(0);
  });

  test('判定の後にプロダクトが非公開化されていれば、コメントも評価も書き込まずrejectedを返す', async () => {
    await db
      .update(products)
      .set({ hiddenAt: T0 })
      .where(eq(products.id, productIdOf(LISTED_PRODUCT)));

    const outcome = await writer.post({
      comment: topLevel(10),
      rating: ratingOf(1),
    });

    expect(outcome).toBe('rejected');
    expect(await countComments()).toBe(1);
    expect(await countRatings()).toBe(0);
  });

  test('判定の後に投稿者が停止されていれば、書き込まずrejectedを返す', async () => {
    await db
      .update(users)
      .set({ status: 'suspended' })
      .where(eq(users.id, userIdOf(COMMENTER)));

    const outcome = await writer.post({
      comment: topLevel(10),
      rating: undefined,
    });

    expect(outcome).toBe('rejected');
    expect(await readComment(10)).toBeUndefined();
  });

  test('判定の後に親が削除されていれば、返信を書き込まずrejectedを返す', async () => {
    await db
      .update(launchComments)
      .set({ deletedAt: T0 })
      .where(eq(launchComments.id, commentIdOf(PARENT)));

    const outcome = await writer.post({
      comment: replyToParent(10),
      rating: undefined,
    });

    expect(outcome).toBe('rejected');
    expect(await readComment(10)).toBeUndefined();
  });

  test('条件の違反以外のD1の例外は、rejectedにせずそのまま投げる', async () => {
    const pending = writer.post({
      comment: topLevel(PARENT),
      rating: ratingOf(1),
    });

    await expect(pending).rejects.toThrow(
      /UNIQUE constraint failed: launch_comments\.id/u,
    );
    expect(await countRatings()).toBe(0);
  });
});
