import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';

import type {
  AdminCommentDirectory,
  AdminCommentRecord,
  AdminCommentState,
} from '../../core/engagement/ports.ts';
import { AppError } from '../../core/errors/app-error.ts';
import { createFailingDatabase } from '../identity/testing/identity-store-fixtures.ts';
import { D1AdminCommentDirectory } from './d1-admin-comment-directory.ts';
import {
  after,
  clearEngagementTables,
  commentIdOf,
  type CommentFixture,
  db,
  insertComment,
  insertComments,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  productIdOf,
  T0,
  userIdOf,
} from './testing/engagement-fixtures.ts';

const OWNER = 1;
const AUTHOR = 2;
const OTHER_AUTHOR = 3;
const WITHDRAWN = 4;
const SUSPENDED = 5;
const PRODUCT = 1;
const HIDDEN_PRODUCT = 2;
const DELETED_PRODUCT = 3;
const LAUNCH = 1;
const HIDDEN_PRODUCT_LAUNCH = 2;
const DELETED_PRODUCT_LAUNCH = 3;

const EXCERPT_GRAPHEMES = 200;

// 結合文字を含む絵文字は1書記素で複数のコード単位を持つ
const FAMILY_EMOJI = '👨‍👩‍👧‍👦';

const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();

function base64urlOf(text: string): string {
  return textEncoder.encode(text).toBase64(BASE64URL_OPTIONS);
}

function createDirectory(database = db): AdminCommentDirectory {
  return new D1AdminCommentDirectory(database);
}

function commentAt(
  index: number,
  milliseconds: number,
  fixture: Partial<CommentFixture> = {},
): CommentFixture {
  return {
    index,
    product: PRODUCT,
    launch: LAUNCH,
    author: AUTHOR,
    ...fixture,
    columns: {
      createdAt: after(milliseconds),
      updatedAt: after(milliseconds),
      ...fixture.columns,
    },
  };
}

function idsOf(comments: readonly AdminCommentRecord[]): string[] {
  return comments.map((comment) => comment.commentId);
}

beforeEach(async () => {
  await clearEngagementTables();
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(AUTHOR, { emailVerifiedAt: T0 });
  await insertUser(OTHER_AUTHOR, { emailVerifiedAt: T0 });
  await insertUser(WITHDRAWN, { emailVerifiedAt: T0, deletedAt: after(1) });
  await insertUser(SUSPENDED, { emailVerifiedAt: T0, status: 'suspended' });
  await insertProduct(PRODUCT, OWNER);
  await insertProduct(HIDDEN_PRODUCT, OWNER, { hiddenAt: after(1) });
  await insertProduct(DELETED_PRODUCT, OWNER, { deletedAt: after(1) });
  await insertLaunch(LAUNCH, PRODUCT);
  await insertLaunch(HIDDEN_PRODUCT_LAUNCH, HIDDEN_PRODUCT);
  await insertLaunch(DELETED_PRODUCT_LAUNCH, DELETED_PRODUCT);
});

describe('D1AdminCommentDirectory.search', () => {
  test('コメントの識別・プロダクト・ローンチ・投稿者・抜粋・日時・状態を返す', async () => {
    await insertComment(
      commentAt(1, 1000, {
        columns: { body: '本文の**原文**', editedAt: after(5000) },
      }),
    );
    await insertComment(
      commentAt(2, 2000, {
        parent: { index: 1, root: 1 },
        depth: 2,
        author: OTHER_AUTHOR,
      }),
    );

    const { comments, nextCursor } = await createDirectory().search(
      {},
      { limit: 10 },
    );

    expect(comments).toEqual([
      {
        commentId: commentIdOf(2),
        productId: productIdOf(PRODUCT),
        launchId: launchIdOf(LAUNCH),
        authorUserId: userIdOf(OTHER_AUTHOR),
        excerpt: 'コメント2',
        createdAt: after(2000),
        editedAt: null,
        state: 'shown',
      },
      {
        commentId: commentIdOf(1),
        productId: productIdOf(PRODUCT),
        launchId: launchIdOf(LAUNCH),
        authorUserId: userIdOf(AUTHOR),
        excerpt: '本文の**原文**',
        createdAt: after(1000),
        editedAt: after(5000),
        state: 'shown',
      },
    ] satisfies AdminCommentRecord[]);
    expect(nextCursor).toBeNull();
  });

  test('作成の新しい順に並べ、同じ日時はIDの降順にする', async () => {
    await insertComments([
      commentAt(1, 1000),
      commentAt(2, 3000),
      commentAt(3, 2000),
      commentAt(4, 2000),
    ]);

    const { comments } = await createDirectory().search({}, { limit: 10 });

    expect(idsOf(comments)).toEqual([
      commentIdOf(2),
      commentIdOf(4),
      commentIdOf(3),
      commentIdOf(1),
    ]);
  });

  test('投稿者で絞り込む', async () => {
    await insertComments([
      commentAt(1, 1000),
      commentAt(2, 2000, { author: OTHER_AUTHOR }),
      commentAt(3, 3000),
    ]);

    const { comments } = await createDirectory().search(
      { authorUserId: userIdOf(AUTHOR) },
      { limit: 10 },
    );

    expect(idsOf(comments)).toEqual([commentIdOf(3), commentIdOf(1)]);
  });

  test('プロダクトで絞り込む', async () => {
    await insertComments([
      commentAt(1, 1000),
      commentAt(2, 2000, {
        product: HIDDEN_PRODUCT,
        launch: HIDDEN_PRODUCT_LAUNCH,
      }),
    ]);

    const { comments } = await createDirectory().search(
      { productId: productIdOf(HIDDEN_PRODUCT) },
      { limit: 10 },
    );

    expect(idsOf(comments)).toEqual([commentIdOf(2)]);
  });

  test('投稿期間で絞り込み、開始の日時を含み終了の日時を含まない', async () => {
    await insertComments([
      commentAt(1, 999),
      commentAt(2, 1000),
      commentAt(3, 1999),
      commentAt(4, 2000),
    ]);
    const directory = createDirectory();

    const both = await directory.search(
      { postedFrom: after(1000), postedBefore: after(2000) },
      { limit: 10 },
    );
    const fromOnly = await directory.search(
      { postedFrom: after(1000) },
      { limit: 10 },
    );
    const beforeOnly = await directory.search(
      { postedBefore: after(1000) },
      { limit: 10 },
    );

    expect(idsOf(both.comments)).toEqual([commentIdOf(3), commentIdOf(2)]);
    expect(idsOf(fromOnly.comments)).toEqual([
      commentIdOf(4),
      commentIdOf(3),
      commentIdOf(2),
    ]);
    expect(idsOf(beforeOnly.comments)).toEqual([commentIdOf(1)]);
  });

  test('複数の絞り込みは全てを満たすコメントだけを返す', async () => {
    await insertComments([
      commentAt(1, 1000),
      commentAt(2, 2000, { columns: { hiddenAt: after(9000) } }),
      commentAt(3, 3000, {
        author: OTHER_AUTHOR,
        columns: { hiddenAt: after(9000) },
      }),
      commentAt(4, 4000, {
        product: HIDDEN_PRODUCT,
        launch: HIDDEN_PRODUCT_LAUNCH,
        columns: { hiddenAt: after(9000) },
      }),
    ]);

    const { comments } = await createDirectory().search(
      {
        authorUserId: userIdOf(AUTHOR),
        productId: productIdOf(PRODUCT),
        state: 'hidden',
      },
      { limit: 10 },
    );

    expect(idsOf(comments)).toEqual([commentIdOf(2)]);
  });

  describe('状態', () => {
    const CASES = [
      { index: 1, expected: 'shown', fixture: {} },
      {
        index: 2,
        expected: 'hidden',
        fixture: { columns: { hiddenAt: after(9000) } },
      },
      {
        index: 3,
        expected: 'deleted',
        fixture: { columns: { deletedAt: after(9000) } },
      },
      {
        index: 4,
        expected: 'hidden',
        fixture: {
          columns: { hiddenAt: after(9000), deletedAt: after(9500) },
        },
      },
      {
        index: 5,
        expected: 'anonymized',
        fixture: {
          author: null,
          columns: { body: '', anonymizedAt: after(9500) },
        },
      },
      {
        index: 6,
        expected: 'hidden',
        fixture: {
          author: null,
          columns: {
            body: '',
            hiddenAt: after(8000),
            deletedAt: after(9000),
            anonymizedAt: after(9500),
          },
        },
      },
      {
        index: 7,
        expected: 'author_unavailable',
        fixture: { author: WITHDRAWN },
      },
      {
        index: 8,
        expected: 'author_unavailable',
        fixture: { author: SUSPENDED },
      },
      { index: 9, expected: 'author_unavailable', fixture: { author: null } },
      {
        index: 10,
        expected: 'deleted',
        fixture: { author: SUSPENDED, columns: { deletedAt: after(9000) } },
      },
      {
        index: 11,
        expected: 'hidden',
        fixture: { author: WITHDRAWN, columns: { hiddenAt: after(9000) } },
      },
      {
        index: 12,
        expected: 'anonymized',
        fixture: {
          author: null,
          columns: {
            body: '',
            deletedAt: after(9000),
            anonymizedAt: after(9500),
          },
        },
      },
    ] as const satisfies readonly {
      readonly index: number;
      readonly expected: AdminCommentState;
      readonly fixture: Partial<CommentFixture>;
    }[];

    const STATES = [
      'hidden',
      'deleted',
      'anonymized',
      'author_unavailable',
      'shown',
    ] as const satisfies readonly AdminCommentState[];

    beforeEach(async () => {
      await insertComments(
        CASES.map(({ index, fixture }) =>
          commentAt(index, index * 1000, fixture),
        ),
      );
    });

    test('非公開化・削除・匿名化・投稿者が利用できない・表示中の順に優先して1つの状態に決める', async () => {
      const { comments } = await createDirectory().search({}, { limit: 20 });

      expect(
        Object.fromEntries(
          comments.map((comment) => [comment.commentId, comment.state]),
        ),
      ).toEqual(
        Object.fromEntries(
          CASES.map(({ index, expected }) => [commentIdOf(index), expected]),
        ),
      );
    });

    test.each(STATES)(
      '状態(%s)で絞り込むと、同じ優先の規則でその状態に決まるコメントだけを返す',
      async (state) => {
        const { comments } = await createDirectory().search(
          { state },
          { limit: 20 },
        );

        expect(idsOf(comments)).toEqual(
          CASES.filter(({ expected }) => expected === state)
            .map(({ index }) => commentIdOf(index))
            .toReversed(),
        );
        expect(comments.every((comment) => comment.state === state)).toBe(true);
      },
    );

    test('投稿者の停止を解除すると表示中に戻る', async () => {
      await db
        .update(users)
        .set({ status: 'active' })
        .where(eq(users.id, userIdOf(SUSPENDED)));

      const { comments } = await createDirectory().search(
        { authorUserId: userIdOf(SUSPENDED) },
        { limit: 20 },
      );

      expect(
        comments.map((comment) => [comment.commentId, comment.state]),
      ).toEqual([
        [commentIdOf(10), 'deleted'],
        [commentIdOf(8), 'shown'],
      ]);
    });
  });

  test('非公開化・論理削除したプロダクトのコメントも返す', async () => {
    await insertComments([
      commentAt(1, 1000),
      commentAt(2, 2000, {
        product: HIDDEN_PRODUCT,
        launch: HIDDEN_PRODUCT_LAUNCH,
      }),
      commentAt(3, 3000, {
        product: DELETED_PRODUCT,
        launch: DELETED_PRODUCT_LAUNCH,
      }),
    ]);

    const { comments } = await createDirectory().search({}, { limit: 10 });

    expect(
      comments.map((comment) => [comment.productId, comment.state]),
    ).toEqual([
      [productIdOf(DELETED_PRODUCT), 'shown'],
      [productIdOf(HIDDEN_PRODUCT), 'shown'],
      [productIdOf(PRODUCT), 'shown'],
    ]);
  });

  describe('抜粋', () => {
    test('本文の先頭200書記素を抜粋にし、結合文字を含む絵文字を途中で切らない', async () => {
      const longBody = `${'あ'.repeat(EXCERPT_GRAPHEMES - 1)}${FAMILY_EMOJI}${FAMILY_EMOJI}い`;
      const exactBody = FAMILY_EMOJI.repeat(EXCERPT_GRAPHEMES);
      await insertComments([
        commentAt(1, 1000, { columns: { body: longBody } }),
        commentAt(2, 2000, { columns: { body: exactBody } }),
      ]);

      const { comments } = await createDirectory().search({}, { limit: 10 });

      expect(comments.map((comment) => comment.excerpt)).toEqual([
        exactBody,
        `${'あ'.repeat(EXCERPT_GRAPHEMES - 1)}${FAMILY_EMOJI}`,
      ]);
    });

    test('削除・非公開化のコメントも本文の抜粋を返し、匿名化したコメントは空にする', async () => {
      await insertComments([
        commentAt(1, 1000, { columns: { deletedAt: after(9000) } }),
        commentAt(2, 2000, { columns: { hiddenAt: after(9000) } }),
        commentAt(3, 3000, {
          author: null,
          columns: { deletedAt: after(9000), anonymizedAt: after(9500) },
        }),
      ]);

      const { comments } = await createDirectory().search({}, { limit: 10 });

      expect(comments.map((comment) => comment.excerpt)).toEqual([
        '',
        'コメント2',
        'コメント1',
      ]);
    });
  });

  describe('ページ分け', () => {
    test('件数の上限まで返し、続きがあればカーソルを返す', async () => {
      await insertComments(
        Array.from({ length: 101 }, (_, offset) =>
          commentAt(offset + 1, (offset + 1) * 10),
        ),
      );
      const directory = createDirectory();

      const largest = await directory.search({}, { limit: 100 });
      const smallest = await directory.search({}, { limit: 1 });

      expect(largest.comments).toHaveLength(100);
      expect(largest.nextCursor).not.toBeNull();
      expect(idsOf(smallest.comments)).toEqual([commentIdOf(101)]);
      expect(smallest.nextCursor).not.toBeNull();
    });

    test('カーソルで続きを重複・欠落なく取得し、最後のページではカーソルを返さない', async () => {
      await insertComments([
        commentAt(1, 1000),
        commentAt(2, 2000),
        commentAt(3, 2000),
        commentAt(4, 2000),
        commentAt(5, 3000),
      ]);
      const directory = createDirectory();

      const first = await directory.search({}, { limit: 2 });
      await insertComment(commentAt(6, 4000));
      const second = await directory.search(
        {},
        { limit: 2, after: first.nextCursor ?? undefined },
      );
      const third = await directory.search(
        {},
        { limit: 2, after: second.nextCursor ?? undefined },
      );

      expect(idsOf(first.comments)).toEqual([commentIdOf(5), commentIdOf(4)]);
      expect(idsOf(second.comments)).toEqual([commentIdOf(3), commentIdOf(2)]);
      expect(idsOf(third.comments)).toEqual([commentIdOf(1)]);
      expect(third.nextCursor).toBeNull();
    });

    test('続きが無い件数ちょうどのページではカーソルを返さない', async () => {
      await insertComments([commentAt(1, 1000), commentAt(2, 2000)]);

      const { comments, nextCursor } = await createDirectory().search(
        {},
        { limit: 2 },
      );

      expect(comments).toHaveLength(2);
      expect(nextCursor).toBeNull();
    });

    test('カーソルは最後のコメントの作成日時のミリ秒とIDをコロンでつないだbase64urlである', async () => {
      await insertComments([commentAt(1, 1000), commentAt(2, 2000)]);

      const { nextCursor } = await createDirectory().search({}, { limit: 1 });

      expect(nextCursor).toBe(
        base64urlOf(`${String(after(2000).getTime())}:${commentIdOf(2)}`),
      );
    });

    test('カーソルの続きにも絞り込みの条件を適用する', async () => {
      await insertComments([
        commentAt(1, 1000, { columns: { hiddenAt: after(9000) } }),
        commentAt(2, 2000),
        commentAt(3, 3000, { columns: { hiddenAt: after(9000) } }),
        commentAt(4, 4000),
      ]);
      const directory = createDirectory();

      const first = await directory.search({ state: 'hidden' }, { limit: 1 });
      const second = await directory.search(
        { state: 'hidden' },
        { limit: 1, after: first.nextCursor ?? undefined },
      );

      expect(idsOf(first.comments)).toEqual([commentIdOf(3)]);
      expect(idsOf(second.comments)).toEqual([commentIdOf(1)]);
      expect(second.nextCursor).toBeNull();
    });

    test.each([
      ['形式の違う文字列', 'not-a-cursor'],
      ['空文字列', ''],
      ['区切りの無い値', base64urlOf(`1730419200000${commentIdOf(1)}`)],
      ['ミリ秒が数字でない値', base64urlOf(`abc:${commentIdOf(1)}`)],
      ['IDの欠けた値', base64urlOf('1730419200000:')],
      ['IDの長さが違う値', base64urlOf('1730419200000:01JD0CMNT')],
      ['IDが小文字の値', base64urlOf(`1:${commentIdOf(1).toLowerCase()}`)],
      ...['I', 'L', 'O', 'U'].map((letter) => [
        `IDがCrockford Base32に無い${letter}を含む値`,
        base64urlOf(`1:${commentIdOf(1).slice(0, 25)}${letter}`),
      ]),
      ['パディング付きの値', `${base64urlOf(`1:${commentIdOf(1)}`)}=`],
      ['base64urlでない文字を含む値', `${base64urlOf(`1:${commentIdOf(1)}`)}+`],
    ])(
      '不正なカーソル(%s)をページの位置の指定の誤りとして拒否する',
      async (_name, cursor) => {
        const searching = createDirectory().search(
          {},
          { limit: 10, after: cursor },
        );

        await expect(searching).rejects.toBeInstanceOf(AppError);
        await expect(searching).rejects.toMatchObject({
          kind: 'bad_request',
          code: 'invalid_cursor',
        });
      },
    );

    test.each([0, 101, 1.5])(
      '件数(%s)が1〜100の整数でなければ入力の誤りとして拒否する',
      async (limit) => {
        await expect(
          createDirectory().search({}, { limit }),
        ).rejects.toMatchObject({
          kind: 'bad_request',
          code: 'validation_error',
        });
      },
    );
  });

  test('D1への問い合わせに失敗したら例外にする', async () => {
    await expect(
      createDirectory(createFailingDatabase()).search({}, { limit: 10 }),
    ).rejects.toThrow();
  });
});
