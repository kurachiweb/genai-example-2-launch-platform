import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { paymentStripeObjects } from './payment-stripe-objects.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(paymentStripeObjects);

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

describe('payment_stripe_objects', () => {
  test('テーブル名はStripeのオブジェクトの複数形のスネークケースになる', () => {
    expect(config.name).toBe('payment_stripe_objects');
  });

  test('オブジェクトのID・種類・最終の発生時刻の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'object_id',
      'object_type',
      'last_event_at',
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

  test('object_idはNOT NULLのテキストで、既定値を持たない', () => {
    const objectId = columnOf('object_id');

    expect(objectId.getSQLType()).toBe('text');
    expect(objectId.notNull).toBe(true);
    expect(objectId.hasDefault).toBe(false);
  });

  test('object_typeは定期課金だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const objectType = columnOf('object_type');

    expect(objectType.getSQLType()).toBe('text');
    expect(objectType.notNull).toBe(true);
    expect(objectType.enumValues).toEqual(['subscription']);
    expect(objectType.hasDefault).toBe(false);
  });

  test('last_event_atは版の検査に使うため、既定値と更新時の値を持たないUTCミリ秒のNOT NULLの整数になる', () => {
    const lastEventAt = columnOf('last_event_at');

    expect(lastEventAt.getSQLType()).toBe('integer');
    expect(modeOf(lastEventAt)).toBe('timestamp_ms');
    expect(lastEventAt.notNull).toBe(true);
    expect(lastEventAt.hasDefault).toBe(false);
    expect(lastEventAt.onUpdateFn).toBeUndefined();
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

  test('オブジェクトのIDの一意索引を持つ', () => {
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
        name: 'payment_stripe_objects_object_id_unique',
        columns: ['object_id'],
        unique: true,
        where: undefined,
      },
    ]);
  });

  test('オブジェクトの種類を定期課金だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'payment_stripe_objects_object_type_check',
        sql: `"object_type" in ('subscription')`,
      },
    ]);
  });

  test('外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });
});
