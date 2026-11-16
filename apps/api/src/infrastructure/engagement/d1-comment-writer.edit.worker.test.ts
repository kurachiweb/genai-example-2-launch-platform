import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import { launchComments } from '../../../db/schema/engagement/launch-comments.ts';
import { products } from '../../../db/schema/product/products.ts';
import type {
  CommentBodyUpdate,
  CommentSoftDelete,
  RatingUpsert,
} from '../../../lib/core/engagement/ports.ts';
import { D1CommentStatements } from '../../../lib/workers/engagement/comment-statements.ts';
import { D1RatingStatements } from '../../../lib/workers/engagement/rating-statements.ts';
import {
  after,
  clearEngagementTables,
  commentIdOf,
  countRatings,
  db,
  insertComment,
  insertLaunch,
  insertProduct,
  insertRating,
  insertUser,
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

const COMMENT = 1;
const OWNER_COMMENT = 2;
const REPLY = 3;
const OWNER_UNLISTED_COMMENT = 4;
const MISSING_COMMENT = 50;

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

function bodyOf(
  index: number,
  overrides: Partial<CommentBodyUpdate> = {},
): CommentBodyUpdate {
  return {
    commentId: commentIdOf(index),
    authorUserId: userIdOf(COMMENTER),
    bodyMarkdown: '**直した**本文',
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

function deletionOf(
  index: number,
  overrides: Partial<CommentSoftDelete> = {},
): CommentSoftDelete {
  return {
    commentId: commentIdOf(index),
    authorUserId: userIdOf(COMMENTER),
    at: AT,
    ...overrides,
  };
}

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
    index: COMMENT,
    product: LISTED_PRODUCT,
    launch: CURRENT_LAUNCH,
    author: COMMENTER,
  });
  await insertComment({
    index: OWNER_COMMENT,
    product: LISTED_PRODUCT,
    launch: CURRENT_LAUNCH,
    author: OWNER,
  });
  await insertComment({
    index: REPLY,
    product: LISTED_PRODUCT,
    launch: CURRENT_LAUNCH,
    author: OWNER,
    parent: { index: COMMENT, root: COMMENT },
    depth: 2,
  });
  await insertComment({
    index: OWNER_UNLISTED_COMMENT,
    product: UNLISTED_PRODUCT,
    launch: UNLISTED_LAUNCH,
    author: OWNER,
  });
});

describe('D1CommentWriter.update: 確定', () => {
  test('評価を添えない編集は、本文と編集の日時だけを1文の一括の書き込みで更新し、既存の評価を変えない', async () => {
    await insertRating({
      index: 1,
      product: LISTED_PRODUCT,
      user: COMMENTER,
      score: 2,
    });
    const before = await readRating(1);

    const outcome = await writer.update({
      body: bodyOf(COMMENT),
      rating: undefined,
    });

    expect(outcome).toBe('committed');
    expect(recording.batches).toEqual([1]);
    expect(await readComment(COMMENT)).toMatchObject({
      body: '**直した**本文',
      editedAt: AT,
      updatedAt: AT,
      createdAt: T0,
    });
    expect(await readRating(1)).toEqual(before);
  });

  test('評価を添えた編集は、本文の更新と評価の上書きを1回の一括の書き込みで確定する', async () => {
    await insertRating({
      index: 1,
      product: LISTED_PRODUCT,
      user: COMMENTER,
      score: 2,
    });

    const outcome = await writer.update({
      body: bodyOf(COMMENT),
      rating: ratingOf(2, { score: 5 }),
    });

    expect(outcome).toBe('committed');
    expect(recording.batches).toEqual([2]);
    expect(await readComment(COMMENT)).toMatchObject({ editedAt: AT });
    expect(await readRatingsOf(LISTED_PRODUCT)).toEqual([
      expect.objectContaining({ id: ratingIdOf(1), score: 5, updatedAt: AT }),
    ]);
  });

  test('投稿者本人は未掲載の自身のプロダクトのコメントを、掲載を条件にせず編集できる', async () => {
    const outcome = await writer.update({
      body: bodyOf(OWNER_UNLISTED_COMMENT, {
        authorUserId: userIdOf(OWNER),
        requireListed: false,
      }),
      rating: undefined,
    });

    expect(outcome).toBe('committed');
    expect(await readComment(OWNER_UNLISTED_COMMENT)).toMatchObject({
      editedAt: AT,
    });
  });
});

describe('D1CommentWriter.update: 条件の違反と不在', () => {
  test('評価の文の違反では、本文も更新せずrejectedを返す', async () => {
    const before = await readComment(OWNER_UNLISTED_COMMENT);

    const outcome = await writer.update({
      body: bodyOf(OWNER_UNLISTED_COMMENT, {
        authorUserId: userIdOf(OWNER),
        requireListed: false,
      }),
      rating: ratingOf(1, {
        productId: productIdOf(UNLISTED_PRODUCT),
        userId: userIdOf(OWNER),
      }),
    });

    expect(outcome).toBe('rejected');
    expect(await readComment(OWNER_UNLISTED_COMMENT)).toEqual(before);
    expect(await countRatings()).toBe(0);
  });

  test('判定の後にプロダクトが非公開化されていれば、本文も評価も書き込まずrejectedを返す', async () => {
    const before = await readComment(COMMENT);
    await db
      .update(products)
      .set({ hiddenAt: T0 })
      .where(eq(products.id, productIdOf(LISTED_PRODUCT)));

    const outcome = await writer.update({
      body: bodyOf(COMMENT),
      rating: ratingOf(1),
    });

    expect(outcome).toBe('rejected');
    expect(await readComment(COMMENT)).toEqual(before);
    expect(await countRatings()).toBe(0);
  });

  test('判定の後にコメントが削除されていれば、本文も評価も書き込まずrejectedを返す', async () => {
    await db
      .update(launchComments)
      .set({ deletedAt: T0 })
      .where(eq(launchComments.id, commentIdOf(COMMENT)));

    const outcome = await writer.update({
      body: bodyOf(COMMENT),
      rating: ratingOf(1),
    });

    expect(outcome).toBe('rejected');
    expect(await readComment(COMMENT)).toMatchObject({
      body: 'コメント1',
      editedAt: null,
    });
    expect(await countRatings()).toBe(0);
  });

  test('他者のコメントの編集は書き込まずrejectedを返す', async () => {
    const before = await readComment(OWNER_COMMENT);

    const outcome = await writer.update({
      body: bodyOf(OWNER_COMMENT),
      rating: undefined,
    });

    expect(outcome).toBe('rejected');
    expect(await readComment(OWNER_COMMENT)).toEqual(before);
  });

  test('書き込みの時点で行が無いコメントの編集はnot-foundを返す', async () => {
    const outcome = await writer.update({
      body: bodyOf(MISSING_COMMENT),
      rating: undefined,
    });

    expect(outcome).toBe('not-found');
    expect(await readComment(MISSING_COMMENT)).toBeUndefined();
  });

  test('条件の違反以外のD1の例外は、rejectedにせずそのまま投げ、本文も更新しない', async () => {
    await insertRating({
      index: 1,
      product: LISTED_PRODUCT,
      user: OWNER,
      score: 3,
    });
    const before = await readComment(COMMENT);

    const pending = writer.update({
      body: bodyOf(COMMENT),
      rating: ratingOf(1),
    });

    await expect(pending).rejects.toThrow(
      /UNIQUE constraint failed: product_ratings\.id/u,
    );
    expect(await readComment(COMMENT)).toEqual(before);
  });
});

describe('D1CommentWriter.remove', () => {
  test('自分のコメントを削除の日時で置き換え表示にし、付いている返信をそのまま残す', async () => {
    const reply = await readComment(REPLY);

    const outcome = await writer.remove(deletionOf(COMMENT));

    expect(outcome).toBe('deleted');
    expect(await readComment(COMMENT)).toMatchObject({
      body: 'コメント1',
      deletedAt: AT,
      updatedAt: AT,
    });
    expect(await readComment(REPLY)).toEqual(reply);
  });

  test('削除済みのコメントの削除は変更が0行になり、not-foundを返して削除の日時を変えない', async () => {
    await writer.remove(deletionOf(COMMENT));

    const outcome = await writer.remove(
      deletionOf(COMMENT, { at: after(120_000) }),
    );

    expect(outcome).toBe('not-found');
    expect(await readComment(COMMENT)).toMatchObject({ deletedAt: AT });
  });

  test('他者のコメント・非公開化されたコメント・存在しないコメントの削除はnot-foundを返す', async () => {
    await db
      .update(launchComments)
      .set({ hiddenAt: T0 })
      .where(eq(launchComments.id, commentIdOf(COMMENT)));
    const owners = await readComment(OWNER_COMMENT);

    const outcomes = [
      await writer.remove(deletionOf(OWNER_COMMENT)),
      await writer.remove(deletionOf(COMMENT)),
      await writer.remove(deletionOf(MISSING_COMMENT)),
    ];

    expect(outcomes).toEqual(['not-found', 'not-found', 'not-found']);
    expect(await readComment(OWNER_COMMENT)).toEqual(owners);
    expect(await readComment(COMMENT)).toMatchObject({ deletedAt: null });
  });
});
