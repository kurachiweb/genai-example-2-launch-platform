import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { moderationWeeklyStatistics } from './moderation-weekly-statistics.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(moderationWeeklyStatistics);

const dialect = new SQLiteDialect();

const COUNT_COLUMNS = [
  'users_total',
  'products_total',
  'qualifier_matches',
  'upvotes',
];

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('moderation_weekly_statistics', () => {
  test('テーブル名は措置の機能の週ごとの統計の複数形のスネークケースになる', () => {
    expect(config.name).toBe('moderation_weekly_statistics');
  });

  test('週の開始日・収益・利用者数・プロダクト数・予選実施数・Upvote数・確定・集計日時の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'week_start',
      'net_revenue',
      'users_total',
      'products_total',
      'qualifier_matches',
      'upvotes',
      'finalized',
      'computed_at',
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

  test('week_startは業務日付の文字列を持つ、既定値を持たないNOT NULLのテキストになる', () => {
    const weekStart = columnOf('week_start');

    expect(weekStart.getSQLType()).toBe('text');
    expect(weekStart.notNull).toBe(true);
    expect(weekStart.hasDefault).toBe(false);
  });

  test('net_revenueは返金とチャージバックで負にもなり得る、既定値を持たないNOT NULLの整数になる', () => {
    const netRevenue = columnOf('net_revenue');

    expect(netRevenue.getSQLType()).toBe('integer');
    expect(netRevenue.notNull).toBe(true);
    expect(netRevenue.hasDefault).toBe(false);
  });

  test.each(COUNT_COLUMNS)(
    '%sは既定値を持たないNOT NULLの整数になる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('finalizedは真偽値を0・1で持ち、集計する側が決めるため既定値を持たないNOT NULLの整数になる', () => {
    const finalized = columnOf('finalized');

    expect(finalized.getSQLType()).toBe('integer');
    expect(modeOf(finalized)).toBe('boolean');
    expect(finalized.notNull).toBe(true);
    expect(finalized.hasDefault).toBe(false);
  });

  test('computed_atはUTCミリ秒の整数でNOT NULLになり、既定値と更新時の値を持たない', () => {
    const computedAt = columnOf('computed_at');

    expect(computedAt.getSQLType()).toBe('integer');
    expect(modeOf(computedAt)).toBe('timestamp_ms');
    expect(computedAt.notNull).toBe(true);
    expect(computedAt.hasDefault).toBe(false);
    expect(computedAt.onUpdateFn).toBeUndefined();
  });

  test.each(['created_at', 'updated_at'])(
    '確定前の週を集計し直して更新するため、%sは共通カラムのUTCミリ秒のNOT NULLの列になる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(true);
      expect(column.defaultFn?.()).toBeInstanceOf(Date);
    },
  );

  test('集計値だけを持ち、他の機能の行の物理削除を妨げないよう、外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });

  test('同じ週の行を重ねて作らないよう、week_startの一意索引だけを持つ', () => {
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
        name: 'moderation_weekly_statistics_week_start_unique',
        columns: ['week_start'],
        unique: true,
        where: undefined,
      },
    ]);
  });

  test('確定を0・1に、件数を0以上に限るCHECK制約を持ち、収益の符号は限らない', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'moderation_weekly_statistics_finalized_check',
        sql: `"finalized" in (0, 1)`,
      },
      ...COUNT_COLUMNS.map((name) => ({
        name: `moderation_weekly_statistics_${name}_check`,
        sql: `"${name}" >= 0`,
      })),
    ]);
  });
});
