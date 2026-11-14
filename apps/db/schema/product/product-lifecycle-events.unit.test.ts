import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { productLifecycleEvents } from './product-lifecycle-events.ts';
import { products } from './products.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(productLifecycleEvents);

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

describe('product_lifecycle_events', () => {
  test('テーブル名はプロダクトのライフサイクルイベントの複数形のスネークケースになる', () => {
    expect(config.name).toBe('product_lifecycle_events');
  });

  test('プロダクト・投稿者・種類・発生・状態・送信・完了の列と共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'product_id',
      'owner_user_id',
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

  test.each(['product_id', 'owner_user_id'])(
    '%sは単独では一意にならず既定値を持たないNOT NULLのテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.isUnique).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('typeは4種のイベントだけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const type = columnOf('type');

    expect(type.getSQLType()).toBe('text');
    expect(type.notNull).toBe(true);
    expect(type.enumValues).toEqual([
      'deleted',
      'hidden',
      'unhidden',
      'purge_due',
    ]);
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

  test('product_idだけがproductsのidを参照し、削除時の動作を指定せず、投稿者のIDは外部キーを持たない', () => {
    expect(config.foreignKeys).toHaveLength(1);
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'product_id',
    ]);
    expect(reference?.foreignTable).toBe(products);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      'id',
    ]);
    expect(foreignKey?.onDelete).toBeUndefined();
  });

  test('物理削除の開始はプロダクトごとに1件に限り、プロダクトごとの順序と送り直しの照会に索引を持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
      where:
        index.config.where === undefined
          ? undefined
          : dialect.sqlToQuery(index.config.where, 'indexes').sql,
    }));

    expect(indexes).toEqual([
      {
        name: 'product_lifecycle_events_product_id_purge_due_unique',
        columns: ['product_id'],
        unique: true,
        where: `"type" = 'purge_due'`,
      },
      {
        name: 'product_lifecycle_events_product_id_status_occurred_at_id_idx',
        columns: ['product_id', 'status', 'occurred_at', 'id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'product_lifecycle_events_status_last_dispatched_at_idx',
        columns: ['status', 'last_dispatched_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('typeとstatusを決まった値だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'product_lifecycle_events_type_check',
        sql: `"type" in ('deleted', 'hidden', 'unhidden', 'purge_due')`,
      },
      {
        name: 'product_lifecycle_events_status_check',
        sql: `"status" in ('pending', 'completed')`,
      },
    ]);
  });
});
