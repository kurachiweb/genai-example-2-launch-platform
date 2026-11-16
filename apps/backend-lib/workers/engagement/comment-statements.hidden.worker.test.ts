import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import { launchComments } from '../../../db/schema/engagement/launch-comments.ts';
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
const PRODUCT = 1;
const LAUNCH = 1;
const COMMENT = 1;
const AT = after(60_000);
const EARLIER = after(30_000);

const statements = new D1CommentStatements(db);

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
    createdAt: AT,
    updatedAt: AT,
  });
}

async function setHiddenAt(at: Date | null): Promise<void> {
  await db
    .update(launchComments)
    .set({ hiddenAt: at })
    .where(eq(launchComments.id, commentIdOf(COMMENT)));
}

// 状態を読んだ後、一括の書き込みの直前に別の操作が同じコメントを変えた状況を作る
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
  await insertProduct(PRODUCT, OWNER);
  await insertLaunch(LAUNCH, PRODUCT);
  await insertComment({
    index: COMMENT,
    product: PRODUCT,
    launch: LAUNCH,
    author: OWNER,
  });
});

describe('CommentStatements.setHidden(非公開化)', () => {
  test('表示中のコメントに非公開化の日時を入れ、changedを返す', async () => {
    const before = await readComment(COMMENT);

    const result = await statements.setHidden({
      commentId: commentIdOf(COMMENT),
      hidden: true,
      at: AT,
    });

    expect(result).toBe('changed');
    expect(await readComment(COMMENT)).toEqual({
      ...before,
      hiddenAt: AT,
      updatedAt: AT,
    });
  });

  test('渡した文を同じ一括の書き込みで確定する', async () => {
    await statements.setHidden({
      commentId: commentIdOf(COMMENT),
      hidden: true,
      at: AT,
      statements: [recordStatement(10), recordStatement(11)],
    });

    expect(await readComment(10)).toBeDefined();
    expect(await readComment(11)).toBeDefined();
  });

  test('渡した文が失敗すると非公開化も取り消される', async () => {
    await expect(
      statements.setHidden({
        commentId: commentIdOf(COMMENT),
        hidden: true,
        at: AT,
        statements: [recordStatement(COMMENT)],
      }),
    ).rejects.toThrow(/UNIQUE constraint failed/u);

    expect((await readComment(COMMENT))?.hiddenAt).toBeNull();
  });

  test('既に非公開化されていれば変更せず、渡した文も実行せずにunchangedを返す', async () => {
    await setHiddenAt(EARLIER);
    const before = await readComment(COMMENT);

    const result = await statements.setHidden({
      commentId: commentIdOf(COMMENT),
      hidden: true,
      at: AT,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('unchanged');
    expect(await readComment(COMMENT)).toEqual(before);
    expect(await readComment(10)).toBeUndefined();
  });

  test.each([
    ['本人が削除した', { deletedAt: EARLIER }],
    [
      '匿名化された',
      {
        deletedAt: EARLIER,
        anonymizedAt: EARLIER,
        authorUserId: null,
        body: '',
      },
    ],
  ])('%sコメントも非公開化できる', async (_, columns) => {
    await insertComment({
      index: 2,
      product: PRODUCT,
      launch: LAUNCH,
      author: OWNER,
      columns,
    });

    const result = await statements.setHidden({
      commentId: commentIdOf(2),
      hidden: true,
      at: AT,
    });

    expect(result).toBe('changed');
    expect((await readComment(2))?.hiddenAt).toEqual(AT);
  });

  test('存在しないコメントは渡した文も実行せずにnot-foundを返す', async () => {
    const count = await countComments();

    const result = await statements.setHidden({
      commentId: commentIdOf(50),
      hidden: true,
      at: AT,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('not-found');
    expect(await countComments()).toBe(count);
  });

  test('状態を読んだ後に別の操作が非公開化していれば、渡した文ごと取り消してunchangedを返す', async () => {
    const racing = new D1CommentStatements(
      racingDatabase(() => setHiddenAt(EARLIER)),
    );

    const result = await racing.setHidden({
      commentId: commentIdOf(COMMENT),
      hidden: true,
      at: AT,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('unchanged');
    expect((await readComment(COMMENT))?.hiddenAt).toEqual(EARLIER);
    expect(await readComment(10)).toBeUndefined();
  });
});

describe('CommentStatements.setHidden(復元)', () => {
  beforeEach(async () => {
    await setHiddenAt(EARLIER);
  });

  test('非公開化されたコメントの非公開化の日時を外し、changedを返す', async () => {
    const result = await statements.setHidden({
      commentId: commentIdOf(COMMENT),
      hidden: false,
      at: AT,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('changed');
    expect(await readComment(COMMENT)).toMatchObject({
      hiddenAt: null,
      updatedAt: AT,
    });
    expect(await readComment(10)).toBeDefined();
  });

  test('削除済みのコメントを復元しても削除の印は残る', async () => {
    await db
      .update(launchComments)
      .set({ deletedAt: EARLIER })
      .where(eq(launchComments.id, commentIdOf(COMMENT)));

    await statements.setHidden({
      commentId: commentIdOf(COMMENT),
      hidden: false,
      at: AT,
    });

    expect(await readComment(COMMENT)).toMatchObject({
      hiddenAt: null,
      deletedAt: EARLIER,
    });
  });

  test('非公開化されていなければ変更せず、渡した文も実行せずにunchangedを返す', async () => {
    await setHiddenAt(null);
    const before = await readComment(COMMENT);

    const result = await statements.setHidden({
      commentId: commentIdOf(COMMENT),
      hidden: false,
      at: AT,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('unchanged');
    expect(await readComment(COMMENT)).toEqual(before);
    expect(await readComment(10)).toBeUndefined();
  });

  test('存在しないコメントはnot-foundを返す', async () => {
    expect(
      await statements.setHidden({
        commentId: commentIdOf(50),
        hidden: false,
        at: AT,
      }),
    ).toBe('not-found');
  });

  test('状態を読んだ後に別の操作が復元していれば、渡した文ごと取り消してunchangedを返す', async () => {
    const racing = new D1CommentStatements(
      racingDatabase(() => setHiddenAt(null)),
    );

    const result = await racing.setHidden({
      commentId: commentIdOf(COMMENT),
      hidden: false,
      at: AT,
      statements: [recordStatement(10)],
    });

    expect(result).toBe('unchanged');
    expect((await readComment(COMMENT))?.hiddenAt).toBeNull();
    expect(await readComment(10)).toBeUndefined();
  });
});
