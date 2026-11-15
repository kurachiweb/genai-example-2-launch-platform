import { describe, expect, test } from 'bun:test';

import { SEARCH_INDEXES } from '../../search/search-indexes.ts';
import { HELP_ARTICLE_SEARCH_INDEX } from './help-article-search-index.ts';

describe('HELP_ARTICLE_SEARCH_INDEX', () => {
  test('索引文書のテーブルhelp_article_search_documentsと全文検索の索引help_article_search_documents_ftsを指す', () => {
    expect(HELP_ARTICLE_SEARCH_INDEX.documentsTableName).toBe(
      'help_article_search_documents',
    );
    expect(HELP_ARTICLE_SEARCH_INDEX.ftsTableName).toBe(
      'help_article_search_documents_fts',
    );
  });

  test('重みはタイトル10・サブタイトル5・キーワード1になる', () => {
    expect(HELP_ARTICLE_SEARCH_INDEX.textColumns).toEqual([
      { name: 'title', weight: 10 },
      { name: 'subtitle', weight: 5 },
    ]);
    expect(HELP_ARTICLE_SEARCH_INDEX.keywordsWeight).toBe(1);
  });

  test('前方一致の長さは既定の2と3になる', () => {
    expect(HELP_ARTICLE_SEARCH_INDEX.prefixLengths).toEqual([2, 3]);
  });

  test('索引の定義の集約点SEARCH_INDEXESに登録される', () => {
    expect(SEARCH_INDEXES).toContain(HELP_ARTICLE_SEARCH_INDEX);
  });
});
