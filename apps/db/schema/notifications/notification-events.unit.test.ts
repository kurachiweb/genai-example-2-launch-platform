import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { notificationEvents } from './notification-events.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(notificationEvents);

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

describe('notification_events', () => {
  test('テーブル名は通知イベントの複数形のスネークケースになる', () => {
    expect(config.name).toBe('notification_events');
  });

  test('種類・重複のキー・発行元・対象・状態・カーソル・日時・送信の列と共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'type',
      'dedupe_key',
      'publisher',
      'match_id',
      'award',
      'period',
      'product_id',
      'status',
      'cursor',
      'occurred_at',
      'expanded_at',
      'dispatch_count',
      'last_dispatched_at',
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

  test('typeは開始予告・結果・受賞だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const type = columnOf('type');

    expect(type.getSQLType()).toBe('text');
    expect(type.notNull).toBe(true);
    expect(type.enumValues).toEqual(['match_preview', 'match_result', 'award']);
    expect(type.hasDefault).toBe(false);
  });

  test.each(['dedupe_key', 'publisher'])(
    '%sは既定値を持たないNOT NULLのテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test.each(['match_id', 'period', 'product_id', 'cursor'])(
    '%sは種類によって無いことを表すNULLを許すテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('awardは2つの賞だけを取り、受賞でないことを表すNULLを許すテキストになる', () => {
    const award = columnOf('award');

    expect(award.getSQLType()).toBe('text');
    expect(award.notNull).toBe(false);
    expect(award.enumValues).toEqual([
      'product_of_the_week',
      'product_of_the_year',
    ]);
    expect(award.hasDefault).toBe(false);
  });

  test('statusは未展開・展開済みだけを取るNOT NULLのテキストで、既定値は未展開になる', () => {
    const status = columnOf('status');

    expect(status.getSQLType()).toBe('text');
    expect(status.notNull).toBe(true);
    expect(status.enumValues).toEqual(['pending', 'expanded']);
    expect(status.default).toBe('pending');
  });

  test.each(['occurred_at', 'last_dispatched_at'])(
    '%sはUTCミリ秒の整数でNOT NULLになり、既定値と更新時の値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
      expect(column.onUpdateFn).toBeUndefined();
    },
  );

  test('expanded_atはUTCミリ秒の整数で、未展開を表すNULLを許す', () => {
    const expandedAt = columnOf('expanded_at');

    expect(expandedAt.getSQLType()).toBe('integer');
    expect(modeOf(expandedAt)).toBe('timestamp_ms');
    expect(expandedAt.notNull).toBe(false);
    expect(expandedAt.hasDefault).toBe(false);
  });

  test('dispatch_countは数値の整数でNOT NULLになり、既定値は1になる', () => {
    const dispatchCount = columnOf('dispatch_count');

    expect(dispatchCount.getSQLType()).toBe('integer');
    expect(dispatchCount.columnType).toBe('SQLiteInteger');
    expect(dispatchCount.notNull).toBe(true);
    expect(dispatchCount.default).toBe(1);
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

  test('上流の物理削除を妨げないよう、マッチとプロダクトを含めて外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });

  test('重複のキーの一意索引と、送り直しと削除の照会の索引を持つ', () => {
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
        name: 'notification_events_dedupe_key_unique',
        columns: ['dedupe_key'],
        unique: true,
        where: undefined,
      },
      {
        name: 'notification_events_status_last_dispatched_at_idx',
        columns: ['status', 'last_dispatched_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'notification_events_status_expanded_at_idx',
        columns: ['status', 'expanded_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('種類・状態・賞を決まった値だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'notification_events_type_check',
        sql: `"type" in ('match_preview', 'match_result', 'award')`,
      },
      {
        name: 'notification_events_status_check',
        sql: `"status" in ('pending', 'expanded')`,
      },
      {
        name: 'notification_events_award_check',
        sql: `"award" in ('product_of_the_week', 'product_of_the_year')`,
      },
    ]);
  });
});
