import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { emailSendRecords } from './email-send-records.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(emailSendRecords);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('email_send_records', () => {
  test('テーブル名は送信済みの記録の複数形のスネークケースになる', () => {
    expect(config.name).toBe('email_send_records');
  });

  test('送信要求の識別子・種別・送信日時と共通カラムだけを持ち、宛先・本文・入力を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'kind',
      'sent_at',
      'created_at',
      'updated_at',
    ]);
  });

  test('idはSQLの既定値を持たないテキストの主キーになる', () => {
    const id = columnOf('id');

    expect(id.getSQLType()).toBe('text');
    expect(id.primary).toBe(true);
    expect(id.notNull).toBe(true);
    expect(id.default).toBeUndefined();
  });

  test('kindはメール種別の名前を持つNOT NULLのテキストになる', () => {
    const kind = columnOf('kind');

    expect(kind.getSQLType()).toBe('text');
    expect(kind.notNull).toBe(true);
    expect(kind.isUnique).toBe(false);
    expect(kind.hasDefault).toBe(false);
  });

  test('sent_atはUTCミリ秒の整数でNOT NULLになり、既定値を持たない', () => {
    const sentAt = columnOf('sent_at');

    expect(sentAt.getSQLType()).toBe('integer');
    expect(modeOf(sentAt)).toBe('timestamp_ms');
    expect(sentAt.notNull).toBe(true);
    expect(sentAt.hasDefault).toBe(false);
    expect(sentAt.onUpdateFn).toBeUndefined();
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

  test('送信日時に、一意でない索引を持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
    }));

    expect(indexes).toEqual([
      {
        name: 'email_send_records_sent_at_idx',
        columns: ['sent_at'],
        unique: false,
      },
    ]);
  });
});
