import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { legalDocuments } from './legal-documents.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(legalDocuments);

const dialect = new SQLiteDialect();

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('legal_documents', () => {
  test('テーブル名は法務文書の複数形のスネークケースになる', () => {
    expect(config.name).toBe('legal_documents');
  });

  test('種類・状態の版・最新の版番号・下書きの列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'kind',
      'state_version',
      'latest_version_number',
      'draft_body',
      'draft_saved_at',
      'draft_saved_by_admin_id',
      'created_at',
      'updated_at',
    ]);
  });

  test('idはULIDを採番するテキストの主キーになる', () => {
    const id = columnOf('id');

    expect(id.getSQLType()).toBe('text');
    expect(id.primary).toBe(true);
    expect(id.defaultFn?.()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('kindは利用規約・プライバシーポリシー・法的通知だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const kind = columnOf('kind');

    expect(kind.getSQLType()).toBe('text');
    expect(kind.notNull).toBe(true);
    expect(kind.enumValues).toEqual(['terms', 'privacy', 'legal-notice']);
    expect(kind.hasDefault).toBe(false);
  });

  test.each(['state_version', 'latest_version_number'])(
    '%sは既定値0のNOT NULLの整数になる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(column.notNull).toBe(true);
      expect(column.default).toBe(0);
      expect(column.isUnique).toBe(false);
    },
  );

  test.each(['draft_body', 'draft_saved_by_admin_id'])(
    '%sは値を限らない一意でないテキストで、下書きが無いことを表すNULLを許す',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(false);
      expect(column.isUnique).toBe(false);
      expect(column.enumValues).toBeUndefined();
      expect(column.hasDefault).toBe(false);
    },
  );

  test('draft_saved_atはUTCミリ秒の整数で、下書きが無いことを表すNULLを許し、既定値と更新時の値を持たない', () => {
    const draftSavedAt = columnOf('draft_saved_at');

    expect(draftSavedAt.getSQLType()).toBe('integer');
    expect(modeOf(draftSavedAt)).toBe('timestamp_ms');
    expect(draftSavedAt.notNull).toBe(false);
    expect(draftSavedAt.hasDefault).toBe(false);
    expect(draftSavedAt.onUpdateFn).toBeUndefined();
  });

  test.each(['created_at', 'updated_at'])(
    '%sは共通カラムのUTCミリ秒のNOT NULLの列になる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(true);
      expect(column.defaultFn?.()).toBeInstanceOf(Date);
    },
  );

  test('種類ごとに1行だけにする一意索引を持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
      where: index.config.where,
    }));

    expect(indexes).toEqual([
      {
        name: 'legal_documents_kind_unique',
        columns: ['kind'],
        unique: true,
        where: undefined,
      },
    ]);
  });

  test('kindを3つの種類だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'legal_documents_kind_check',
        sql: `"kind" in ('terms', 'privacy', 'legal-notice')`,
      },
    ]);
  });

  test('下書きを保存した管理者のIDを含め、他のテーブルへの外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });
});
