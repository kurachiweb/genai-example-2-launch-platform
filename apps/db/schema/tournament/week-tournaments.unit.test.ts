import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { tournamentBrackets } from './tournament-brackets.ts';
import { weekTournaments } from './week-tournaments.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(weekTournaments);

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

describe('week_tournaments', () => {
  test('テーブル名は週のトーナメントの複数形のスネークケースになる', () => {
    expect(config.name).toBe('week_tournaments');
  });

  test('週・受付と期限と組み合わせ決定の日時・状態・組み合わせの記録・ブラケット・結果・受賞・終了の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'week_start',
      'accept_until',
      'deadline_at',
      'draw_at',
      'status',
      'draw_started_at',
      'drawn_at',
      'bracket_id',
      'outcome',
      'champion_entry_id',
      'awarded_at',
      'finished_at',
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

  test('week_startは週の初日の業務日付を持つNOT NULLのテキストになる', () => {
    const weekStart = columnOf('week_start');

    expect(weekStart.getSQLType()).toBe('text');
    expect(weekStart.notNull).toBe(true);
    expect(weekStart.hasDefault).toBe(false);
  });

  test.each(['accept_until', 'deadline_at', 'draw_at'])(
    '%sはUTCミリ秒の整数でNOT NULLになり、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('statusは受付中・組み合わせ決定中・進行中・終了だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const status = columnOf('status');

    expect(status.getSQLType()).toBe('text');
    expect(status.notNull).toBe(true);
    expect(status.enumValues).toEqual([
      'open',
      'drawing',
      'in_progress',
      'finished',
    ]);
    expect(status.hasDefault).toBe(false);
  });

  test.each(['draw_started_at', 'drawn_at', 'awarded_at', 'finished_at'])(
    '%sはUTCミリ秒の整数で、まだ起きていないことを表すNULLを許す',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test.each(['bracket_id', 'champion_entry_id'])(
    '%sは決まっていないことを表すNULLを許すテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('outcomeは授与・授与なしだけを取り、終わっていないことを表すNULLを許すテキストになる', () => {
    const outcome = columnOf('outcome');

    expect(outcome.getSQLType()).toBe('text');
    expect(outcome.notNull).toBe(false);
    expect(outcome.enumValues).toEqual(['awarded', 'no_award']);
    expect(outcome.hasDefault).toBe(false);
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

  test('ブラケットのIDだけが外部キーで、削除時の動作を指定しない', () => {
    const foreignKeys = config.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference();
      return {
        columns: reference.columns.map((column) => column.name),
        foreignTable: reference.foreignTable,
        foreignColumns: reference.foreignColumns.map((column) => column.name),
        onDelete: foreignKey.onDelete,
      };
    });

    expect(foreignKeys).toEqual([
      {
        columns: ['bracket_id'],
        foreignTable: tournamentBrackets,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
    ]);
  });

  test('週の一意索引と、状態と組み合わせ決定の日時の索引を持つ', () => {
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
        name: 'week_tournaments_week_start_unique',
        columns: ['week_start'],
        unique: true,
        where: undefined,
      },
      {
        name: 'week_tournaments_status_draw_at_idx',
        columns: ['status', 'draw_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('状態と結果を決まった値だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'week_tournaments_status_check',
        sql: `"status" in ('open', 'drawing', 'in_progress', 'finished')`,
      },
      {
        name: 'week_tournaments_outcome_check',
        sql: `"outcome" in ('awarded', 'no_award')`,
      },
    ]);
  });
});
