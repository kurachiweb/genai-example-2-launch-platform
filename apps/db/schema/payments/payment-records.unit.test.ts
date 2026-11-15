import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import {
  PAYMENT_CURRENCY_VALUES,
  PAYMENT_RECORD_KIND_VALUES,
  PAYMENT_RECORD_STATUS_VALUES,
  paymentRecords,
} from './payment-records.ts';

const EXPECTED_PAYMENT_RECORD_KINDS = [
  'one_time',
  'subscription',
  'refund',
  'dispute',
];

const EXPECTED_PAYMENT_RECORD_STATUSES = [
  'succeeded',
  'failed',
  'pending',
  'disputed',
  'dispute_won',
  'dispute_lost',
];

const EXPECTED_PURCHASE_KINDS = [
  'week_tournament_entry',
  'year_tournament_entry',
  'sponsorship',
  'ultras',
  'payments_smoke',
];

const EXPECTED_CURRENCIES = ['usd'];

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(paymentRecords);

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

describe('payment_records', () => {
  test('テーブル名は決済履歴の記録の複数形のスネークケースになる', () => {
    expect(config.name).toBe('payment_records');
  });

  test('仮名化ID・種類・購入種別・状態・金額・Stripe側のID・同意・発生時刻・記録日時の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'pseudonymous_id',
      'kind',
      'purpose',
      'status',
      'amount',
      'currency',
      'quantity',
      'stripe_reference',
      'related_id',
      'purchase_id',
      'consented_at',
      'consent_version',
      'link_funding_source_group',
      'occurred_at',
      'last_event_at',
      'recorded_at',
      'created_at',
      'updated_at',
    ]);
  });

  test.each([
    {
      name: '決済履歴の種類',
      values: PAYMENT_RECORD_KIND_VALUES,
      expected: EXPECTED_PAYMENT_RECORD_KINDS,
    },
    {
      name: '決済履歴の状態',
      values: PAYMENT_RECORD_STATUS_VALUES,
      expected: EXPECTED_PAYMENT_RECORD_STATUSES,
    },
    {
      name: '通貨',
      values: PAYMENT_CURRENCY_VALUES,
      expected: EXPECTED_CURRENCIES,
    },
  ])(
    '他のテーブルとアプリの一致の検査が使う$nameの一覧をエクスポートする',
    ({ values, expected }) => {
      expect<readonly string[]>([...values]).toEqual(expected);
    },
  );

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

  test('pseudonymous_idは版の検査に使うため、既定値を持たないNOT NULLのテキストになる', () => {
    const pseudonymousId = columnOf('pseudonymous_id');

    expect(pseudonymousId.getSQLType()).toBe('text');
    expect(pseudonymousId.notNull).toBe(true);
    expect(pseudonymousId.hasDefault).toBe(false);
  });

  test('stripe_referenceはNOT NULLのテキストで、既定値を持たない', () => {
    const stripeReference = columnOf('stripe_reference');

    expect(stripeReference.getSQLType()).toBe('text');
    expect(stripeReference.notNull).toBe(true);
    expect(stripeReference.hasDefault).toBe(false);
  });

  test.each([
    'related_id',
    'purchase_id',
    'consent_version',
    'link_funding_source_group',
  ])('%sはNULLを許すテキストで、既定値を持たない', (name) => {
    const column = columnOf(name);

    expect(column.getSQLType()).toBe('text');
    expect(column.notNull).toBe(false);
    expect(column.hasDefault).toBe(false);
  });

  test('amountは返金と引き落としを負で表す最小通貨単位のNOT NULLの整数で、既定値を持たない', () => {
    const amount = columnOf('amount');

    expect(amount.getSQLType()).toBe('integer');
    expect(amount.columnType).toBe('SQLiteInteger');
    expect(amount.notNull).toBe(true);
    expect(amount.hasDefault).toBe(false);
  });

  test('quantityはNULLを許す整数で、既定値を持たない', () => {
    const quantity = columnOf('quantity');

    expect(quantity.getSQLType()).toBe('integer');
    expect(quantity.columnType).toBe('SQLiteInteger');
    expect(quantity.notNull).toBe(false);
    expect(quantity.hasDefault).toBe(false);
  });

  test.each(['occurred_at', 'last_event_at', 'recorded_at'])(
    '%sはUTCミリ秒のNOT NULLの整数で、既定値と更新時の値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
      expect(column.onUpdateFn).toBeUndefined();
    },
  );

  test('consented_atはNULLを許すUTCミリ秒の整数で、既定値を持たない', () => {
    const consentedAt = columnOf('consented_at');

    expect(consentedAt.getSQLType()).toBe('integer');
    expect(modeOf(consentedAt)).toBe('timestamp_ms');
    expect(consentedAt.notNull).toBe(false);
    expect(consentedAt.hasDefault).toBe(false);
  });

  test.each([
    { name: 'kind', values: EXPECTED_PAYMENT_RECORD_KINDS },
    { name: 'purpose', values: EXPECTED_PURCHASE_KINDS },
    { name: 'status', values: EXPECTED_PAYMENT_RECORD_STATUSES },
    { name: 'currency', values: EXPECTED_CURRENCIES },
  ])(
    '$nameは共有定義の値だけを取るNOT NULLのテキストで、既定値を持たない',
    ({ name, values }) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.enumValues).toEqual([...values]);
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

  test('チャージバック以外とチャージバックの段階の一意索引と、利用者ごとの一覧・収益の照会・保持期間の削除のための索引を持つ', () => {
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
        name: 'payment_records_stripe_reference_kind_unique',
        columns: ['stripe_reference', 'kind'],
        unique: true,
        where: `"kind" <> 'dispute'`,
      },
      {
        name: 'payment_records_stripe_reference_kind_status_dispute_unique',
        columns: ['stripe_reference', 'kind', 'status'],
        unique: true,
        where: `"kind" = 'dispute'`,
      },
      {
        name: 'payment_records_pseudonymous_id_occurred_at_id_idx',
        columns: ['pseudonymous_id', 'occurred_at', 'id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'payment_records_occurred_at_idx',
        columns: ['occurred_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'payment_records_recorded_at_idx',
        columns: ['recorded_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('種類・購入種別・状態・通貨を共有定義の値だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'payment_records_kind_check',
        sql: inList('kind', EXPECTED_PAYMENT_RECORD_KINDS),
      },
      {
        name: 'payment_records_purpose_check',
        sql: inList('purpose', EXPECTED_PURCHASE_KINDS),
      },
      {
        name: 'payment_records_status_check',
        sql: inList('status', EXPECTED_PAYMENT_RECORD_STATUSES),
      },
      {
        name: 'payment_records_currency_check',
        sql: inList('currency', EXPECTED_CURRENCIES),
      },
    ]);
  });

  test('利用者の物理削除の後も残すため、仮名化IDを含めてどの列にも外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });
});
