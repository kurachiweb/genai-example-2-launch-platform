import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import { launchComments } from '../../../db/schema/engagement/launch-comments.ts';
import { D1CommentStatements } from '../../../lib/workers/engagement/comment-statements.ts';
import { D1CommentThreadQuery } from '../../../lib/workers/engagement/d1-comment-thread-query.ts';
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
} from '../../../lib/workers/engagement/testing/engagement-fixtures.ts';
import {
  type CommentModerationControl,
  D1CommentModerationControl,
} from './comment-moderation-control.ts';

const OWNER = 1;
const AUTHOR = 2;
const PRODUCT = 1;
const LAUNCH = 1;
const COMMENT = 1;
const REPLY = 2;
const MISSING = 99;
const AT = after(60_000);
const LATER = after(120_000);

const control: CommentModerationControl = new D1CommentModerationControl(
  new D1CommentStatements(db),
);
const threads = new D1CommentThreadQuery(db);

// 呼び出し側の記録の文の代わりに、別のコメントを挿入する文を渡す
function recordStatement(index: number): BatchItem<'sqlite'> {
  return db.insert(launchComments).values({
    id: commentIdOf(index),
    productId: productIdOf(PRODUCT),
    launchId: launchIdOf(LAUNCH),
    rootId: commentIdOf(index),
    depth: 1,
    authorUserId: userIdOf(OWNER),
    body: '記録',
    createdAt: after(1),
    updatedAt: after(1),
  });
}

async function readThread() {
  const page = await threads.page({
    launchId: launchIdOf(LAUNCH),
    after: undefined,
  });
  return page.threads.find(
    ({ root }) => root.commentId === commentIdOf(COMMENT),
  );
}

beforeEach(async () => {
  await clearEngagementTables();
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(AUTHOR, { emailVerifiedAt: T0 });
  await insertProduct(PRODUCT, OWNER);
  await insertLaunch(LAUNCH, PRODUCT);
  await insertComment({
    index: COMMENT,
    product: PRODUCT,
    launch: LAUNCH,
    author: AUTHOR,
  });
  await insertComment({
    index: REPLY,
    product: PRODUCT,
    launch: LAUNCH,
    author: OWNER,
    parent: { index: COMMENT, root: COMMENT },
    depth: 2,
    columns: { createdAt: after(1000) },
  });
});

describe('CommentModerationControl.hide', () => {
  test('表示中のコメントに非公開化の日時を入れてchangedを返し、渡した文を同じ一括の書き込みで確定する', async () => {
    const result = await control.hide({
      commentId: commentIdOf(COMMENT),
      at: AT,
      statements: [recordStatement(10), recordStatement(11)],
    });

    expect(result).toBe('changed');
    expect(await readComment(COMMENT)).toMatchObject({ hiddenAt: AT });
    expect(await readComment(10)).toBeDefined();
    expect(await readComment(11)).toBeDefined();
  });

  test('渡した文が失敗すると非公開化も取り消される', async () => {
    await expect(
      control.hide({
        commentId: commentIdOf(COMMENT),
        at: AT,
        statements: [recordStatement(REPLY)],
      }),
    ).rejects.toThrow(/UNIQUE constraint failed: launch_comments\.id/u);
    expect(await readComment(COMMENT)).toMatchObject({ hiddenAt: null });
  });

  test('渡す文が無くても非公開化を確定する', async () => {
    const result = await control.hide({
      commentId: commentIdOf(COMMENT),
      at: AT,
    });

    expect(result).toBe('changed');
    expect(await readComment(COMMENT)).toMatchObject({ hiddenAt: AT });
  });

  test('非公開化済みのコメントは変えずにunchangedを返し、渡した文を流さない', async () => {
    await control.hide({ commentId: commentIdOf(COMMENT), at: AT });
    const before = await countComments();

    const result = await control.hide({
      commentId: commentIdOf(COMMENT),
      at: LATER,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('unchanged');
    expect(await readComment(COMMENT)).toMatchObject({ hiddenAt: AT });
    expect(await countComments()).toBe(before);
  });

  test('存在しないコメントはcomment_not_foundの見つからないエラーにし、渡した文を流さない', async () => {
    const before = await countComments();

    await expect(
      control.hide({
        commentId: commentIdOf(MISSING),
        at: AT,
        statements: [recordStatement(10)],
      }),
    ).rejects.toMatchObject({ kind: 'not_found', code: 'comment_not_found' });
    expect(await countComments()).toBe(before);
  });

  test('論理削除と匿名化の後のコメントも非公開化を受け付ける', async () => {
    await insertComment({
      index: 3,
      product: PRODUCT,
      launch: LAUNCH,
      author: null,
      columns: { deletedAt: T0, anonymizedAt: T0, body: '' },
    });

    const result = await control.hide({ commentId: commentIdOf(3), at: AT });

    expect(result).toBe('changed');
    expect(await readComment(3)).toMatchObject({ hiddenAt: AT });
  });
});

describe('CommentModerationControl.unhide', () => {
  test('非公開化済みのコメントの非公開化を取り消してchangedを返し、渡した文を同じ一括の書き込みで確定する', async () => {
    await control.hide({ commentId: commentIdOf(COMMENT), at: AT });

    const result = await control.unhide({
      commentId: commentIdOf(COMMENT),
      at: LATER,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('changed');
    expect(await readComment(COMMENT)).toMatchObject({ hiddenAt: null });
    expect(await readComment(10)).toBeDefined();
  });

  test('非公開化されていないコメントは変えずにunchangedを返し、渡した文を流さない', async () => {
    const before = await countComments();

    const result = await control.unhide({
      commentId: commentIdOf(COMMENT),
      at: AT,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('unchanged');
    expect(await countComments()).toBe(before);
  });

  test('存在しないコメントはcomment_not_foundの見つからないエラーにする', async () => {
    await expect(
      control.unhide({ commentId: commentIdOf(MISSING), at: AT }),
    ).rejects.toMatchObject({ kind: 'not_found', code: 'comment_not_found' });
  });
});

describe('CommentModerationControl: 表示への反映', () => {
  test('非公開化の次の読み取りからコメントを置き換え表示にして返信を残し、復元で元の表示に戻す', async () => {
    const before = await readThread();

    await control.hide({ commentId: commentIdOf(COMMENT), at: AT });
    const hidden = await readThread();
    await control.unhide({ commentId: commentIdOf(COMMENT), at: LATER });
    const restored = await readThread();

    expect(before?.root).toMatchObject({
      kind: 'shown',
      authorUserId: userIdOf(AUTHOR),
    });
    expect(hidden?.root).toEqual({
      kind: 'removed',
      commentId: commentIdOf(COMMENT),
      parentId: null,
      depth: 1,
    });
    expect(hidden?.replies).toEqual([
      expect.objectContaining({
        kind: 'shown',
        commentId: commentIdOf(REPLY),
      }),
    ]);
    expect(restored).toEqual(before);
  });

  test('非公開化の後に論理削除したコメントは非公開化を取り消しても置き換え表示のまま', async () => {
    await control.hide({ commentId: commentIdOf(COMMENT), at: AT });
    await db
      .update(launchComments)
      .set({ deletedAt: AT })
      .where(eq(launchComments.id, commentIdOf(COMMENT)));

    const result = await control.unhide({
      commentId: commentIdOf(COMMENT),
      at: LATER,
    });

    expect(result).toBe('changed');
    expect((await readThread())?.root.kind).toBe('removed');
  });
});
