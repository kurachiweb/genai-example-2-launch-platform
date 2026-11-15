import { describe, expect, test } from 'bun:test';

import { SEARCH_INDEXES } from '../../search/search-indexes.ts';
import { PRODUCT_SEARCH_INDEX } from './product-search-index.ts';

describe('PRODUCT_SEARCH_INDEX', () => {
  test('索引文書のテーブルproduct_search_documentsと全文検索の索引product_search_documents_ftsを指す', () => {
    expect(PRODUCT_SEARCH_INDEX.documentsTableName).toBe(
      'product_search_documents',
    );
    expect(PRODUCT_SEARCH_INDEX.ftsTableName).toBe(
      'product_search_documents_fts',
    );
  });

  test('重みは名称10・タグライン5・キーワード1になる', () => {
    expect(PRODUCT_SEARCH_INDEX.textColumns).toEqual([
      { name: 'name', weight: 10 },
      { name: 'tagline', weight: 5 },
    ]);
    expect(PRODUCT_SEARCH_INDEX.keywordsWeight).toBe(1);
  });

  test('前方一致の長さは既定の2と3になる', () => {
    expect(PRODUCT_SEARCH_INDEX.prefixLengths).toEqual([2, 3]);
  });

  test('索引の定義の集約点SEARCH_INDEXESに登録される', () => {
    expect(SEARCH_INDEXES).toContain(PRODUCT_SEARCH_INDEX);
  });
});
