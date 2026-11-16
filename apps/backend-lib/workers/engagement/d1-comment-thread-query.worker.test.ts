import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { Container } from 'inversify';
import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import { createDatabase, type Database } from '../../../db/client.ts';
import { launchComments } from '../../../db/schema/engagement/launch-comments.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { ENGAGEMENT_PLATFORM_TYPES } from '../../core/engagement/identifiers.ts';
import type {
  CommentRow,
  CommentThreadPage,
  CommentThreadQuery,
} from '../../core/engagement/ports.ts';
import { D1CommentThreadQuery } from './d1-comment-thread-query.ts';
import {
  after,
  clearEngagementTables,
  commentIdOf,
  db,
  insertComment,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  T0,
  userIdOf,
} from './testing/engagement-fixtures.ts';

const COMMENTER = 1;
const WITHDRAWN = 2;
const SUSPENDED = 3;
const PRODUCT = 1;
const LAUNCH = 1;
const OTHER_LAUNCH = 2;

const query = new D1CommentThreadQuery(db);

function firstPage(): Promise<CommentThreadPage> {
  return query.page({ launchId: launchIdOf(LAUNCH), after: undefined });
}

function pageAfter(index: number, createdAt: Date): Promise<CommentThreadPage> {
  return query.page({
    launchId: launchIdOf(LAUNCH),
    after: { createdAt: createdAt.getTime(), commentId: commentIdOf(index) },
  });
}

function rootIdsOf(page: CommentThreadPage): string[] {
  return page.threads.map((thread) => thread.root.commentId);
}

async function insertTopLevels(
  indexes: readonly number[],
  createdAtOf: (index: number) => Date,
): Promise<void> {
  for (const index of indexes) {
    await insertComment({
      index,
      product: PRODUCT,
      launch: LAUNCH,
      author: COMMENTER,
      columns: { createdAt: createdAtOf(index) },
    });
  }
}

async function insertReply(
  index: number,
  rootIndex: number,
  createdAt: Date,
): Promise<void> {
  await insertComment({
    index,
    product: PRODUCT,
    launch: LAUNCH,
    author: COMMENTER,
    parent: { index: rootIndex, root: rootIndex },
    depth: 2,
    columns: { createdAt },
  });
}

interface RecordingDatabase {
  readonly database: Database;
  readonly preparedCount: { value: number };
  readonly batchSizes: number[];
  // 一括の読み取りごとの、文ごとの読んだ行数
  readonly rowCounts: number[][];
}

function recordingDatabase(): RecordingDatabase {
  const d1 = env.DB;
  const preparedCount = { value: 0 };
  const batchSizes: number[] = [];
  const rowCounts: number[][] = [];
  const database = createDatabase({
    prepare: (statement) => {
      preparedCount.value += 1;
      return d1.prepare(statement);
    },
    batch: async <T>(statements: D1PreparedStatement[]) => {
      batchSizes.push(statements.length);
      const results = await d1.batch<T>(statements);
      rowCounts.push(results.map((result) => result.results.length));
      return results;
    },
    exec: d1.exec.bind(d1),
    withSession: d1.withSession.bind(d1),
    // D1Databaseの型が非推奨のdumpも必須にするため、偽物でも渡す
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    dump: d1.dump.bind(d1),
  });
  return { database, preparedCount, batchSizes, rowCounts };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

function removed(index: number, parentIndex?: number): CommentRow {
  return {
    kind: 'removed',
    commentId: commentIdOf(index),
    parentId: parentIndex === undefined ? null : commentIdOf(parentIndex),
    depth: parentIndex === undefined ? 1 : 2,
  };
}

beforeEach(async () => {
  await clearEngagementTables();
  await insertUser(COMMENTER, { emailVerifiedAt: T0 });
  await insertUser(WITHDRAWN, { emailVerifiedAt: T0, deletedAt: after(1) });
  await insertUser(SUSPENDED, { emailVerifiedAt: T0, status: 'suspended' });
  await insertProduct(PRODUCT, COMMENTER);
  await insertLaunch(LAUNCH, PRODUCT, {
    launchDate: '2026-11-10',
    outcome: 'won',
    decidedAt: T0,
  });
  await insertLaunch(OTHER_LAUNCH, PRODUCT);
});

describe('D1CommentThreadQuery', () => {
  test('識別子でデータベースを注入して、スレッドの照会として取得できる', () => {
    const container = new Container();
    container.bind<Database>(PLATFORM_TYPES.Database).toConstantValue(db);
    container
      .bind<CommentThreadQuery>(ENGAGEMENT_PLATFORM_TYPES.CommentThreadQuery)
      .to(D1CommentThreadQuery);

    const resolved = container.get<CommentThreadQuery>(
      ENGAGEMENT_PLATFORM_TYPES.CommentThreadQuery,
    );

    expect(resolved).toBeInstanceOf(D1CommentThreadQuery);
    expectTypeOf(resolved).toEqualTypeOf<CommentThreadQuery>();
  });

  describe('page', () => {
    test('トップレベルを新しい順に10件返し、11件目があれば次のページがあると返す', async () => {
      await insertTopLevels(range(1, 11), (index) => after(index));
      await insertComment({
        index: 50,
        product: PRODUCT,
        launch: OTHER_LAUNCH,
        author: COMMENTER,
        columns: { createdAt: after(100) },
      });

      const page = await firstPage();

      expect(rootIdsOf(page)).toEqual(range(2, 11).reverse().map(commentIdOf));
      expect(page.hasNextPage).toBe(true);
    });

    test('トップレベルがちょうど10件なら次のページが無いと返す', async () => {
      await insertTopLevels(range(1, 10), (index) => after(index));

      const page = await firstPage();

      expect(rootIdsOf(page)).toEqual(range(1, 10).reverse().map(commentIdOf));
      expect(page.hasNextPage).toBe(false);
    });

    test('コメントの無いローンチは空のページを返す', async () => {
      expect(await firstPage()).toEqual<CommentThreadPage>({
        threads: [],
        hasNextPage: false,
      });
    });

    test('カーソルの続きは、間に新しい投稿があっても重複・欠落せずに返す', async () => {
      await insertTopLevels(range(1, 12), (index) => after(index));
      const first = await firstPage();
      await insertTopLevels([13, 14], (index) => after(index));

      const second = await pageAfter(3, after(3));

      expect(rootIdsOf(first)).toEqual(range(3, 12).reverse().map(commentIdOf));
      expect(rootIdsOf(second)).toEqual([commentIdOf(2), commentIdOf(1)]);
      expect(second.hasNextPage).toBe(false);
    });

    test('カーソルの続きのページは、そのページのルートの返信だけを古い順に付け、前のページのルートの返信を含めない', async () => {
      await insertTopLevels(range(1, 12), (index) => after(index));
      await insertReply(30, 3, after(60));
      await insertReply(31, 12, after(61));
      await insertReply(32, 2, after(63));
      await insertReply(33, 1, after(62));
      await insertReply(34, 2, after(64));
      const first = await firstPage();
      await insertReply(35, 3, after(70));

      const second = await pageAfter(3, after(3));

      expect(
        first.threads.flatMap((thread) =>
          thread.replies.map((reply) => reply.commentId),
        ),
      ).toEqual([commentIdOf(31), commentIdOf(30)]);
      expect(
        second.threads.map((thread) => [
          thread.root.commentId,
          thread.replies.map((reply) => reply.commentId),
        ]),
      ).toEqual([
        [commentIdOf(2), [commentIdOf(32), commentIdOf(34)]],
        [commentIdOf(1), [commentIdOf(33)]],
      ]);
    });

    test('同じ投稿日時のトップレベルは識別子の降順に並べ、カーソルの続きで重複・欠落しない', async () => {
      await insertTopLevels(range(1, 12), () => T0);

      const first = await firstPage();
      const second = await pageAfter(3, T0);

      expect(rootIdsOf(first)).toEqual(range(3, 12).reverse().map(commentIdOf));
      expect(first.hasNextPage).toBe(true);
      expect(rootIdsOf(second)).toEqual([commentIdOf(2), commentIdOf(1)]);
    });

    test('各ルートの全ての返信を階層によらず作成の古い順に返し、返信の無いルートは空の返信を返す', async () => {
      await insertTopLevels([1, 2], (index) => after(index));
      await insertComment({
        index: 3,
        product: PRODUCT,
        launch: LAUNCH,
        author: COMMENTER,
        parent: { index: 1, root: 1 },
        depth: 2,
        columns: { createdAt: after(30) },
      });
      await insertComment({
        index: 4,
        product: PRODUCT,
        launch: LAUNCH,
        author: COMMENTER,
        parent: { index: 3, root: 1 },
        depth: 3,
        columns: { createdAt: after(40) },
      });
      await insertComment({
        index: 5,
        product: PRODUCT,
        launch: LAUNCH,
        author: COMMENTER,
        parent: { index: 1, root: 1 },
        depth: 2,
        columns: { createdAt: after(20) },
      });

      const page = await firstPage();

      expect(rootIdsOf(page)).toEqual([commentIdOf(2), commentIdOf(1)]);
      expect(page.threads[0]?.replies).toEqual([]);
      expect(
        page.threads[1]?.replies.map((reply) => [
          reply.commentId,
          reply.parentId,
          reply.depth,
        ]),
      ).toEqual([
        [commentIdOf(5), commentIdOf(1), 2],
        [commentIdOf(3), commentIdOf(1), 2],
        [commentIdOf(4), commentIdOf(3), 3],
      ]);
    });

    test('11件目のルートの返信はデータベースから読まない', async () => {
      await insertTopLevels(range(1, 11), (index) => after(index));
      await insertComment({
        index: 20,
        product: PRODUCT,
        launch: LAUNCH,
        author: COMMENTER,
        parent: { index: 1, root: 1 },
        depth: 2,
        columns: { createdAt: after(50) },
      });

      const recording = recordingDatabase();

      const page = await new D1CommentThreadQuery(recording.database).page({
        launchId: launchIdOf(LAUNCH),
        after: undefined,
      });

      expect(page.threads.flatMap((thread) => thread.replies)).toEqual([]);
      expect(recording.rowCounts).toEqual([[11, 0]]);
    });

    test('表示できるコメントは投稿者・本文・投稿日時・編集済みの印を返す', async () => {
      await insertComment({
        index: 1,
        product: PRODUCT,
        launch: LAUNCH,
        author: COMMENTER,
        columns: { body: '**原文**', createdAt: after(1) },
      });
      await insertComment({
        index: 2,
        product: PRODUCT,
        launch: LAUNCH,
        author: COMMENTER,
        parent: { index: 1, root: 1 },
        depth: 2,
        columns: { createdAt: after(2), editedAt: after(3) },
      });

      const page = await firstPage();

      expect(page.threads).toEqual([
        {
          root: {
            kind: 'shown',
            commentId: commentIdOf(1),
            parentId: null,
            depth: 1,
            authorUserId: userIdOf(COMMENTER),
            bodyMarkdown: '**原文**',
            createdAt: after(1),
            edited: false,
          },
          replies: [
            {
              kind: 'shown',
              commentId: commentIdOf(2),
              parentId: commentIdOf(1),
              depth: 2,
              authorUserId: userIdOf(COMMENTER),
              bodyMarkdown: 'コメント2',
              createdAt: after(2),
              edited: true,
            },
          ],
        },
      ]);
    });

    test('退会・本人の削除・停止・非公開化・匿名化のコメントは、削除を経ない匿名化と投稿者の紐付けの解除だけの行を含めて、本文・投稿者・日時を返さず同じ形の置き換え表示にする', async () => {
      await insertComment({
        index: 1,
        product: PRODUCT,
        launch: LAUNCH,
        author: WITHDRAWN,
        columns: { createdAt: after(1) },
      });
      await insertComment({
        index: 2,
        product: PRODUCT,
        launch: LAUNCH,
        author: COMMENTER,
        columns: { createdAt: after(2), deletedAt: after(10) },
      });
      await insertComment({
        index: 3,
        product: PRODUCT,
        launch: LAUNCH,
        author: SUSPENDED,
        columns: { createdAt: after(3), editedAt: after(4) },
      });
      await insertComment({
        index: 4,
        product: PRODUCT,
        launch: LAUNCH,
        author: COMMENTER,
        columns: { createdAt: after(4), hiddenAt: after(10) },
      });
      await insertComment({
        index: 5,
        product: PRODUCT,
        launch: LAUNCH,
        author: null,
        columns: {
          body: '',
          createdAt: after(5),
          deletedAt: after(6),
          anonymizedAt: after(10),
        },
      });

      await insertComment({
        index: 6,
        product: PRODUCT,
        launch: LAUNCH,
        author: COMMENTER,
        columns: { createdAt: after(6), anonymizedAt: after(10) },
      });
      await insertComment({
        index: 7,
        product: PRODUCT,
        launch: LAUNCH,
        author: null,
        columns: { createdAt: after(7) },
      });

      const page = await firstPage();

      expect(page.threads).toStrictEqual(
        [7, 6, 5, 4, 3, 2, 1].map((index) => ({
          root: removed(index),
          replies: [],
        })),
      );
    });

    test('置き換え表示のトップレベルに付いた返信は、それぞれの状態に従って返す', async () => {
      await insertComment({
        index: 1,
        product: PRODUCT,
        launch: LAUNCH,
        author: COMMENTER,
        columns: { createdAt: after(1), deletedAt: after(10) },
      });
      await insertComment({
        index: 2,
        product: PRODUCT,
        launch: LAUNCH,
        author: COMMENTER,
        parent: { index: 1, root: 1 },
        depth: 2,
        columns: { createdAt: after(2) },
      });
      await insertComment({
        index: 3,
        product: PRODUCT,
        launch: LAUNCH,
        author: SUSPENDED,
        parent: { index: 1, root: 1 },
        depth: 2,
        columns: { createdAt: after(3) },
      });

      const [thread] = (await firstPage()).threads;

      expect(thread?.root).toStrictEqual(removed(1));
      expect(thread?.replies.map((reply) => reply.kind)).toEqual([
        'shown',
        'removed',
      ]);
      expect(thread?.replies[1]).toStrictEqual(removed(3, 1));
    });

    test('停止の解除と非公開化の取消で、再び表示する', async () => {
      await insertComment({
        index: 1,
        product: PRODUCT,
        launch: LAUNCH,
        author: SUSPENDED,
        columns: { createdAt: after(1) },
      });
      await insertComment({
        index: 2,
        product: PRODUCT,
        launch: LAUNCH,
        author: COMMENTER,
        columns: { createdAt: after(2), hiddenAt: after(10) },
      });
      const before = await firstPage();

      await db
        .update(users)
        .set({ status: 'active' })
        .where(eq(users.id, userIdOf(SUSPENDED)));
      await db
        .update(launchComments)
        .set({ hiddenAt: null })
        .where(eq(launchComments.id, commentIdOf(2)));
      const restored = await firstPage();

      expect(before.threads.map((thread) => thread.root.kind)).toEqual([
        'removed',
        'removed',
      ]);
      expect(restored.threads.map((thread) => thread.root.kind)).toEqual([
        'shown',
        'shown',
      ]);
    });

    test('トップレベルと返信を1回の一括の読み取りで読む', async () => {
      await insertTopLevels(range(1, 11), (index) => after(index));
      await insertComment({
        index: 20,
        product: PRODUCT,
        launch: LAUNCH,
        author: COMMENTER,
        parent: { index: 11, root: 11 },
        depth: 2,
        columns: { createdAt: after(50) },
      });
      const recording = recordingDatabase();

      const page = await new D1CommentThreadQuery(recording.database).page({
        launchId: launchIdOf(LAUNCH),
        after: undefined,
      });

      expect(page.threads[0]?.replies).toHaveLength(1);
      expect(recording.batchSizes).toEqual([2]);
      expect(recording.preparedCount.value).toBe(2);
    });
  });
});
