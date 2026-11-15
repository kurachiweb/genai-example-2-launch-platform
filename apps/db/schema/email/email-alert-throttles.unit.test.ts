import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { emailAlertThrottles } from './email-alert-throttles.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(emailAlertThrottles);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('email_alert_throttles', () => {
  test('テーブル名は警告の間引きの複数形のスネークケースになる', () => {
    expect(config.name).toBe('email_alert_throttles');
  });

  test('名前・最後に通知した日時と共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'name',
      'last_reported_at',
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

  test('nameは大文字小文字を区別しない一意のNOT NULLの列になる', () => {
    const name = columnOf('name');

    expect(name.getSQLType()).toBe('text collate nocase');
    expect(name.notNull).toBe(true);
    expect(name.isUnique).toBe(true);
    expect(name.hasDefault).toBe(false);
  });

  test('last_reported_atはUTCミリ秒の整数でNOT NULLになり、既定値を持たない', () => {
    const lastReportedAt = columnOf('last_reported_at');

    expect(lastReportedAt.getSQLType()).toBe('integer');
    expect(modeOf(lastReportedAt)).toBe('timestamp_ms');
    expect(lastReportedAt.notNull).toBe(true);
    expect(lastReportedAt.hasDefault).toBe(false);
    expect(lastReportedAt.onUpdateFn).toBeUndefined();
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

  test('一意の列のほかに索引を持たない', () => {
    expect(config.indexes).toEqual([]);
  });
});
