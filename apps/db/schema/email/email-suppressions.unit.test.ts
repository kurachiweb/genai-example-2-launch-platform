import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { emailSuppressions } from './email-suppressions.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(emailSuppressions);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('email_suppressions', () => {
  test('テーブル名は抑止リストの複数形のスネークケースになる', () => {
    expect(config.name).toBe('email_suppressions');
  });

  test('照合と保持の判定に要る列と共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'address',
      'last_reason',
      'last_event_at',
      'expires_at',
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

  test('addressは大文字小文字を区別しない一意のNOT NULLの列になる', () => {
    const address = columnOf('address');

    expect(address.getSQLType()).toBe('text collate nocase');
    expect(address.notNull).toBe(true);
    expect(address.isUnique).toBe(true);
    expect(address.hasDefault).toBe(false);
  });

  test('last_reasonは最後の契機の種類だけを値に取るNOT NULLのテキストになる', () => {
    const lastReason = columnOf('last_reason');

    expect(lastReason.getSQLType()).toBe('text');
    expect(lastReason.notNull).toBe(true);
    expect(lastReason.isUnique).toBe(false);
    expect(lastReason.enumValues).toEqual([
      'hard_bounce',
      'complaint',
      'rejected',
    ]);
    expect(lastReason.hasDefault).toBe(false);
  });

  test('last_event_atはUTCミリ秒の整数でNOT NULLになり、既定値を持たない', () => {
    const lastEventAt = columnOf('last_event_at');

    expect(lastEventAt.getSQLType()).toBe('integer');
    expect(modeOf(lastEventAt)).toBe('timestamp_ms');
    expect(lastEventAt.notNull).toBe(true);
    expect(lastEventAt.hasDefault).toBe(false);
    expect(lastEventAt.onUpdateFn).toBeUndefined();
  });

  test('expires_atはUTCミリ秒の整数で、期限なしを表すNULLを許す', () => {
    const expiresAt = columnOf('expires_at');

    expect(expiresAt.getSQLType()).toBe('integer');
    expect(modeOf(expiresAt)).toBe('timestamp_ms');
    expect(expiresAt.notNull).toBe(false);
    expect(expiresAt.hasDefault).toBe(false);
    expect(expiresAt.onUpdateFn).toBeUndefined();
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

  test('最後の契機の日時と期限に、一意でない索引を1つずつ持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
    }));

    expect(indexes).toEqual([
      {
        name: 'email_suppressions_last_event_at_idx',
        columns: ['last_event_at'],
        unique: false,
      },
      {
        name: 'email_suppressions_expires_at_idx',
        columns: ['expires_at'],
        unique: false,
      },
    ]);
  });
});
