import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { HELP_ARTICLE_UPDATE_ACTION } from '../../../common-lib/admin/audit-actions/help-center.ts';
import {
  HELP_CATEGORY_OTHER_ID,
  HELP_CATEGORY_OTHER_NAME,
} from '../../../common-lib/help/help-category-constants.ts';
import { createDatabase } from '../../../db/client.ts';
import { helpArticles } from '../../../db/schema/help/help-articles.ts';
import { resolveHandle } from '../../../lib/workers/handles/handle-queries.ts';
import { HELP_ARTICLE_HANDLE_NAMESPACE } from '../../../lib/workers/help/help-article-handle-namespace.ts';
import {
  db,
  HELP_AUTHOR_ADMIN_ID,
  helpArticleIdOf,
  helpCategoryIdOf,
  insertHelpArticle,
  insertHelpArticlePreviousHandle,
  insertHelpCategory,
  T0,
} from '../../../lib/workers/help/testing/help-fixtures.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import {
  AUDIT_LOG_ID,
  createArticleStore,
  expectSingleWriteBatch,
  insertExtractedIndexDocument,
  NOW,
  OTHER_AUDIT_LOG_ID,
  readAuditLogs,
  readHelpArticleState,
  readIndexDocuments,
  readPreviousHandles,
  resetHelpArticleTables,
  savedRecordOf,
  updateInputOf,
} from './testing/help-article-store-fixtures.ts';

async function readRevision(articleIndex: number): Promise<number | undefined> {
  const [row] = await db
    .select({ revision: helpArticles.revision })
    .from(helpArticles)
    .where(eq(helpArticles.id, helpArticleIdOf(articleIndex)));
  return row?.revision;
}

beforeEach(async () => {
  await resetHelpArticleTables();
});

describe('D1HelpArticleStore.update', () => {
  test('記事・索引・監査ログを1つの一括の書き込みで確定させ、版を1増やし作成者と作成日時を変えずに更新日時を保存時刻にする', async () => {
    await insertHelpArticle(1, { revision: 4 });
    await insertExtractedIndexDocument(1);
    const recording = createBatchRecordingD1(env.DB);
    const store = createArticleStore(createDatabase(recording.d1));

    const result = await store.update(
      updateInputOf(1, { title: '新しい題名' }, { expectedRevision: 4 }),
    );

    expect(result).toEqual({
      kind: 'saved',
      record: {
        id: helpArticleIdOf(1),
        handle: 'article1',
        previousHandle: null,
        title: '新しい題名',
        subtitle: '最初に読む記事',
        bodyMarkdown: '## 見出し\n\n本文',
        categoryId: HELP_CATEGORY_OTHER_ID,
        categoryName: HELP_CATEGORY_OTHER_NAME,
        pinned: false,
        status: 'published',
        createdByAdminId: HELP_AUTHOR_ADMIN_ID,
        sortOrder: 1,
        revision: 5,
        createdAt: T0,
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
        action: HELP_ARTICLE_UPDATE_ACTION.name,
        targetIds: [helpArticleIdOf(1)],
      },
    ]);
    expectSingleWriteBatch(recording, [
      'help_articles',
      'help_article_search_documents',
    ]);
  });

  test('下書きへの変更は同じ一括の書き込みで記事の索引文書だけを消す', async () => {
    await insertHelpArticle(1);
    await insertHelpArticle(2);
    await insertExtractedIndexDocument(1);
    await insertExtractedIndexDocument(2);

    const result = await createArticleStore().update(
      updateInputOf(1, { status: 'draft' }),
    );

    expect(savedRecordOf(result)).toEqual(
      expect.objectContaining({ status: 'draft', revision: 2 }),
    );
    await expect(readIndexDocuments()).resolves.toEqual([
      expect.objectContaining({ sourceId: helpArticleIdOf(2) }),
    ]);
  });

  test('記事が無ければnot-foundを返し、監査ログを含めてどの行も変えない', async () => {
    await insertHelpArticle(2);
    const before = await readHelpArticleState();

    const result = await createArticleStore().update(updateInputOf(1));

    expect(result).toEqual({ kind: 'not-found' });
    await expect(readHelpArticleState()).resolves.toEqual(before);
  });

  test('版が違えばconflictを返し、索引文書を含めてどの行も変えない', async () => {
    await insertHelpArticle(1, { revision: 2 });
    await insertExtractedIndexDocument(1);
    const before = await readHelpArticleState();

    const result = await createArticleStore().update(
      updateInputOf(1, { status: 'draft' }, { expectedRevision: 1 }),
    );

    expect(result).toEqual({ kind: 'conflict' });
    await expect(readHelpArticleState()).resolves.toEqual(before);
  });

  test('カテゴリが無ければcategory-missingを返し、どの行も変えない', async () => {
    await insertHelpArticle(1);
    const before = await readHelpArticleState();

    const result = await createArticleStore().update(
      updateInputOf(
        1,
        { categoryId: helpCategoryIdOf(9) },
        { categoryChanged: true },
      ),
    );

    expect(result).toEqual({ kind: 'category-missing' });
    await expect(readHelpArticleState()).resolves.toEqual(before);
  });

  test('下書きを含む他の記事の現在のハンドルへの変更はhandle-unavailableを返し、どの行も変えない', async () => {
    await insertHelpArticle(1);
    await insertHelpArticle(2, { handle: 'Taken', status: 'draft' });
    const before = await readHelpArticleState();

    const result = await createArticleStore().update(
      updateInputOf(1, { handle: 'taken' }),
    );

    expect(result).toEqual({ kind: 'handle-unavailable' });
    await expect(readHelpArticleState()).resolves.toEqual(before);
  });

  test('カテゴリの変更は移動先のカテゴリの下書きを含む記事の並び順の末尾に置く', async () => {
    await insertHelpCategory(1);
    await insertHelpArticle(1, { sortOrder: 1 });
    await insertHelpArticle(2, {
      categoryId: helpCategoryIdOf(1),
      sortOrder: 5,
      status: 'draft',
    });

    const result = await createArticleStore().update(
      updateInputOf(
        1,
        { categoryId: helpCategoryIdOf(1) },
        { categoryChanged: true },
      ),
    );

    expect(savedRecordOf(result)).toEqual(
      expect.objectContaining({
        categoryId: helpCategoryIdOf(1),
        categoryName: 'カテゴリ1',
        sortOrder: 6,
      }),
    );
  });

  test('ピン留めの切り替えでは並び順を変えない', async () => {
    await insertHelpArticle(1, { sortOrder: 3 });
    await insertHelpArticle(2, { sortOrder: 9 });

    const result = await createArticleStore().update(
      updateInputOf(1, { pinned: true }),
    );

    expect(savedRecordOf(result)).toEqual(
      expect.objectContaining({ pinned: true, sortOrder: 3 }),
    );
  });

  test('別の文字列への変更は、保持していた旧ハンドルを変更前のハンドルで1行のまま置き換える', async () => {
    await insertHelpArticle(1, { handle: 'second' });
    await insertHelpArticlePreviousHandle(1, 'first');

    const result = await createArticleStore().update(
      updateInputOf(1, { handle: 'third' }, { currentHandle: 'second' }),
    );

    expect(savedRecordOf(result)).toEqual(
      expect.objectContaining({
        handle: 'third',
        previousHandle: 'second',
      }),
    );
    await expect(readPreviousHandles()).resolves.toEqual([
      { ownerId: helpArticleIdOf(1), handle: 'second' },
    ]);
  });

  test('大文字小文字だけの変更は表記を更新し、旧ハンドルを変えない', async () => {
    await insertHelpArticle(1, { handle: 'guide' });
    await insertHelpArticlePreviousHandle(1, 'first');

    const result = await createArticleStore().update(
      updateInputOf(1, { handle: 'Guide' }, { currentHandle: 'guide' }),
    );

    expect(savedRecordOf(result)).toEqual(
      expect.objectContaining({
        handle: 'Guide',
        previousHandle: 'first',
      }),
    );
    await expect(readPreviousHandles()).resolves.toEqual([
      { ownerId: helpArticleIdOf(1), handle: 'first' },
    ]);
  });

  test('記事自身の旧ハンドルへ戻すと、変更前のハンドルを新しい旧ハンドルにする', async () => {
    await insertHelpArticle(1, { handle: 'second' });
    await insertHelpArticlePreviousHandle(1, 'first');

    const result = await createArticleStore().update(
      updateInputOf(1, { handle: 'FIRST' }, { currentHandle: 'second' }),
    );

    expect(result.kind).toBe('saved');
    await expect(readPreviousHandles()).resolves.toEqual([
      { ownerId: helpArticleIdOf(1), handle: 'second' },
    ]);
  });

  test('他の記事の旧ハンドルへの変更は、同じ一括の書き込みでその旧ハンドルを解放して保存した記事に解決させる', async () => {
    await insertHelpArticle(1, { handle: 'renamed' });
    await insertHelpArticlePreviousHandle(1, 'wanted');
    await insertHelpArticle(2);

    const result = await createArticleStore().update(
      updateInputOf(2, { handle: 'Wanted' }),
    );

    expect(result.kind).toBe('saved');
    await expect(readPreviousHandles()).resolves.toEqual([
      { ownerId: helpArticleIdOf(2), handle: 'article2' },
    ]);
    await expect(
      resolveHandle(db, HELP_ARTICLE_HANDLE_NAMESPACE, 'wanted'),
    ).resolves.toEqual({
      kind: 'current',
      ownerId: helpArticleIdOf(2),
      handle: 'Wanted',
    });
  });

  test('保存が取り消されれば、他の記事の旧ハンドルは解放されずに残る', async () => {
    await insertHelpArticle(1, { handle: 'renamed' });
    await insertHelpArticlePreviousHandle(1, 'wanted');
    await insertHelpArticle(2, { revision: 3 });
    const before = await readHelpArticleState();

    const result = await createArticleStore().update(
      updateInputOf(2, { handle: 'wanted' }, { expectedRevision: 2 }),
    );

    expect(result).toEqual({ kind: 'conflict' });
    await expect(readHelpArticleState()).resolves.toEqual(before);
    await expect(
      resolveHandle(db, HELP_ARTICLE_HANDLE_NAMESPACE, 'wanted'),
    ).resolves.toEqual({ kind: 'previous', ownerId: helpArticleIdOf(1) });
  });

  test('同じ旧ハンドルを2つの保存が同時に取りにいくと一方だけが確定し、その旧ハンドルの行が残らない', async () => {
    await insertHelpArticle(1, { handle: 'renamed' });
    await insertHelpArticlePreviousHandle(1, 'wanted');
    await insertHelpArticle(2);
    await insertHelpArticle(3);
    const store = createArticleStore();

    const results = await Promise.all([
      store.update(updateInputOf(2, { handle: 'wanted' })),
      store.update(
        updateInputOf(
          3,
          { handle: 'WANTED' },
          { auditLogId: OTHER_AUDIT_LOG_ID },
        ),
      ),
    ]);

    expect(results.map((result) => result.kind).toSorted()).toEqual([
      'handle-unavailable',
      'saved',
    ]);
    const previous = await readPreviousHandles();
    expect(previous.map((row) => row.handle.toLowerCase())).not.toContain(
      'wanted',
    );
    expect(previous).toHaveLength(1);
    await expect(readAuditLogs()).resolves.toHaveLength(1);
  });

  test('下書きの記事が他の記事の旧ハンドルを取った後は、その文字列をどの記事にも解決しない', async () => {
    await insertHelpArticle(1, { handle: 'renamed' });
    await insertHelpArticlePreviousHandle(1, 'wanted');
    await insertHelpArticle(2, { status: 'draft' });

    const result = await createArticleStore().update(
      updateInputOf(2, { handle: 'wanted', status: 'draft' }),
    );

    expect(result.kind).toBe('saved');
    await expect(
      resolveHandle(db, HELP_ARTICLE_HANDLE_NAMESPACE, 'wanted'),
    ).resolves.toEqual({ kind: 'none' });
  });

  test('同じ記事の同時の2つの保存は一方がconflictになる', async () => {
    await insertHelpArticle(1);
    const store = createArticleStore();

    const results = await Promise.all([
      store.update(updateInputOf(1, { title: '一方' })),
      store.update(
        updateInputOf(1, { title: '他方' }, { auditLogId: OTHER_AUDIT_LOG_ID }),
      ),
    ]);

    expect(results.map((result) => result.kind).toSorted()).toEqual([
      'conflict',
      'saved',
    ]);
    await expect(readRevision(1)).resolves.toBe(2);
  });
});
