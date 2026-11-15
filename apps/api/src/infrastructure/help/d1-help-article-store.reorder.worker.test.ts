import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { HELP_ARTICLE_REORDER_ACTION } from '../../../common-lib/admin/audit-actions/help-center.ts';
import { HELP_CATEGORY_OTHER_ID } from '../../../common-lib/help/help-category-constants.ts';
import { createDatabase } from '../../../db/client.ts';
import { helpArticles } from '../../../db/schema/help/help-articles.ts';
import {
  db,
  helpArticleIdOf,
  helpCategoryIdOf,
  insertHelpArticle,
  insertHelpCategory,
  T0,
} from '../../../lib/workers/help/testing/help-fixtures.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import { buildAuditLogStatements } from '../admin/audit-log-statements.ts';
import {
  AUDIT_LOG_ID,
  createArticleStore,
  createInputOf,
  expectSingleWriteBatch,
  insertExtractedIndexDocument,
  readArticles,
  readAuditLogs,
  readHelpArticleState,
  reorderInputOf,
  resetHelpArticleTables,
} from './testing/help-article-store-fixtures.ts';

const CATEGORY_ID = helpCategoryIdOf(1);

const UPDATED_AT = new Date(T0.getTime() + 60_000);

const idsOf = (...indexes: readonly number[]): readonly string[] =>
  indexes.map((index) => helpArticleIdOf(index));

// カテゴリ1に記事1〜4(ピン留めは1・3、下書きは1・4)、標準カテゴリに記事5を置く。更新日時と版は作成時と違う値にする
async function seedArticles(): Promise<void> {
  await insertHelpCategory(1);
  const seeds = [
    [1, { pinned: true, status: 'draft' }],
    [2, { pinned: false, status: 'published' }],
    [3, { pinned: true, status: 'published' }],
    [4, { pinned: false, status: 'draft' }],
  ] as const;
  for (const [index, columns] of seeds) {
    await insertHelpArticle(index, {
      ...columns,
      categoryId: CATEGORY_ID,
      revision: index + 1,
      updatedAt: UPDATED_AT,
    });
  }
  await insertHelpArticle(5, { sortOrder: 1 });
  await insertExtractedIndexDocument(2);
}

beforeEach(async () => {
  await resetHelpArticleTables();
  await seedArticles();
});

describe('D1HelpArticleStore.reorder', () => {
  test('カテゴリの下書きを含む全記事を指定の順に並べ、更新日時と版を変えず、監査ログと同じ一括の書き込みで確定させる', async () => {
    const before = await readHelpArticleState();
    const orderedIds = idsOf(3, 1, 4, 2);
    const recording = createBatchRecordingD1(env.DB);
    const store = createArticleStore(createDatabase(recording.d1));

    const result = await store.reorder(reorderInputOf(CATEGORY_ID, orderedIds));

    expect(result).toBe('reordered');
    const sortOrders = new Map(orderedIds.map((id, index) => [id, index + 1]));
    expect(await readArticles()).toEqual(
      before.articles.map((row) => ({
        ...row,
        sortOrder: sortOrders.get(row.id) ?? row.sortOrder,
      })),
    );
    const after = await readHelpArticleState();
    expect(after.previous).toEqual(before.previous);
    expect(after.documents).toEqual(before.documents);
    expect(after.audits).toEqual([
      {
        id: AUDIT_LOG_ID,
        action: HELP_ARTICLE_REORDER_ACTION.name,
        targetIds: [CATEGORY_ID],
      },
    ]);
    expect(recording.batches).toHaveLength(1);
    expectSingleWriteBatch(recording, ['help_articles']);
  });

  test('ピン留めの群に続けてそれ以外の群を送ると、並び順の値が群をまたいで1から連番になる', async () => {
    await createArticleStore().reorder(
      reorderInputOf(CATEGORY_ID, idsOf(1, 3, 2, 4)),
    );

    const rows = await db
      .select({ id: helpArticles.id, sortOrder: helpArticles.sortOrder })
      .from(helpArticles)
      .where(eq(helpArticles.categoryId, CATEGORY_ID));
    expect(new Map(rows.map((row) => [row.id, row.sortOrder]))).toEqual(
      new Map([
        [helpArticleIdOf(1), 1],
        [helpArticleIdOf(3), 2],
        [helpArticleIdOf(2), 3],
        [helpArticleIdOf(4), 4],
      ]),
    );
  });

  describe('対象の集合の違い', () => {
    test.each([
      [
        '並べ替えを始めた後に追加された記事を含まない',
        async () => {
          await insertHelpArticle(6, { categoryId: CATEGORY_ID });
        },
        idsOf(3, 1, 4, 2),
      ],
      [
        '並べ替えを始めた後に削除された記事を含む',
        async () => {
          await db
            .delete(helpArticles)
            .where(eq(helpArticles.id, helpArticleIdOf(4)));
        },
        idsOf(3, 1, 4, 2),
      ],
      [
        '並べ替えを始めた後に他のカテゴリへ移動した記事を含む',
        async () => {
          await db
            .update(helpArticles)
            .set({ categoryId: HELP_CATEGORY_OTHER_ID })
            .where(eq(helpArticles.id, helpArticleIdOf(4)));
        },
        idsOf(3, 1, 4, 2),
      ],
      [
        '並べ替えを始めた後に他のカテゴリから移動してきた記事を含まない',
        async () => {
          await db
            .update(helpArticles)
            .set({ categoryId: CATEGORY_ID })
            .where(eq(helpArticles.id, helpArticleIdOf(5)));
        },
        idsOf(3, 1, 4, 2),
      ],
      ['他のカテゴリの記事を含む', async () => {}, idsOf(3, 1, 5, 2)],
      ['同じ記事を重ねて含む', async () => {}, idsOf(3, 1, 1, 2)],
    ])(
      '渡したIDが%sとoutdatedを返し、監査ログを含めてどの行も変えない',
      async (_name, change, orderedIds) => {
        await change();
        const before = await readHelpArticleState();

        const result = await createArticleStore().reorder(
          reorderInputOf(CATEGORY_ID, orderedIds),
        );

        expect(result).toBe('outdated');
        await expect(readHelpArticleState()).resolves.toEqual(before);
      },
    );

    test('並べ替えを始めた後にカテゴリが削除されていればoutdatedを返し、監査ログを残さない', async () => {
      const before = await readHelpArticleState();

      const result = await createArticleStore().reorder(
        reorderInputOf(helpCategoryIdOf(9), []),
      );

      expect(result).toBe('outdated');
      await expect(readHelpArticleState()).resolves.toEqual(before);
    });
  });

  test('監査ログの記録が失敗すると、結果を分類せずに投げ、並び順も変えない', async () => {
    await db.batch([...buildAuditLogStatements(db, createInputOf(9).audit)]);
    const before = await readHelpArticleState();

    await expect(
      createArticleStore().reorder(
        reorderInputOf(CATEGORY_ID, idsOf(3, 1, 4, 2)),
      ),
    ).rejects.toThrow(/UNIQUE constraint failed: admin_audit_logs\.id/u);

    await expect(readHelpArticleState()).resolves.toEqual(before);
  });

  test('監査ログの後の並び順の更新が失敗すると、結果を分類せずに投げ、監査ログも残さない', async () => {
    const before = await readHelpArticleState();
    await env.DB.exec(
      `CREATE TRIGGER help_articles_reorder_failure BEFORE UPDATE ON help_articles BEGIN SELECT RAISE(ABORT, 'injected failure'); END`,
    );

    try {
      await expect(
        createArticleStore().reorder(
          reorderInputOf(CATEGORY_ID, idsOf(3, 1, 4, 2)),
        ),
      ).rejects.toThrow(/injected failure/u);
    } finally {
      await env.DB.exec('DROP TRIGGER help_articles_reorder_failure');
    }

    await expect(readHelpArticleState()).resolves.toEqual(before);
    await expect(readAuditLogs()).resolves.toEqual([]);
  });
});
