import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { paymentPriceSnapshots } from './payment-price-snapshots.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(paymentPriceSnapshots);

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

const PAYMENT_INSTRUMENT_COLUMN_PATTERN =
  /card|cvc|cvv|(?:^|_)pan(?:_|$)|account_number|iban|routing|exp_month|exp_year/;

describe('payment_price_snapshots', () => {
  test('テーブル名は価格の一時保持の複数形のスネークケースになる', () => {
    expect(config.name).toBe('payment_price_snapshots');
  });

  test('価格のキー・Stripeの価格・単価・通貨・請求の間隔・取得日時の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'lookup_key',
      'stripe_price_id',
      'unit_amount',
      'currency',
      'recurring_interval',
      'fetched_at',
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

  test.each(['lookup_key', 'stripe_price_id'])(
    '%sはNOT NULLのテキストで、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('unit_amountは最小通貨単位のNOT NULLの整数で、既定値を持たない', () => {
    const unitAmount = columnOf('unit_amount');

    expect(unitAmount.getSQLType()).toBe('integer');
    expect(unitAmount.columnType).toBe('SQLiteInteger');
    expect(unitAmount.notNull).toBe(true);
    expect(unitAmount.hasDefault).toBe(false);
  });

  test('currencyは共有定義の決済の通貨だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const currency = columnOf('currency');

    expect(currency.getSQLType()).toBe('text');
    expect(currency.notNull).toBe(true);
    expect(currency.enumValues).toEqual(['usd']);
    expect(currency.hasDefault).toBe(false);
  });

  test('recurring_intervalは月ごとだけを取り、都度決済の価格のNULLを許す', () => {
    const recurringInterval = columnOf('recurring_interval');

    expect(recurringInterval.getSQLType()).toBe('text');
    expect(recurringInterval.notNull).toBe(false);
    expect(recurringInterval.enumValues).toEqual(['month']);
    expect(recurringInterval.hasDefault).toBe(false);
  });

  test('fetched_atはUTCミリ秒のNOT NULLの整数で、既定値と更新時の値を持たない', () => {
    const fetchedAt = columnOf('fetched_at');

    expect(fetchedAt.getSQLType()).toBe('integer');
    expect(modeOf(fetchedAt)).toBe('timestamp_ms');
    expect(fetchedAt.notNull).toBe(true);
    expect(fetchedAt.hasDefault).toBe(false);
    expect(fetchedAt.onUpdateFn).toBeUndefined();
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

  test('価格のキーの一意索引を持つ', () => {
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
        name: 'payment_price_snapshots_lookup_key_unique',
        columns: ['lookup_key'],
        unique: true,
        where: undefined,
      },
    ]);
  });

  test('通貨と請求の間隔を決まった値だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'payment_price_snapshots_currency_check',
        sql: `"currency" in ('usd')`,
      },
      {
        name: 'payment_price_snapshots_recurring_interval_check',
        sql: `"recurring_interval" in ('month')`,
      },
    ]);
  });

  test('外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });
});
