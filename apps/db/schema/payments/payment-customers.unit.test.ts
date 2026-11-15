import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import { paymentCustomers } from './payment-customers.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(paymentCustomers);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

const PAYMENT_INSTRUMENT_COLUMN_PATTERN =
  /card|cvc|cvv|(?:^|_)pan(?:_|$)|account_number|iban|routing|exp_month|exp_year/;

describe('payment_customers', () => {
  test('テーブル名はStripe Customerの対応の複数形のスネークケースになる', () => {
    expect(config.name).toBe('payment_customers');
  });

  test('利用者とStripe Customerの列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'user_id',
      'stripe_customer_id',
      'created_at',
      'updated_at',
    ]);
  });

  test('カード番号などの決済情報の列を持たない', () => {
    expect(
      config.columns.filter((column) =>
        PAYMENT_INSTRUMENT_COLUMN_PATTERN.test(column.name),
      ),
    ).toEqual([]);
  });

  test('idはULIDを採番するテキストの主キーになる', () => {
    const id = columnOf('id');

    expect(id.getSQLType()).toBe('text');
    expect(id.primary).toBe(true);
    expect(id.defaultFn?.()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test.each(['user_id', 'stripe_customer_id'])(
    '%sはNOT NULLのテキストで、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

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

  test('利用者とStripe Customerをそれぞれ1対1にする一意索引を持つ', () => {
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
        name: 'payment_customers_user_id_unique',
        columns: ['user_id'],
        unique: true,
        where: undefined,
      },
      {
        name: 'payment_customers_stripe_customer_id_unique',
        columns: ['stripe_customer_id'],
        unique: true,
        where: undefined,
      },
    ]);
  });

  test('user_idはusersのidを参照し、削除時の動作を指定しない', () => {
    const references = config.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference();
      return {
        columns: reference.columns.map((column) => column.name),
        foreignTable: reference.foreignTable,
        foreignColumns: reference.foreignColumns.map((column) => column.name),
        onDelete: foreignKey.onDelete,
      };
    });

    expect(references).toEqual([
      {
        columns: ['user_id'],
        foreignTable: users,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
    ]);
  });
});
