import {
  index,
  integer,
  text,
  type IndexBuilder,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

export const KEYWORD_STATUSES = [
  'pending',
  'extracted',
  'fallback',
  'unsupported',
  'disabled',
] as const;

export type KeywordStatus = (typeof KEYWORD_STATUSES)[number];

// 全文検索の索引のSQLのひな形が列名を直接書くため、テーブルの列名の変換に頼らず列名を固定する
export function searchDocumentColumns() {
  return {
    id: integer('id').primaryKey(),
    sourceId: text('source_id').notNull().unique(),
    sourceVersion: integer('source_version').notNull().default(0),
    keywords: text('keywords').notNull().default(''),
    keywordStatus: text('keyword_status', { enum: KEYWORD_STATUSES })
      .notNull()
      .default('pending'),
    extractionInputHash: text('extraction_input_hash'),
    statusChangedAt: integer('status_changed_at', {
      mode: 'timestamp_ms',
    }).notNull(),
  } as const;
}

export function searchTextColumn(name: string) {
  return text(name).notNull().default('');
}

export function searchDocumentStatusIndex(
  tableName: string,
  table: { keywordStatus: SQLiteColumn; statusChangedAt: SQLiteColumn },
): IndexBuilder {
  return index(`${tableName}_status_idx`).on(
    table.keywordStatus,
    table.statusChangedAt,
  );
}
