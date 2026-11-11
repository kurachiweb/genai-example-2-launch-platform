import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  HELP_ARTICLE_CREATE_ACTION,
  HELP_ARTICLE_DELETE_ACTION,
} from '../../../common-lib/admin/audit-actions/help-center.ts';
import { HELP_CATEGORY_OTHER_NAME } from '../../../common-lib/help/help-category-constants.ts';
import { createDatabase } from '../../../db/client.ts';
import { resolveHandle } from '../../../lib/workers/handles/handle-queries.ts';
import { HELP_ARTICLE_HANDLE_NAMESPACE } from '../../../lib/workers/help/help-article-handle-namespace.ts';
import {
  db,
  helpArticleIdOf,
  helpCategoryIdOf,
  insertHelpArticle,
  insertHelpArticlePreviousHandle,
  insertHelpCategory,
} from '../../../lib/workers/help/testing/help-fixtures.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import { buildAuditLogStatements } from '../admin/audit-log-statements.ts';
import {
  AUDIT_LOG_ID,
  createArticleStore,
  createInputOf,
  deleteInputOf,
  EDITOR_ADMIN_ID,
  expectSingleWriteBatch,
  insertExtractedIndexDocument,
  NOW,
  OTHER_AUDIT_LOG_ID,
  readArticles,
  readAuditLogs,
  readHelpArticleState,
  readIndexDocuments,
  readPreviousHandles,
  resetHelpArticleTables,
  savedRecordOf,
  THIRD_AUDIT_LOG_ID,
  updateInputOf,
} from './testing/help-article-store-fixtures.ts';

beforeEach(async () => {
  await resetHelpArticleTables();
});

describe('D1HelpArticleStore', () => {
  describe('isHandleOccupied', () => {
    test('下書きを含む他の記事の現在のハンドルだけを大文字小文字を区別せずに数え、旧ハンドルは数えない', async () => {
      await insertHelpArticle(1, { handle: 'Guide', status: 'draft' });
      await insertHelpArticlePreviousHandle(1, 'old-guide');
      const store = createArticleStore();

      await expect(store.isHandleOccupied('guide')).resolves.toBe(true);
      await expect(
        store.isHandleOccupied('GUIDE', helpArticleIdOf(1)),
      ).resolves.toBe(false);
      await expect(store.isHandleOccupied('old-guide')).resolves.toBe(false);
    });
  });

  describe('create', () => {
    test('記事・索引の更新待ち・監査ログを1つの一括の書き込みで確定させ、保存した記事を返す', async () => {
      await insertHelpCategory(1, { name: '使い方' });
      const recording = createBatchRecordingD1(env.DB);
      const store = createArticleStore(createDatabase(recording.d1));

      const result = await store.create(
        createInputOf(1, { categoryId: helpCategoryIdOf(1), pinned: true }),
      );

      expect(result).toEqual({
        kind: 'saved',
        record: {
          id: helpArticleIdOf(1),
          handle: 'getting-started',
          previousHandle: null,
          title: 'はじめに',
          subtitle: '最初に読む記事',
          bodyMarkdown: '## 見出し\n\n本文',
          categoryId: helpCategoryIdOf(1),
          categoryName: '使い方',
          pinned: true,
          status: 'published',
          createdByAdminId: EDITOR_ADMIN_ID,
          sortOrder: 1,
          revision: 1,
          createdAt: NOW,
          updatedAt: NOW,
        },
      });
      await expect(readIndexDocuments()).resolves.toEqual([
        {
          sourceId: helpArticleIdOf(1),
          keywordStatus: 'pending',
          statusChangedAt: NOW,
        },
      ]);
      await expect(readAuditLogs()).resolves.toEqual([
        {
          id: AUDIT_LOG_ID,
          action: HELP_ARTICLE_CREATE_ACTION.name,
          targetIds: [helpArticleIdOf(1)],
        },
      ]);
      expectSingleWriteBatch(recording, [
        'help_articles',
        'help_article_previous_handles',
        'help_article_search_documents',
      ]);
    });

    test('下書きは索引文書を作らない', async () => {
      const result = await createArticleStore().create(
        createInputOf(1, { status: 'draft' }),
      );

      expect(result.kind).toBe('saved');
      await expect(readIndexDocuments()).resolves.toEqual([]);
    });

    test('ピン留めを問わず、保存先のカテゴリの下書きを含む記事の並び順の末尾に置く', async () => {
      await insertHelpCategory(1);
      await insertHelpArticle(1, { sortOrder: 3, status: 'draft' });
      await insertHelpArticle(2, {
        categoryId: helpCategoryIdOf(1),
        sortOrder: 7,
      });

      const result = await createArticleStore().create(
        createInputOf(3, { pinned: true }),
      );

      expect(savedRecordOf(result)).toEqual(
        expect.objectContaining({
          categoryName: HELP_CATEGORY_OTHER_NAME,
          sortOrder: 4,
        }),
      );
    });

    test('カテゴリが無ければcategory-missingを返し、他の記事の旧ハンドルを含めてどの行も変えない', async () => {
      await insertHelpArticle(1);
      await insertHelpArticlePreviousHandle(1, 'getting-started');
      const before = await readHelpArticleState();

      const result = await createArticleStore().create(
        createInputOf(2, { categoryId: helpCategoryIdOf(9) }),
      );

      expect(result).toEqual({ kind: 'category-missing' });
      await expect(readHelpArticleState()).resolves.toEqual(before);
    });

    test('下書きを含む他の記事の現在のハンドルと大文字小文字を区別せずに一致すればhandle-unavailableを返し、どの行も変えない', async () => {
      await insertHelpArticle(1, {
        handle: 'Getting-Started',
        status: 'draft',
      });
      const before = await readHelpArticleState();

      const result = await createArticleStore().create(createInputOf(2));

      expect(result).toEqual({ kind: 'handle-unavailable' });
      await expect(readHelpArticleState()).resolves.toEqual(before);
    });

    test('同じハンドルの同時の2つの作成は一方だけが成功する', async () => {
      const store = createArticleStore();

      const results = await Promise.all([
        store.create(createInputOf(1, { handle: 'popular' })),
        store.create(
          createInputOf(2, { handle: 'POPULAR' }, OTHER_AUDIT_LOG_ID),
        ),
      ]);

      expect(results.map((result) => result.kind).toSorted()).toEqual([
        'handle-unavailable',
        'saved',
      ]);
      await expect(readArticles()).resolves.toHaveLength(1);
      await expect(readAuditLogs()).resolves.toHaveLength(1);
    });

    test('他の記事の旧ハンドルと同じハンドルで作成すると、その旧ハンドルを解放して新しい記事に解決させる', async () => {
      await insertHelpArticle(1, { handle: 'renamed' });
      await insertHelpArticlePreviousHandle(1, 'Getting-Started');

      const result = await createArticleStore().create(createInputOf(2));

      expect(result.kind).toBe('saved');
      await expect(readPreviousHandles()).resolves.toEqual([]);
      await expect(
        resolveHandle(db, HELP_ARTICLE_HANDLE_NAMESPACE, 'getting-started'),
      ).resolves.toEqual({
        kind: 'current',
        ownerId: helpArticleIdOf(2),
        handle: 'getting-started',
      });
    });

    test('下書きの記事が他の記事の旧ハンドルを取った後は、その文字列をどの記事にも解決しない', async () => {
      await insertHelpArticle(1, { handle: 'renamed' });
      await insertHelpArticlePreviousHandle(1, 'getting-started');

      const result = await createArticleStore().create(
        createInputOf(2, { status: 'draft' }),
      );

      expect(result.kind).toBe('saved');
      await expect(
        resolveHandle(db, HELP_ARTICLE_HANDLE_NAMESPACE, 'getting-started'),
      ).resolves.toEqual({ kind: 'none' });
    });
  });

  describe('delete', () => {
    test('索引文書・旧ハンドル・記事を消し、監査ログと同じ一括の書き込みで確定させる', async () => {
      await insertHelpArticle(1, { handle: 'current' });
      await insertHelpArticlePreviousHandle(1, 'old');
      await insertExtractedIndexDocument(1);
      await insertHelpArticle(2);
      await insertExtractedIndexDocument(2);
      const recording = createBatchRecordingD1(env.DB);
      const store = createArticleStore(createDatabase(recording.d1));

      const result = await store.delete(deleteInputOf(1));

      expect(result).toBe('deleted');
      const after = await readHelpArticleState();
      expect(after.articles.map((row) => row.id)).toEqual([helpArticleIdOf(2)]);
      expect(after.previous).toEqual([]);
      expect(after.documents.map((row) => row.sourceId)).toEqual([
        helpArticleIdOf(2),
      ]);
      expect(after.audits).toEqual([
        {
          id: AUDIT_LOG_ID,
          action: HELP_ARTICLE_DELETE_ACTION.name,
          targetIds: [helpArticleIdOf(1)],
        },
      ]);
      expectSingleWriteBatch(recording, [
        'help_articles',
        'help_article_previous_handles',
        'help_article_search_documents',
      ]);
    });

    test('削除の後は両方のハンドルを解決せず、他の記事が両方を使える', async () => {
      await insertHelpArticle(1, { handle: 'current' });
      await insertHelpArticlePreviousHandle(1, 'old');
      const store = createArticleStore();
      await store.delete(deleteInputOf(1));

      await expect(
        resolveHandle(db, HELP_ARTICLE_HANDLE_NAMESPACE, 'old'),
      ).resolves.toEqual({ kind: 'none' });
      await expect(
        store.create(
          createInputOf(2, { handle: 'current' }, OTHER_AUDIT_LOG_ID),
        ),
      ).resolves.toEqual(expect.objectContaining({ kind: 'saved' }));
      await expect(
        store.create(createInputOf(3, { handle: 'old' }, THIRD_AUDIT_LOG_ID)),
      ).resolves.toEqual(expect.objectContaining({ kind: 'saved' }));
    });

    test('記事が無ければnot-foundを返し、監査ログを含めてどの行も変えない', async () => {
      await insertHelpArticle(2);
      const before = await readHelpArticleState();

      const result = await createArticleStore().delete(deleteInputOf(1));

      expect(result).toBe('not-found');
      await expect(readHelpArticleState()).resolves.toEqual(before);
    });
  });

  describe('分類の対象ではない失敗', () => {
    // 作成・更新・削除のいずれも成功できる状態にし、旧ハンドルの解放と置き換え・索引文書の書き込みを一括の書き込みに含ませる
    async function seedWritableArticles(): Promise<void> {
      await insertHelpArticle(1);
      await insertHelpArticlePreviousHandle(1, 'first');
      await insertExtractedIndexDocument(1);
      await insertHelpArticle(2, { handle: 'renamed' });
      await insertHelpArticlePreviousHandle(2, 'getting-started');
    }

    const operations = [
      ['作成', () => createArticleStore().create(createInputOf(3))],
      [
        'ハンドルの変更を含む更新',
        () =>
          createArticleStore().update(
            updateInputOf(1, { handle: 'getting-started' }),
          ),
      ],
      ['削除', () => createArticleStore().delete(deleteInputOf(1))],
    ] as const;

    const INDEX_FAILURE_TRIGGERS = [
      'help_article_search_documents_insert_failure BEFORE INSERT',
      'help_article_search_documents_update_failure BEFORE UPDATE',
      'help_article_search_documents_delete_failure BEFORE DELETE',
    ] as const;

    test.each(operations)(
      '%sの一括の書き込みの末尾の索引文書の書き込みが失敗すると、結果を分類せずに投げ、監査ログを含めてどの行も変えない',
      async (_name, operate) => {
        await seedWritableArticles();
        const before = await readHelpArticleState();
        for (const trigger of INDEX_FAILURE_TRIGGERS) {
          await env.DB.exec(
            `CREATE TRIGGER ${trigger} ON help_article_search_documents BEGIN SELECT RAISE(ABORT, 'injected failure'); END`,
          );
        }

        try {
          await expect(operate()).rejects.toThrow(/injected failure/u);
        } finally {
          for (const trigger of INDEX_FAILURE_TRIGGERS) {
            await env.DB.exec(`DROP TRIGGER ${trigger.split(' ')[0] ?? ''}`);
          }
        }

        await expect(readHelpArticleState()).resolves.toEqual(before);
      },
    );

    test.each(operations)(
      '%sの監査ログの記録が失敗すると、結果を分類せずに投げ、操作も反映しない',
      async (_name, operate) => {
        await seedWritableArticles();
        await db.batch([
          ...buildAuditLogStatements(db, createInputOf(9).audit),
        ]);
        const before = await readHelpArticleState();

        await expect(operate()).rejects.toThrow(
          /UNIQUE constraint failed: admin_audit_logs\.id/u,
        );

        await expect(readHelpArticleState()).resolves.toEqual(before);
      },
    );
  });
});
