import type { SearchIndexDefinition } from './search-index-definition.ts';
import {
  renderSearchIndexSql,
  STATEMENT_SEPARATOR,
} from './search-index-sql.ts';

export interface MissingSearchIndexSql {
  readonly definition: SearchIndexDefinition;
  readonly missingStatements: readonly string[];
}

const TRIGGER_NAME_PATTERN = /^CREATE TRIGGER ([a-z0-9_]+) /;

const normalizeWhiteSpace = (sqlText: string): string =>
  sqlText.replace(/\s+/g, ' ').trim();

// 名前は定義の検証で英小文字・数字・_に限るため、正規表現の特殊文字を含まない
const dropStatementPattern = (kind: 'TABLE' | 'TRIGGER', name: string) =>
  new RegExp(`DROP ${kind} (?:IF EXISTS )?[\`"\\[]?${name}[\`"\\]]? ?;`, 'gi');

const lastMatchIndex = (text: string, patterns: readonly RegExp[]): number =>
  Math.max(
    -1,
    ...patterns.flatMap((pattern) =>
      [...text.matchAll(pattern)].map((match) => match.index),
    ),
  );

// テーブルを削除するとそのテーブルのトリガーも消えるため、索引文書のテーブルの削除もトリガーを無効にする
function invalidatingPatterns(
  definition: SearchIndexDefinition,
  statement: string,
): RegExp[] {
  const triggerName = TRIGGER_NAME_PATTERN.exec(statement)?.[1];
  if (triggerName === undefined) {
    return [dropStatementPattern('TABLE', definition.ftsTableName)];
  }
  return [
    dropStatementPattern('TRIGGER', triggerName),
    dropStatementPattern('TABLE', definition.documentsTableName),
  ];
}

// 作成文が適用順で最後の削除より後に現れれば、全マイグレーションの適用後に残っているとみなす
export function findMissingSearchIndexSql(
  definitions: readonly SearchIndexDefinition[],
  migrationSqlTexts: readonly string[],
): MissingSearchIndexSql[] {
  const appliedSql = migrationSqlTexts.map(normalizeWhiteSpace).join(' ');

  return definitions.flatMap((definition) => {
    const missingStatements = renderSearchIndexSql(definition)
      .split(STATEMENT_SEPARATOR)
      .filter((statement) => {
        const normalized = normalizeWhiteSpace(statement);
        const createdAt = appliedSql.lastIndexOf(normalized);
        const droppedAt = lastMatchIndex(
          appliedSql,
          invalidatingPatterns(definition, normalized),
        );
        return createdAt === -1 || droppedAt > createdAt;
      });
    return missingStatements.length === 0
      ? []
      : [{ definition, missingStatements }];
  });
}
