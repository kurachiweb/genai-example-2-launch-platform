import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { matchEventHandlerRuns } from './match-event-handler-runs.ts';
import { matchEvents } from './match-events.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(matchEventHandlerRuns);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('match_event_handler_runs', () => {
  test('テーブル名はマッチイベントの処理の実行記録の複数形のスネークケースになる', () => {
    expect(config.name).toBe('match_event_handler_runs');
  });

  test('イベント・処理の名前・完了の列と共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'event_id',
      'handler_name',
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

  test.each(['event_id', 'handler_name'])(
    '%sは単独では一意にならず既定値を持たないNOT NULLのテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.isUnique).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('completed_atはUTCミリ秒の整数でNOT NULLになり、既定値を持たない', () => {
    const completedAt = columnOf('completed_at');

    expect(completedAt.getSQLType()).toBe('integer');
    expect(modeOf(completedAt)).toBe('timestamp_ms');
    expect(completedAt.notNull).toBe(true);
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

  test('event_idはmatch_eventsのidを参照し、削除時の動作を指定しない', () => {
    expect(config.foreignKeys).toHaveLength(1);
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'event_id',
    ]);
    expect(reference?.foreignTable).toBe(matchEvents);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      'id',
    ]);
    expect(foreignKey?.onDelete).toBeUndefined();
  });

  test('イベントと処理の名前の組を一意にする索引だけを持つ', () => {
    expect(
      config.indexes.map((index) => ({
        name: index.config.name,
        columns: index.config.columns.map(
          (column) => (column as SQLiteColumn).name,
        ),
        unique: index.config.unique,
      })),
    ).toEqual([
      {
        name: 'match_event_handler_runs_event_id_handler_name_unique',
        columns: ['event_id', 'handler_name'],
        unique: true,
      },
    ]);
  });
});
