import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { helpArticleSearchDocuments } from '../../../../db/schema/help/help-article-search-documents.ts';
import { HELP_ARTICLE_SEARCH_INDEX } from '../../../../db/schema/help/help-article-search-index.ts';
import { helpArticles } from '../../../../db/schema/help/help-articles.ts';
import type { IndexWrite } from '../../../core/search/ports.ts';
import {
  clearHelpTables,
  db,
  helpArticleIdOf,
  insertHelpArticle,
} from '../../help/testing/help-fixtures.ts';
import { D1SearchIndexRepository } from '../search-index-repository.ts';
import { createSearchTargetRegistry } from '../search-target-definition.ts';
import { HELP_ARTICLE_SEARCH_TARGET } from './help-articles.ts';
import { SEARCH_TARGETS } from './index.ts';

const PUBLISHED = 1;
const DRAFT = 2;
const MISSING = 99;

const STATUS_CHANGED_AT = new Date('2026-11-11T03:04:05.678Z');

const writeOf = (sourceVersion: number): IndexWrite => ({
  sourceVersion,
  texts: { title: 'はじめに', subtitle: '使い方' },
  keywords: { kind: 'set', value: 'ログイン' },
  keywordStatus: 'extracted',
  extractionInputHash: 'hash-1',
  statusChangedAt: STATUS_CHANGED_AT,
});

async function isIndexable(articleIndex: number): Promise<boolean> {
  const [row] = await db.all<{ indexable: number }>(
    sql`SELECT EXISTS (${HELP_ARTICLE_SEARCH_TARGET.isIndexable(helpArticleIdOf(articleIndex))}) AS indexable`,
  );
  return row?.indexable === 1;
}

async function readDocument(articleIndex: number) {
  const [row] = await db
    .select()
    .from(helpArticleSearchDocuments)
    .where(
      eq(helpArticleSearchDocuments.sourceId, helpArticleIdOf(articleIndex)),
    );
  return row;
}

beforeEach(async () => {
  await clearHelpTables();
  await insertHelpArticle(PUBLISHED, {
    title: 'はじめに',
    subtitle: '使い方',
    bodyMarkdown: '## ログイン\n\n**メール**で入る',
    revision: 3,
  });
  await insertHelpArticle(DRAFT, { status: 'draft', revision: 2 });
});

describe('HELP_ARTICLE_SEARCH_TARGET', () => {
  test('名前help-articleで、索引文書のテーブルhelp_article_search_documentsの索引の定義を使い、検索対象の集約点に登録される', () => {
    const registry = createSearchTargetRegistry(SEARCH_TARGETS);

    expect(HELP_ARTICLE_SEARCH_TARGET.name).toBe('help-article');
    expect(HELP_ARTICLE_SEARCH_TARGET.index).toBe(HELP_ARTICLE_SEARCH_INDEX);
    expect(HELP_ARTICLE_SEARCH_TARGET.documents).toBe(
      helpArticleSearchDocuments,
    );
    expect(registry.definition('help-article')).toBe(
      HELP_ARTICLE_SEARCH_TARGET,
    );
  });

  test('タイトル・サブタイトルは元テキストの列に保存して抽出に使わず、本文はマークダウンとして抽出だけに使う', () => {
    expect(HELP_ARTICLE_SEARCH_TARGET.fields).toEqual({
      title: { format: 'plain', textColumn: true, extract: false },
      subtitle: { format: 'plain', textColumn: true, extract: false },
      body: { format: 'markdown', textColumn: false, extract: true },
    });
  });

  describe('read', () => {
    test('公開の記事のタイトル・サブタイトル・本文の原文を、記事の版を版にして返す', async () => {
      const source = await HELP_ARTICLE_SEARCH_TARGET.read(
        db,
        helpArticleIdOf(PUBLISHED),
      );

      expect(source).toStrictEqual({
        version: 3,
        fields: {
          title: 'はじめに',
          subtitle: '使い方',
          body: '## ログイン\n\n**メール**で入る',
        },
      });
    });

    test.each([
      ['下書きの', DRAFT],
      ['存在しない', MISSING],
    ])('%s記事は読み取りが空になる', async (_label, articleIndex) => {
      const source = await HELP_ARTICLE_SEARCH_TARGET.read(
        db,
        helpArticleIdOf(articleIndex),
      );

      expect(source).toBeUndefined();
    });
  });

  describe('isIndexable', () => {
    test('公開の記事で真になる', async () => {
      expect(await isIndexable(PUBLISHED)).toBe(true);
    });

    test.each([
      ['下書きの', DRAFT],
      ['存在しない', MISSING],
    ])('%s記事で偽になる', async (_label, articleIndex) => {
      expect(await isIndexable(articleIndex)).toBe(false);
    });

    test('索引文書の条件付きの書き込みが、公開の記事だけを書き、下書きへ戻した後の書き込みを捨てる', async () => {
      const repository = new D1SearchIndexRepository(
        db,
        createSearchTargetRegistry([HELP_ARTICLE_SEARCH_TARGET]),
      );

      const published = await repository.upsert(
        'help-article',
        helpArticleIdOf(PUBLISHED),
        writeOf(3),
      );
      const draft = await repository.upsert(
        'help-article',
        helpArticleIdOf(DRAFT),
        writeOf(2),
      );
      await db
        .update(helpArticles)
        .set({ status: 'draft', revision: 4 })
        .where(eq(helpArticles.id, helpArticleIdOf(PUBLISHED)));
      const afterDraft = await repository.upsert(
        'help-article',
        helpArticleIdOf(PUBLISHED),
        writeOf(4),
      );

      expect([published, draft, afterDraft]).toEqual([
        'written',
        'skipped',
        'skipped',
      ]);
      expect(await readDocument(PUBLISHED)).toMatchObject({
        sourceVersion: 3,
        title: 'はじめに',
        subtitle: '使い方',
      });
      expect(await readDocument(DRAFT)).toBeUndefined();
    });
  });
});
