import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { paymentPurchases } from './payment-purchases.ts';
import {
  paymentRefunds,
  REFUND_REQUEST_STATUS_VALUES,
} from './payment-refunds.ts';

const EXPECTED_REFUND_REQUEST_STATUSES = [
  'requested',
  'submitted',
  'succeeded',
  'failed',
  'canceled',
];

const EXPECTED_EMAIL_REQUEST_STATUSES = [
  'none',
  'pending',
  'requested',
  'skipped',
];

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(paymentRefunds);

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

const inList = (column: string, values: readonly string[]): string =>
  `"${column}" in (${values.map((value) => `'${value}'`).join(', ')})`;

const PAYMENT_INSTRUMENT_COLUMN_PATTERN =
  /card|cvc|cvv|(?:^|_)pan(?:_|$)|account_number|iban|routing|exp_month|exp_year/;

describe('payment_refunds', () => {
  test('テーブル名は返金の依頼の複数形のスネークケースになる', () => {
    expect(config.name).toBe('payment_refunds');
  });

  test('購入・依頼キー・金額・理由・状態・Stripeの返金・送信・通知の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'purchase_id',
      'request_key',
      'amount',
      'reason',
      'status',
      'stripe_refund_id',
      'failure_code',
      'dispatched_at',
      'notice_status',
      'created_at',
      'updated_at',
    ]);
  });

  test('アプリの一致の検査が使う返金の依頼の状態の一覧をエクスポートする', () => {
    expect<readonly string[]>([...REFUND_REQUEST_STATUS_VALUES]).toEqual(
      EXPECTED_REFUND_REQUEST_STATUSES,
    );
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

  test.each(['purchase_id', 'request_key', 'reason'])(
    '%sはNOT NULLのテキストで、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test.each(['stripe_refund_id', 'failure_code'])(
    '%sはNULLを許すテキストで、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('amountは返金する最小通貨単位のNOT NULLの整数で、既定値を持たない', () => {
    const amount = columnOf('amount');

    expect(amount.getSQLType()).toBe('integer');
    expect(amount.columnType).toBe('SQLiteInteger');
    expect(amount.notNull).toBe(true);
    expect(amount.hasDefault).toBe(false);
  });

  test('dispatched_atは未送信を表すNULLを許すUTCミリ秒の整数で、既定値を持たない', () => {
    const dispatchedAt = columnOf('dispatched_at');

    expect(dispatchedAt.getSQLType()).toBe('integer');
    expect(modeOf(dispatchedAt)).toBe('timestamp_ms');
    expect(dispatchedAt.notNull).toBe(false);
    expect(dispatchedAt.hasDefault).toBe(false);
  });

  test('statusは共有定義の返金の依頼の状態だけを取るNOT NULLのテキストで、既定は受付になる', () => {
    const status = columnOf('status');

    expect(status.getSQLType()).toBe('text');
    expect(status.notNull).toBe(true);
    expect(status.enumValues).toEqual(EXPECTED_REFUND_REQUEST_STATUSES);
    expect(status.default).toBe('requested');
  });

  test('notice_statusは共有定義のメールの依頼の状態だけを取るNOT NULLのテキストで、既定は依頼なしになる', () => {
    const noticeStatus = columnOf('notice_status');

    expect(noticeStatus.getSQLType()).toBe('text');
    expect(noticeStatus.notNull).toBe(true);
    expect(noticeStatus.enumValues).toEqual(EXPECTED_EMAIL_REQUEST_STATUSES);
    expect(noticeStatus.default).toBe('none');
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

  test('依頼キーとStripeの返金の一意索引と、購入ごとの照会の索引を持つ', () => {
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
        name: 'payment_refunds_request_key_unique',
        columns: ['request_key'],
        unique: true,
        where: undefined,
      },
      {
        name: 'payment_refunds_stripe_refund_id_unique',
        columns: ['stripe_refund_id'],
        unique: true,
        where: undefined,
      },
      {
        name: 'payment_refunds_purchase_id_idx',
        columns: ['purchase_id'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('状態と通知の状態を共有定義の値だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'payment_refunds_status_check',
        sql: inList('status', EXPECTED_REFUND_REQUEST_STATUSES),
      },
      {
        name: 'payment_refunds_notice_status_check',
        sql: inList('notice_status', EXPECTED_EMAIL_REQUEST_STATUSES),
      },
    ]);
  });

  test('purchase_idはpayment_purchasesのidを参照し、削除時の動作を指定しない', () => {
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
        columns: ['purchase_id'],
        foreignTable: paymentPurchases,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
    ]);
  });
});
