import { sql, type SQL } from 'drizzle-orm';

import type { SearchIndexDefinition } from './search-index-definition.ts';

// 名前は定義の検証で英小文字・数字・_に限り、重みは正の有限数に限るため、識別子と重みはSQLへ直接埋め込む
export function bm25Rank(definition: SearchIndexDefinition): SQL<number> {
  const weights = [
    ...definition.textColumns.map((column) => column.weight),
    definition.keywordsWeight,
  ].map(String);
  return sql<number>`bm25(${sql.raw([definition.ftsTableName, ...weights].join(', '))})`;
}

export function ftsRankedSources(
  definition: SearchIndexDefinition,
  matchExpression: string,
): SQL {
  const fts = sql.raw(definition.ftsTableName);
  const documents = sql.raw(definition.documentsTableName);
  return sql`SELECT d.source_id AS source_id, ${bm25Rank(definition)} AS rank FROM ${fts} JOIN ${documents} AS d ON d.id = ${fts}.rowid WHERE ${fts} MATCH ${matchExpression}`;
}
