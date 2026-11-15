import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { productLifecycleEvents } from './product-lifecycle-events.ts';
import { productLifecycleHandlerRuns } from './product-lifecycle-handler-runs.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(productLifecycleHandlerRuns);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('product_lifecycle_handler_runs', () => {
  test('テーブル名はプロダクトのライフサイクルの波及処理の実行の複数形のスネークケースになる', () => {
    expect(config.name).toBe('product_lifecycle_handler_runs');
  });

  test('イベント・波及処理の名前・完了日時の列と共通カラムだけを持つ', () => {
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
    '%sはNOT NULLのテキストで、単独では一意にならない',
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

  test('event_idはproduct_lifecycle_eventsのidを参照し、削除時の動作を指定しない', () => {
    expect(config.foreignKeys).toHaveLength(1);
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'event_id',
    ]);
    expect(reference?.foreignTable).toBe(productLifecycleEvents);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      'id',
    ]);
    expect(foreignKey?.onDelete).toBeUndefined();
  });

  test('イベントと波及処理の名前の組の一意な索引だけを持ち、CHECK制約を持たない', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
    }));

    expect(indexes).toEqual([
      {
        name: 'product_lifecycle_handler_runs_event_id_handler_name_unique',
        columns: ['event_id', 'handler_name'],
        unique: true,
      },
    ]);
    expect(config.checks).toEqual([]);
  });
});
