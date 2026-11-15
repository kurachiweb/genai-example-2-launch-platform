import type { BatchItem } from 'drizzle-orm/batch';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { products } from '../../../db/schema/product/products.ts';
import type { CommentInsert } from '../../core/engagement/ports.ts';
import { D1CommentStatements } from './comment-statements.ts';
import {
  after,
  clearEngagementTables,
  commentIdOf,
  countComments,
  db,
  insertComment,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  productIdOf,
  readComment,
  T0,
  userIdOf,
} from './testing/engagement-fixtures.ts';

const OWNER = 1;
const COMMENTER = 2;
const UNVERIFIED = 3;
const LISTED_PRODUCT = 1;
const UNLISTED_PRODUCT = 2;
const WON_LAUNCH = 1;
const CURRENT_LAUNCH = 2;
const UNLISTED_LAUNCH = 3;

const AT = after(60_000);

const GUARD_VIOLATION =
  /NOT NULL constraint failed: launch_comments\.product_id/u;

const statements = new D1CommentStatements(db);

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

function replyTo(
  index: number,
  parent: NonNullable<CommentInsert['parent']>,
  overrides: Partial<CommentInsert> = {},
): CommentInsert {
  return topLevel(index, { parent, ...overrides });
}

async function post(...inputs: CommentInsert[]): Promise<void> {
  const [first, ...rest] = inputs.map((input) =>
    statements.insertStatement(input),
  );
  if (first === undefined) {
    return;
  }
  await db.batch([first, ...rest] as [
    BatchItem<'sqlite'>,
    ...BatchItem<'sqlite'>[],
  ]);
}

// 違反の原因は他の文ではなく条件の列であること、一括の書き込みの他の文も残らないことを確かめる
async function expectRejected(input: CommentInsert): Promise<void> {
  const before = await countComments();
  await expect(post(topLevel(99), input)).rejects.toThrow(GUARD_VIOLATION);
  expect(await countComments()).toBe(before);
}

beforeEach(async () => {
  await clearEngagementTables();
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(COMMENTER, { emailVerifiedAt: T0 });
  await insertUser(UNVERIFIED);
  await insertProduct(LISTED_PRODUCT, OWNER);
  await insertLaunch(WON_LAUNCH, LISTED_PRODUCT, {
    launchDate: '2026-11-10',
    outcome: 'won',
    decidedAt: T0,
  });
  await insertLaunch(CURRENT_LAUNCH, LISTED_PRODUCT);
  await insertProduct(UNLISTED_PRODUCT, OWNER);
  await insertLaunch(UNLISTED_LAUNCH, UNLISTED_PRODUCT);
});

describe('CommentStatements.insertStatement(トップレベル)', () => {
  test('本文をマークダウンの原文のまま、ルートを自身・第1階層・親なしのコメントとして保存する', async () => {
    const bodyMarkdown = '**太字**と<script>alert(1)</script>\n\n- 項目';

    await post(topLevel(1, { bodyMarkdown }));

    expect(await readComment(1)).toEqual({
      id: commentIdOf(1),
      productId: productIdOf(LISTED_PRODUCT),
      launchId: launchIdOf(CURRENT_LAUNCH),
      parentId: null,
      rootId: commentIdOf(1),
      depth: 1,
      authorUserId: userIdOf(COMMENTER),
      body: bodyMarkdown,
      editedAt: null,
      hiddenAt: null,
      anonymizedAt: null,
      createdAt: AT,
      updatedAt: AT,
      deletedAt: null,
    });
  });

  test('結果の確定したローンチへのコメントも保存できる', async () => {
    await post(topLevel(1, { launchId: launchIdOf(WON_LAUNCH) }));

    expect((await readComment(1))?.launchId).toBe(launchIdOf(WON_LAUNCH));
  });

  test('投稿者本人は未掲載の自身のプロダクトのローンチへコメントできる', async () => {
    await post(
      topLevel(1, {
        productId: productIdOf(UNLISTED_PRODUCT),
        launchId: launchIdOf(UNLISTED_LAUNCH),
        authorUserId: userIdOf(OWNER),
        requireListed: false,
      }),
    );

    expect((await readComment(1))?.authorUserId).toBe(userIdOf(OWNER));
  });

  test('投稿者本人も掲載中の自身のプロダクトへコメントできる', async () => {
    await post(
      topLevel(1, { authorUserId: userIdOf(OWNER), requireListed: false }),
    );

    expect(await countComments()).toBe(1);
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
      'コメントの投稿者が停止された',
      () =>
        db
          .update(users)
          .set({ status: 'suspended' })
          .where(eq(users.id, userIdOf(COMMENTER))),
    ],
    [
      'コメントの投稿者が退会した',
      () =>
        db
          .update(users)
          .set({ deletedAt: AT })
          .where(eq(users.id, userIdOf(COMMENTER))),
    ],
    [
      'プロダクトの勝ったローンチが取り消された',
      () =>
        db
          .update(productLaunches)
          .set({ cancelledAt: AT })
          .where(eq(productLaunches.id, launchIdOf(WON_LAUNCH))),
    ],
  ])('%s後は一括の書き込みごと失敗する', async (_, change) => {
    await change();

    await expectRejected(topLevel(1));
  });

  test('投稿者がメールアドレスを確認していなければ一括の書き込みごと失敗する', async () => {
    await expectRejected(topLevel(1, { authorUserId: userIdOf(UNVERIFIED) }));
  });

  test('存在しない利用者の投稿は一括の書き込みごと失敗する', async () => {
    await expectRejected(topLevel(1, { authorUserId: userIdOf(9) }));
  });

  test('他者の未掲載のプロダクトへの投稿は一括の書き込みごと失敗する', async () => {
    await expectRejected(
      topLevel(1, {
        productId: productIdOf(UNLISTED_PRODUCT),
        launchId: launchIdOf(UNLISTED_LAUNCH),
      }),
    );
  });

  test('ローンチが別のプロダクトのものなら一括の書き込みごと失敗する', async () => {
    await expectRejected(
      topLevel(1, {
        launchId: launchIdOf(UNLISTED_LAUNCH),
        authorUserId: userIdOf(OWNER),
        requireListed: false,
      }),
    );
  });
});

describe('CommentStatements.insertStatement(返信)', () => {
  beforeEach(async () => {
    await insertComment({
      index: 1,
      product: LISTED_PRODUCT,
      launch: CURRENT_LAUNCH,
      author: OWNER,
    });
    await insertComment({
      index: 2,
      product: LISTED_PRODUCT,
      launch: CURRENT_LAUNCH,
      author: OWNER,
      parent: { index: 1, root: 1 },
      depth: 2,
    });
    await insertComment({
      index: 3,
      product: LISTED_PRODUCT,
      launch: CURRENT_LAUNCH,
      author: OWNER,
      parent: { index: 2, root: 1 },
      depth: 3,
    });
  });

  test('トップレベルへの返信は、ルートをトップレベル・第2階層・親をトップレベルとして保存する', async () => {
    await post(
      replyTo(10, {
        commentId: commentIdOf(1),
        rootId: commentIdOf(1),
        depth: 1,
      }),
    );

    expect(await readComment(10)).toMatchObject({
      parentId: commentIdOf(1),
      rootId: commentIdOf(1),
      depth: 2,
      launchId: launchIdOf(CURRENT_LAUNCH),
    });
  });

  test('第2階層への返信は、ルートを親のルート・第3階層として保存する', async () => {
    await post(
      replyTo(10, {
        commentId: commentIdOf(2),
        rootId: commentIdOf(1),
        depth: 2,
      }),
    );

    expect(await readComment(10)).toMatchObject({
      parentId: commentIdOf(2),
      rootId: commentIdOf(1),
      depth: 3,
    });
  });

  // 型の上は渡せない第3階層も、呼び出し側の誤りとして書き込みの時点で拒む
  test.each([2, 3])(
    '親が第3階層なら、渡した階層が%iでも一括の書き込みごと失敗する',
    async (depth) => {
      await expectRejected(
        replyTo(10, {
          commentId: commentIdOf(3),
          rootId: commentIdOf(1),
          depth: depth as 1 | 2,
        }),
      );
    },
  );

  test('渡したルートが親のルートと異なれば一括の書き込みごと失敗する', async () => {
    await expectRejected(
      replyTo(10, {
        commentId: commentIdOf(2),
        rootId: commentIdOf(2),
        depth: 2,
      }),
    );
  });

  test.each([
    ['本人が削除した', { deletedAt: AT }],
    ['非公開化された', { hiddenAt: AT }],
    ['匿名化された', { deletedAt: AT, anonymizedAt: AT, authorUserId: null }],
  ])('親が%s置き換え表示なら一括の書き込みごと失敗する', async (_, columns) => {
    await insertComment({
      index: 4,
      product: LISTED_PRODUCT,
      launch: CURRENT_LAUNCH,
      author: OWNER,
      columns,
    });

    await expectRejected(
      replyTo(10, {
        commentId: commentIdOf(4),
        rootId: commentIdOf(4),
        depth: 1,
      }),
    );
  });

  test('親の投稿者が停止されていれば一括の書き込みごと失敗する', async () => {
    await insertUser(5, { emailVerifiedAt: T0, status: 'suspended' });
    await insertComment({
      index: 4,
      product: LISTED_PRODUCT,
      launch: CURRENT_LAUNCH,
      author: 5,
    });

    await expectRejected(
      replyTo(10, {
        commentId: commentIdOf(4),
        rootId: commentIdOf(4),
        depth: 1,
      }),
    );
  });

  test('親が別のローンチのコメントなら一括の書き込みごと失敗する', async () => {
    await insertComment({
      index: 4,
      product: LISTED_PRODUCT,
      launch: WON_LAUNCH,
      author: OWNER,
    });

    await expectRejected(
      replyTo(10, {
        commentId: commentIdOf(4),
        rootId: commentIdOf(4),
        depth: 1,
      }),
    );
  });

  test('親が存在しなければ一括の書き込みごと失敗する', async () => {
    await expectRejected(
      replyTo(10, {
        commentId: commentIdOf(50),
        rootId: commentIdOf(50),
        depth: 1,
      }),
    );
  });

  test('返信にもプロダクトの閲覧の可否と投稿者の状態を確かめる', async () => {
    await db
      .update(products)
      .set({ hiddenAt: AT })
      .where(eq(products.id, productIdOf(LISTED_PRODUCT)));

    await expectRejected(
      replyTo(10, {
        commentId: commentIdOf(1),
        rootId: commentIdOf(1),
        depth: 1,
      }),
    );
  });
});
