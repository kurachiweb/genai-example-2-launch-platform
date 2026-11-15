import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { findMissingSearchIndexSql } from './migration-coverage.ts';
import { SEARCH_INDEXES } from './search-indexes.ts';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', 'migrations');

// Wranglerはマイグレーションを名前の昇順で適用するため、同じ順で読み込んで後の削除を判定に含める
const readMigrationSqlTexts = (): string[] =>
  readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) =>
      readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'),
    );

describe('SEARCH_INDEXES', () => {
  test('索引文書のテーブル名が重複しない', () => {
    const names = SEARCH_INDEXES.map(
      (definition) => definition.documentsTableName,
    );

    expect(new Set(names).size).toBe(names.length);
  });

  test('全ての定義の全文検索の索引と3つのトリガーが、マイグレーションの適用後に残っている', () => {
    const missing = findMissingSearchIndexSql(
      SEARCH_INDEXES,
      readMigrationSqlTexts(),
    ).map(({ definition, missingStatements }) => ({
      documentsTableName: definition.documentsTableName,
      missingStatements,
    }));

    expect(missing).toEqual([]);
  });
});
