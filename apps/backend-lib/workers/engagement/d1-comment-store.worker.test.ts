import { Container } from 'inversify';
import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { ENGAGEMENT_PLATFORM_TYPES } from '../../core/engagement/identifiers.ts';
import type {
  CommentRecord,
  CommentStore,
} from '../../core/engagement/ports.ts';
import { D1CommentStore } from './d1-comment-store.ts';
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
  productIdOf,
  T0,
  userIdOf,
} from './testing/engagement-fixtures.ts';

const store = new D1CommentStore(db);

beforeEach(async () => {
  await clearEngagementTables();
  await insertUser(1, { emailVerifiedAt: T0 });
  await insertUser(2, { emailVerifiedAt: T0, status: 'suspended' });
  await insertProduct(1, 1, { hiddenAt: after(9) });
  await insertLaunch(1, 1);
});

describe('D1CommentStore', () => {
  test('識別子でデータベースを注入して、コメントのストアとして取得できる', () => {
    const container = new Container();
    container.bind<Database>(PLATFORM_TYPES.Database).toConstantValue(db);
    container
      .bind<CommentStore>(ENGAGEMENT_PLATFORM_TYPES.CommentStore)
      .to(D1CommentStore);

    const resolved = container.get<CommentStore>(
      ENGAGEMENT_PLATFORM_TYPES.CommentStore,
    );

    expect(resolved).toBeInstanceOf(D1CommentStore);
    expectTypeOf(resolved).toEqualTypeOf<CommentStore>();
  });

  describe('findByIds', () => {
    beforeEach(async () => {
      await insertComment({
        index: 1,
        product: 1,
        launch: 1,
        author: 1,
        columns: { body: '**原文**', createdAt: after(1), editedAt: after(5) },
      });
      await insertComment({
        index: 2,
        product: 1,
        launch: 1,
        author: 2,
        parent: { index: 1, root: 1 },
        depth: 2,
        columns: {
          createdAt: after(2),
          deletedAt: after(6),
          hiddenAt: after(7),
        },
      });
      await insertComment({
        index: 3,
        product: 1,
        launch: 1,
        author: null,
        parent: { index: 2, root: 1 },
        depth: 3,
        columns: {
          body: '',
          createdAt: after(3),
          deletedAt: after(6),
          anonymizedAt: after(8),
        },
      });
    });

    test('状態の印・投稿者・プロダクト・ローンチ・階層を、閲覧の可否によらず返す', async () => {
      const records = await store.findByIds([
        commentIdOf(1),
        commentIdOf(2),
        commentIdOf(3),
      ]);

      expect(records).toEqual(
        new Map<string, CommentRecord>([
          [
            commentIdOf(1),
            {
              commentId: commentIdOf(1),
              productId: productIdOf(1),
              launchId: launchIdOf(1),
              parentId: null,
              rootId: commentIdOf(1),
              depth: 1,
              authorUserId: userIdOf(1),
              bodyMarkdown: '**原文**',
              createdAt: after(1),
              editedAt: after(5),
              deletedAt: null,
              hiddenAt: null,
              anonymizedAt: null,
            },
          ],
          [
            commentIdOf(2),
            {
              commentId: commentIdOf(2),
              productId: productIdOf(1),
              launchId: launchIdOf(1),
              parentId: commentIdOf(1),
              rootId: commentIdOf(1),
              depth: 2,
              authorUserId: userIdOf(2),
              bodyMarkdown: 'コメント2',
              createdAt: after(2),
              editedAt: null,
              deletedAt: after(6),
              hiddenAt: after(7),
              anonymizedAt: null,
            },
          ],
          [
            commentIdOf(3),
            {
              commentId: commentIdOf(3),
              productId: productIdOf(1),
              launchId: launchIdOf(1),
              parentId: commentIdOf(2),
              rootId: commentIdOf(1),
              depth: 3,
              authorUserId: null,
              bodyMarkdown: '',
              createdAt: after(3),
              editedAt: null,
              deletedAt: after(6),
              hiddenAt: null,
              anonymizedAt: after(8),
            },
          ],
        ]),
      );
    });

    test('存在しない識別子を除き、重複した識別子は1件にまとめる', async () => {
      const records = await store.findByIds([
        commentIdOf(1),
        commentIdOf(1),
        commentIdOf(404),
      ]);

      expect([...records.keys()]).toEqual([commentIdOf(1)]);
    });

    test('空の識別子の一覧には空を返す', async () => {
      expect(await store.findByIds([])).toEqual(new Map());
    });
  });

  test('91件以上の識別子でも90件ずつ読んで全件を返す', async () => {
    const indexes = Array.from({ length: 95 }, (_, offset) => offset + 10);
    for (const index of indexes) {
      await insertComment({ index, product: 1, launch: 1, author: 1 });
    }

    const records = await store.findByIds(indexes.map(commentIdOf));

    expect(records.size).toBe(indexes.length);
  });
});
