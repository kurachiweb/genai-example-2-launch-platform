import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { adminAuditLogs } from './admin-audit-logs.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(adminAuditLogs);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('admin_audit_logs', () => {
  test('テーブル名は監査ログの複数形のスネークケースになる', () => {
    expect(config.name).toBe('admin_audit_logs');
  });

  test('操作者・操作種別・対象の種類・理由・詳細・日時の列と共通カラムだけを持ち、個人情報の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'operator_admin_id',
      'action',
      'target_kind',
      'reason',
      'detail',
      'occurred_at',
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

  test.each(['operator_admin_id', 'action'])(
    '%sは値を限らない一意でないNOT NULLのテキストで、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.isUnique).toBe(false);
      expect(column.enumValues).toBeUndefined();
      expect(column.hasDefault).toBe(false);
    },
  );

  test.each(['target_kind', 'reason'])(
    '%sは値を限らないテキストで、対象や理由が無いことを表すNULLを許す',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(false);
      expect(column.isUnique).toBe(false);
      expect(column.enumValues).toBeUndefined();
      expect(column.hasDefault).toBe(false);
    },
  );

  test('detailはJSONを保持するNOT NULLのテキストで、既定値は空のオブジェクトになる', () => {
    const detail = columnOf('detail');

    expect(detail.getSQLType()).toBe('text');
    expect(detail.columnType).toBe('SQLiteTextJson');
    expect(detail.notNull).toBe(true);
    expect(detail.default).toEqual({});
  });

  test('occurred_atはUTCミリ秒の整数でNOT NULLになり、既定値と更新時の値を持たない', () => {
    const occurredAt = columnOf('occurred_at');

    expect(occurredAt.getSQLType()).toBe('integer');
    expect(modeOf(occurredAt)).toBe('timestamp_ms');
    expect(occurredAt.notNull).toBe(true);
    expect(occurredAt.hasDefault).toBe(false);
    expect(occurredAt.onUpdateFn).toBeUndefined();
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

  test('操作者を含め、他のテーブルへの外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });

  test('日時の順・操作者ごと・操作種別ごとの照会に、一意でない索引を持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
    }));

    expect(indexes).toEqual([
      {
        name: 'admin_audit_logs_occurred_at_id_idx',
        columns: ['occurred_at', 'id'],
        unique: false,
      },
      {
        name: 'admin_audit_logs_operator_admin_id_occurred_at_idx',
        columns: ['operator_admin_id', 'occurred_at'],
        unique: false,
      },
      {
        name: 'admin_audit_logs_action_occurred_at_idx',
        columns: ['action', 'occurred_at'],
        unique: false,
      },
    ]);
  });

  test('値を限るCHECK制約を持たない', () => {
    expect(config.checks).toEqual([]);
  });
});
