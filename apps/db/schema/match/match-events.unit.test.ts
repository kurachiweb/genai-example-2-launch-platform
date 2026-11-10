import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { matchEvents } from './match-events.ts';
import { matches } from './matches.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(matchEvents);

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

describe('match_events', () => {
  test('テーブル名はマッチイベントの複数形のスネークケースになる', () => {
    expect(config.name).toBe('match_events');
  });

  test('マッチ・種別・種類・発生・状態・送信・完了の列と共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'match_id',
      'match_kind',
      'type',
      'occurred_at',
      'status',
      'dispatch_count',
      'last_dispatched_at',
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

  test('match_idは単独では一意にならず既定値を持たないNOT NULLのテキストになる', () => {
    const matchId = columnOf('match_id');

    expect(matchId.getSQLType()).toBe('text');
    expect(matchId.notNull).toBe(true);
    expect(matchId.isUnique).toBe(false);
    expect(matchId.hasDefault).toBe(false);
  });

  test('match_kindはマッチの種別と同じ値だけを取るNOT NULLのテキストになる', () => {
    const matchKind = columnOf('match_kind');

    expect(matchKind.getSQLType()).toBe('text');
    expect(matchKind.notNull).toBe(true);
    expect(matchKind.enumValues).toEqual(['qualifier', 'week', 'year']);
    expect(matchKind.hasDefault).toBe(false);
  });

  test('typeは予定・開始・確定だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const type = columnOf('type');

    expect(type.getSQLType()).toBe('text');
    expect(type.notNull).toBe(true);
    expect(type.enumValues).toEqual(['scheduled', 'started', 'decided']);
    expect(type.hasDefault).toBe(false);
  });

  test('statusは未完了・完了だけを取るNOT NULLのテキストで、既定値は未完了になる', () => {
    const status = columnOf('status');

    expect(status.getSQLType()).toBe('text');
    expect(status.notNull).toBe(true);
    expect(status.enumValues).toEqual(['pending', 'completed']);
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

  test('completed_atはUTCミリ秒の整数で、未完了を表すNULLを許す', () => {
    const completedAt = columnOf('completed_at');

    expect(completedAt.getSQLType()).toBe('integer');
    expect(modeOf(completedAt)).toBe('timestamp_ms');
    expect(completedAt.notNull).toBe(false);
    expect(completedAt.hasDefault).toBe(false);
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

  test('match_idだけがmatchesのidを参照し、削除時の動作を指定しない', () => {
    expect(config.foreignKeys).toHaveLength(1);
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'match_id',
    ]);
    expect(reference?.foreignTable).toBe(matches);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      'id',
    ]);
    expect(foreignKey?.onDelete).toBeUndefined();
  });

  test('種類ごとのイベントをマッチに1件に限る一意索引と、マッチごとの順序・送り直し・削除の照会の索引を持つ', () => {
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
        name: 'match_events_match_id_type_unique',
        columns: ['match_id', 'type'],
        unique: true,
        where: undefined,
      },
      {
        name: 'match_events_match_id_status_occurred_at_id_idx',
        columns: ['match_id', 'status', 'occurred_at', 'id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'match_events_status_last_dispatched_at_idx',
        columns: ['status', 'last_dispatched_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'match_events_status_completed_at_idx',
        columns: ['status', 'completed_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('種別・種類・状態を決まった値だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'match_events_match_kind_check',
        sql: `"match_kind" in ('qualifier', 'week', 'year')`,
      },
      {
        name: 'match_events_type_check',
        sql: `"type" in ('scheduled', 'started', 'decided')`,
      },
      {
        name: 'match_events_status_check',
        sql: `"status" in ('pending', 'completed')`,
      },
    ]);
  });
});
