import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import {
  PAYMENT_EMAIL_REQUEST_STATUS_VALUES,
  paymentPurchases,
  PURCHASE_KIND_VALUES,
  PURCHASE_STATUS_VALUES,
  REJECTION_REASON_VALUES,
} from './payment-purchases.ts';

const EXPECTED_PURCHASE_KINDS = [
  'week_tournament_entry',
  'year_tournament_entry',
  'sponsorship',
  'ultras',
  'payments_smoke',
];

const EXPECTED_PURCHASE_STATUSES = [
  'open',
  'processing',
  'fulfilled',
  'rejected',
  'expired',
  'superseded',
];

const EXPECTED_REJECTION_REASONS = ['late', 'ineligible', 'duplicate'];

const EXPECTED_EMAIL_REQUEST_STATUSES = [
  'none',
  'pending',
  'requested',
  'skipped',
];

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(paymentPurchases);

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

describe('payment_purchases', () => {
  test('テーブル名は購入の複数形のスネークケースになる', () => {
    expect(config.name).toBe('payment_purchases');
  });

  test('購入の状態・価格・期限・Stripeのオブジェクト・同意・メールの依頼の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'user_id',
      'kind',
      'target_id',
      'related_id',
      'exclusivity_key',
      'status',
      'rejection_reason',
      'state_token',
      'price_lookup_key',
      'stripe_price_id',
      'unit_amount',
      'quantity',
      'amount_total',
      'summary_json',
      'deadline_at',
      'accept_until',
      'fulfillable_until',
      'expires_at',
      'stripe_checkout_session_id',
      'stripe_payment_intent_id',
      'stripe_invoice_id',
      'stripe_subscription_id',
      'consented_at',
      'consent_version',
      'paid_at',
      'reflected_at',
      'confirmation_email_status',
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

  test.each([
    {
      name: '購入種別',
      values: PURCHASE_KIND_VALUES,
      expected: EXPECTED_PURCHASE_KINDS,
    },
    {
      name: '購入の状態',
      values: PURCHASE_STATUS_VALUES,
      expected: EXPECTED_PURCHASE_STATUSES,
    },
    {
      name: '拒否の理由',
      values: REJECTION_REASON_VALUES,
      expected: EXPECTED_REJECTION_REASONS,
    },
    {
      name: 'メールの依頼の状態',
      values: PAYMENT_EMAIL_REQUEST_STATUS_VALUES,
      expected: EXPECTED_EMAIL_REQUEST_STATUSES,
    },
  ])(
    '他のテーブルとアプリの一致の検査が使う$nameの一覧をエクスポートする',
    ({ values, expected }) => {
      expect<readonly string[]>([...values]).toEqual(expected);
    },
  );

  test('idはULIDを採番するテキストの主キーになる', () => {
    const id = columnOf('id');

    expect(id.getSQLType()).toBe('text');
    expect(id.primary).toBe(true);
    expect(id.defaultFn?.()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test.each([
    'user_id',
    'state_token',
    'price_lookup_key',
    'stripe_price_id',
    'summary_json',
  ])('%sはNOT NULLのテキストで、既定値を持たない', (name) => {
    const column = columnOf(name);

    expect(column.getSQLType()).toBe('text');
    expect(column.notNull).toBe(true);
    expect(column.hasDefault).toBe(false);
  });

  test.each([
    'target_id',
    'related_id',
    'exclusivity_key',
    'stripe_checkout_session_id',
    'stripe_payment_intent_id',
    'stripe_invoice_id',
    'stripe_subscription_id',
    'consent_version',
  ])('%sはNULLを許すテキストで、既定値を持たない', (name) => {
    const column = columnOf(name);

    expect(column.getSQLType()).toBe('text');
    expect(column.notNull).toBe(false);
    expect(column.hasDefault).toBe(false);
  });

  test.each(['unit_amount', 'quantity', 'amount_total'])(
    '%sは最小通貨単位または個数のNOT NULLの整数で、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(column.columnType).toBe('SQLiteInteger');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('expires_atはUTCミリ秒のNOT NULLの整数で、既定値と更新時の値を持たない', () => {
    const expiresAt = columnOf('expires_at');

    expect(expiresAt.getSQLType()).toBe('integer');
    expect(modeOf(expiresAt)).toBe('timestamp_ms');
    expect(expiresAt.notNull).toBe(true);
    expect(expiresAt.hasDefault).toBe(false);
    expect(expiresAt.onUpdateFn).toBeUndefined();
  });

  test.each([
    'deadline_at',
    'accept_until',
    'fulfillable_until',
    'consented_at',
    'paid_at',
    'reflected_at',
    'last_event_at',
  ])('%sはNULLを許すUTCミリ秒の整数で、既定値を持たない', (name) => {
    const column = columnOf(name);

    expect(column.getSQLType()).toBe('integer');
    expect(modeOf(column)).toBe('timestamp_ms');
    expect(column.notNull).toBe(false);
    expect(column.hasDefault).toBe(false);
  });

  test('kindは共有定義の購入種別だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const kind = columnOf('kind');

    expect(kind.getSQLType()).toBe('text');
    expect(kind.notNull).toBe(true);
    expect(kind.enumValues).toEqual(EXPECTED_PURCHASE_KINDS);
    expect(kind.hasDefault).toBe(false);
  });

  test('statusは共有定義の購入の状態だけを取るNOT NULLのテキストで、既定は未完了になる', () => {
    const status = columnOf('status');

    expect(status.getSQLType()).toBe('text');
    expect(status.notNull).toBe(true);
    expect(status.enumValues).toEqual(EXPECTED_PURCHASE_STATUSES);
    expect(status.default).toBe('open');
  });

  test('rejection_reasonは共有定義の拒否の理由だけを取り、拒否していない購入のNULLを許す', () => {
    const rejectionReason = columnOf('rejection_reason');

    expect(rejectionReason.getSQLType()).toBe('text');
    expect(rejectionReason.notNull).toBe(false);
    expect(rejectionReason.enumValues).toEqual(EXPECTED_REJECTION_REASONS);
    expect(rejectionReason.hasDefault).toBe(false);
  });

  test('confirmation_email_statusは共有定義のメールの依頼の状態だけを取るNOT NULLのテキストで、既定は依頼なしになる', () => {
    const status = columnOf('confirmation_email_status');

    expect(status.getSQLType()).toBe('text');
    expect(status.notNull).toBe(true);
    expect(status.enumValues).toEqual(EXPECTED_EMAIL_REQUEST_STATUSES);
    expect(status.default).toBe('none');
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

  test('決済セッションの一意索引、完了した購入に限るexclusivity_keyの部分一意索引と、照会のための索引を持つ', () => {
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
        name: 'payment_purchases_stripe_checkout_session_id_unique',
        columns: ['stripe_checkout_session_id'],
        unique: true,
        where: undefined,
      },
      {
        name: 'payment_purchases_exclusivity_key_fulfilled_unique',
        columns: ['exclusivity_key'],
        unique: true,
        where: `"status" = 'fulfilled'`,
      },
      {
        name: 'payment_purchases_user_id_status_idx',
        columns: ['user_id', 'status'],
        unique: false,
        where: undefined,
      },
      {
        name: 'payment_purchases_status_deadline_at_idx',
        columns: ['status', 'deadline_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'payment_purchases_status_expires_at_idx',
        columns: ['status', 'expires_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'payment_purchases_user_id_kind_target_id_status_idx',
        columns: ['user_id', 'kind', 'target_id', 'status'],
        unique: false,
        where: undefined,
      },
      {
        name: 'payment_purchases_stripe_payment_intent_id_idx',
        columns: ['stripe_payment_intent_id'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('購入種別・状態・拒否の理由・メールの依頼の状態を共有定義の値だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'payment_purchases_kind_check',
        sql: inList('kind', EXPECTED_PURCHASE_KINDS),
      },
      {
        name: 'payment_purchases_status_check',
        sql: inList('status', EXPECTED_PURCHASE_STATUSES),
      },
      {
        name: 'payment_purchases_rejection_reason_check',
        sql: inList('rejection_reason', EXPECTED_REJECTION_REASONS),
      },
      {
        name: 'payment_purchases_confirmation_email_status_check',
        sql: inList(
          'confirmation_email_status',
          EXPECTED_EMAIL_REQUEST_STATUSES,
        ),
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
