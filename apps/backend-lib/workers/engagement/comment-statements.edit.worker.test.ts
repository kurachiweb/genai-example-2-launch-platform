import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { launchComments } from '../../../db/schema/engagement/launch-comments.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { products } from '../../../db/schema/product/products.ts';
import type {
  CommentBodyUpdate,
  CommentInsert,
  CommentSoftDelete,
} from '../../core/engagement/ports.ts';
import { D1CommentStatements } from './comment-statements.ts';
import {
  after,
  changesOf,
  clearEngagementTables,
  COMMENT_GUARD_VIOLATION,
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
  runBatch,
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

const COMMENT = 1;
const AT = after(60_000);

const statements = new D1CommentStatements(db);

function bodyUpdate(
  overrides: Partial<CommentBodyUpdate> = {},
): CommentBodyUpdate {
  return {
    commentId: commentIdOf(COMMENT),
    authorUserId: userIdOf(COMMENTER),
    bodyMarkdown: '**直した**本文',
    requireListed: true,
    at: AT,
    ...overrides,
  };
}

function softDelete(
  overrides: Partial<CommentSoftDelete> = {},
): CommentSoftDelete {
  return {
    commentId: commentIdOf(COMMENT),
    authorUserId: userIdOf(COMMENTER),
    at: AT,
    ...overrides,
  };
}

// 同じ一括の書き込みに並べる、条件を満たす別の投稿
function companionInsert(): CommentInsert {
  return {
    commentId: commentIdOf(99),
    productId: productIdOf(LISTED_PRODUCT),
    launchId: launchIdOf(CURRENT_LAUNCH),
    parent: null,
    authorUserId: userIdOf(OWNER),
    bodyMarkdown: '同じ一括の書き込みの投稿',
    requireListed: false,
    at: AT,
  };
}

async function expectUpdateRejected(input: CommentBodyUpdate): Promise<void> {
  const before = await readComment(COMMENT);
  const count = await countComments();

  await expect(
    runBatch([
      statements.insertStatement(companionInsert()),
      statements.updateBodyStatement(input),
    ]),
  ).rejects.toThrow(COMMENT_GUARD_VIOLATION);

  expect(await readComment(COMMENT)).toEqual(before);
  expect(await countComments()).toBe(count);
}

async function deleteChanges(input: CommentSoftDelete): Promise<number> {
  const results: readonly unknown[] = await db.batch([
    statements.softDeleteStatement(input),
  ]);
  return changesOf(results[0]);
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
  await insertComment({
    index: COMMENT,
    product: LISTED_PRODUCT,
    launch: CURRENT_LAUNCH,
    author: COMMENTER,
  });
});

describe('CommentStatements.updateBodyStatement', () => {
  test('自分の表示できるコメントの本文をマークダウンの原文のまま更新し、編集の日時と更新の日時を入れる', async () => {
    const before = await readComment(COMMENT);
    const bodyMarkdown = '**太字**と<script>alert(1)</script>\n\n- 項目';

    await runBatch([
      statements.updateBodyStatement(bodyUpdate({ bodyMarkdown })),
    ]);

    expect(await readComment(COMMENT)).toEqual({
      ...before,
      body: bodyMarkdown,
      editedAt: AT,
      updatedAt: AT,
    });
  });

  test('同じ一括の書き込みの他の文と一緒に確定する', async () => {
    await runBatch([
      statements.insertStatement(companionInsert()),
      statements.updateBodyStatement(bodyUpdate()),
    ]);

    expect((await readComment(COMMENT))?.body).toBe('**直した**本文');
    expect(await countComments()).toBe(2);
  });

  test('投稿者本人は未掲載の自身のプロダクトへの自分のコメントを編集できる', async () => {
    await insertComment({
      index: 2,
      product: UNLISTED_PRODUCT,
      launch: UNLISTED_LAUNCH,
      author: OWNER,
    });

    await runBatch([
      statements.updateBodyStatement(
        bodyUpdate({
          commentId: commentIdOf(2),
          authorUserId: userIdOf(OWNER),
          requireListed: false,
        }),
      ),
    ]);

    expect((await readComment(2))?.editedAt).toEqual(AT);
  });

  test('投稿からの経過時間や結果の確定したローンチによらず編集できる', async () => {
    await insertComment({
      index: 2,
      product: LISTED_PRODUCT,
      launch: WON_LAUNCH,
      author: COMMENTER,
      columns: { createdAt: after(-365 * 24 * 60 * 60 * 1000) },
    });

    await runBatch([
      statements.updateBodyStatement(bodyUpdate({ commentId: commentIdOf(2) })),
    ]);

    expect((await readComment(2))?.editedAt).toEqual(AT);
  });

  test('他者のコメントの編集は一括の書き込みごと失敗する', async () => {
    await expectUpdateRejected(bodyUpdate({ authorUserId: userIdOf(OWNER) }));
  });

  test.each([
    ['本人が削除した', { deletedAt: T0 }],
    ['非公開化された', { hiddenAt: T0 }],
    ['匿名化された', { deletedAt: T0, anonymizedAt: T0, body: '' }],
  ])('%sコメントの編集は一括の書き込みごと失敗する', async (_, columns) => {
    await db
      .update(launchComments)
      .set(columns)
      .where(eq(launchComments.id, commentIdOf(COMMENT)));

    await expectUpdateRejected(bodyUpdate());
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
  ])('%s後の編集は一括の書き込みごと失敗する', async (_, change) => {
    await change();

    await expectUpdateRejected(bodyUpdate());
  });

  test('他者の未掲載のプロダクトへのコメントの編集は一括の書き込みごと失敗する', async () => {
    await insertComment({
      index: 2,
      product: UNLISTED_PRODUCT,
      launch: UNLISTED_LAUNCH,
      author: COMMENTER,
    });

    await expect(
      runBatch([
        statements.updateBodyStatement(
          bodyUpdate({ commentId: commentIdOf(2) }),
        ),
      ]),
    ).rejects.toThrow(COMMENT_GUARD_VIOLATION);
    expect((await readComment(2))?.editedAt).toBeNull();
  });

  test('投稿者がメールアドレスを確認していなければ一括の書き込みごと失敗する', async () => {
    await insertComment({
      index: 2,
      product: LISTED_PRODUCT,
      launch: CURRENT_LAUNCH,
      author: UNVERIFIED,
    });

    await expect(
      runBatch([
        statements.updateBodyStatement(
          bodyUpdate({
            commentId: commentIdOf(2),
            authorUserId: userIdOf(UNVERIFIED),
          }),
        ),
      ]),
    ).rejects.toThrow(COMMENT_GUARD_VIOLATION);
    expect((await readComment(2))?.editedAt).toBeNull();
  });
});

describe('CommentStatements.softDeleteStatement', () => {
  test('自分の表示できるコメントに削除の日時を入れ、本文と返信の木を残し、変更の件数が1になる', async () => {
    const before = await readComment(COMMENT);

    expect(await deleteChanges(softDelete())).toBe(1);

    expect(await readComment(COMMENT)).toEqual({
      ...before,
      deletedAt: AT,
      updatedAt: AT,
    });
  });

  test('付いている返信は変えない', async () => {
    await insertComment({
      index: 2,
      product: LISTED_PRODUCT,
      launch: CURRENT_LAUNCH,
      author: OWNER,
      parent: { index: COMMENT, root: COMMENT },
      depth: 2,
    });
    const reply = await readComment(2);

    await deleteChanges(softDelete());

    expect(await readComment(2)).toEqual(reply);
  });

  test('メールアドレスを確認していない投稿者も自分のコメントを削除できる', async () => {
    await insertComment({
      index: 2,
      product: LISTED_PRODUCT,
      launch: CURRENT_LAUNCH,
      author: UNVERIFIED,
    });

    expect(
      await deleteChanges(
        softDelete({
          commentId: commentIdOf(2),
          authorUserId: userIdOf(UNVERIFIED),
        }),
      ),
    ).toBe(1);
  });

  test('他者のコメントは変えず、変更の件数が0になる', async () => {
    expect(
      await deleteChanges(softDelete({ authorUserId: userIdOf(OWNER) })),
    ).toBe(0);

    expect((await readComment(COMMENT))?.deletedAt).toBeNull();
  });

  test('存在しないコメントは変更の件数が0になる', async () => {
    expect(
      await deleteChanges(softDelete({ commentId: commentIdOf(50) })),
    ).toBe(0);
  });

  test.each([
    ['削除済みの', { deletedAt: T0 }],
    ['非公開化された', { hiddenAt: T0 }],
    ['匿名化された', { deletedAt: T0, anonymizedAt: T0, body: '' }],
  ])('%sコメントは変えず、変更の件数が0になる', async (_, columns) => {
    await insertComment({
      index: 2,
      product: LISTED_PRODUCT,
      launch: CURRENT_LAUNCH,
      author: COMMENTER,
      columns,
    });
    const before = await readComment(2);

    expect(await deleteChanges(softDelete({ commentId: commentIdOf(2) }))).toBe(
      0,
    );

    expect(await readComment(2)).toEqual(before);
  });
});
