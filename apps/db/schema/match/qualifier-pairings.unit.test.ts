import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { qualifierPairings } from './qualifier-pairings.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(qualifierPairings);

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

describe('qualifier_pairings', () => {
  test('テーブル名は予選のペアリングの複数形のスネークケースになる', () => {
    expect(config.name).toBe('qualifier_pairings');
  });

  test('実施日・状態・ローンチ数・マッチ数・完了の列と共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'match_date',
      'status',
      'launch_count',
      'match_count',
      'completed_at',
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

  test('match_dateは実施日ごとに1件に限る一意のNOT NULLのテキストになる', () => {
    const matchDate = columnOf('match_date');

    expect(matchDate.getSQLType()).toBe('text');
    expect(matchDate.notNull).toBe(true);
    expect(matchDate.isUnique).toBe(true);
    expect(matchDate.hasDefault).toBe(false);
  });

  test('statusは未完了・完了だけを取るNOT NULLのテキストで、既定値は未完了になる', () => {
    const status = columnOf('status');

    expect(status.getSQLType()).toBe('text');
    expect(status.notNull).toBe(true);
    expect(status.enumValues).toEqual(['pending', 'completed']);
    expect(status.default).toBe('pending');
  });

  test.each(['launch_count', 'match_count'])(
    '%sは未完了を表すNULLを許す数値の整数になる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(column.columnType).toBe('SQLiteInteger');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('completed_atはUTCミリ秒の整数で、未完了を表すNULLを許す', () => {
    const completedAt = columnOf('completed_at');

    expect(completedAt.getSQLType()).toBe('integer');
    expect(modeOf(completedAt)).toBe('timestamp_ms');
    expect(completedAt.notNull).toBe(false);
    expect(completedAt.hasDefault).toBe(false);
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

  test('外部キーと列の一意制約以外の索引を持たない', () => {
    expect(config.foreignKeys).toEqual([]);
    expect(config.indexes).toEqual([]);
  });

  test('statusを決まった値だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'qualifier_pairings_status_check',
        sql: `"status" in ('pending', 'completed')`,
      },
    ]);
  });
});
