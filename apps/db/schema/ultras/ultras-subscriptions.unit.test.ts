import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import {
  CANCELLATION_SOURCE_VALUES,
  PENDING_CANCELLATION_SOURCE_VALUES,
  STRIPE_SUBSCRIPTION_STATUS_VALUES,
  ultrasSubscriptions,
} from './ultras-subscriptions.ts';

const EXPECTED_STRIPE_SUBSCRIPTION_STATUSES = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
];

const EXPECTED_CANCELLATION_SOURCES = ['user', 'suspension', 'withdrawal'];

const EXPECTED_PENDING_CANCELLATION_SOURCES = ['suspension', 'withdrawal'];

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(ultrasSubscriptions);

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

describe('ultras_subscriptions', () => {
  test('テーブル名はUltrasの加入の複数形のスネークケースになる', () => {
    expect(config.name).toBe('ultras_subscriptions');
  });

  test('Stripe側の値・特典の継続期間・解約の操作の列と共通カラムだけを持ち、導く加入状態と論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'stripe_subscription_id',
      'user_id',
      'purchase_id',
      'stripe_status',
      'cancel_scheduled',
      'cancel_at',
      'current_period_end',
      'ended_at',
      'started_at',
      'benefit_ends_at',
      'benefit_end_fixed',
      'canceled_at',
      'cancellation_source',
      'pending_cancellation_source',
      'past_due_since',
      'created_at',
      'updated_at',
    ]);
  });

  test.each([
    {
      name: 'Stripeの定期課金の状態',
      values: STRIPE_SUBSCRIPTION_STATUS_VALUES,
      expected: EXPECTED_STRIPE_SUBSCRIPTION_STATUSES,
    },
    {
      name: '解約の出どころ',
      values: CANCELLATION_SOURCE_VALUES,
      expected: EXPECTED_CANCELLATION_SOURCES,
    },
    {
      name: '本サービス側の解約の出どころ',
      values: PENDING_CANCELLATION_SOURCE_VALUES,
      expected: EXPECTED_PENDING_CANCELLATION_SOURCES,
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

  test.each(['stripe_subscription_id', 'user_id'])(
    '%sはNOT NULLのテキストで、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('purchase_idは値を限らないテキストで、paymentsの購入に結び付く前のNULLを許す', () => {
    const purchaseId = columnOf('purchase_id');

    expect(purchaseId.getSQLType()).toBe('text');
    expect(purchaseId.notNull).toBe(false);
    expect(purchaseId.enumValues).toBeUndefined();
    expect(purchaseId.hasDefault).toBe(false);
  });

  test('stripe_statusはStripeの定期課金の状態だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const stripeStatus = columnOf('stripe_status');

    expect(stripeStatus.getSQLType()).toBe('text');
    expect(stripeStatus.notNull).toBe(true);
    expect(stripeStatus.enumValues).toEqual(
      EXPECTED_STRIPE_SUBSCRIPTION_STATUSES,
    );
    expect(stripeStatus.hasDefault).toBe(false);
  });

  test.each(['cancel_scheduled', 'benefit_end_fixed'])(
    '%sは真偽を0・1で持つNOT NULLの整数で、既定は偽になる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('boolean');
      expect(column.notNull).toBe(true);
      expect(column.default).toBe(false);
    },
  );

  test.each([
    'cancel_at',
    'current_period_end',
    'ended_at',
    'started_at',
    'benefit_ends_at',
    'canceled_at',
    'past_due_since',
  ])('%sはNULLを許すUTCミリ秒の整数で、既定値を持たない', (name) => {
    const column = columnOf(name);

    expect(column.getSQLType()).toBe('integer');
    expect(modeOf(column)).toBe('timestamp_ms');
    expect(column.notNull).toBe(false);
    expect(column.hasDefault).toBe(false);
    expect(column.onUpdateFn).toBeUndefined();
  });

  test('cancellation_sourceは解約の出どころだけを取り、解約していない加入のNULLを許す', () => {
    const cancellationSource = columnOf('cancellation_source');

    expect(cancellationSource.getSQLType()).toBe('text');
    expect(cancellationSource.notNull).toBe(false);
    expect(cancellationSource.enumValues).toEqual(
      EXPECTED_CANCELLATION_SOURCES,
    );
    expect(cancellationSource.hasDefault).toBe(false);
  });

  test('pending_cancellation_sourceは本サービス側の解約の出どころだけを取り、利用者の操作による解約のNULLを許す', () => {
    const pendingCancellationSource = columnOf('pending_cancellation_source');

    expect(pendingCancellationSource.getSQLType()).toBe('text');
    expect(pendingCancellationSource.notNull).toBe(false);
    expect(pendingCancellationSource.enumValues).toEqual(
      EXPECTED_PENDING_CANCELLATION_SOURCES,
    );
    expect(pendingCancellationSource.hasDefault).toBe(false);
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

  test('定期課金のIDの一意索引、利用者ごとに開始済みで特典の終了時刻が空の加入を1つに限る部分一意索引と、照会のための索引を持つ', () => {
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
        name: 'ultras_subscriptions_stripe_subscription_id_unique',
        columns: ['stripe_subscription_id'],
        unique: true,
        where: undefined,
      },
      {
        name: 'ultras_subscriptions_user_id_benefit_open_unique',
        columns: ['user_id'],
        unique: true,
        where: '"started_at" is not null and "benefit_ends_at" is null',
      },
      {
        name: 'ultras_subscriptions_user_id_started_at_idx',
        columns: ['user_id', 'started_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'ultras_subscriptions_stripe_status_idx',
        columns: ['stripe_status'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('Stripe側の状態と解約の出どころを共有定義の値だけに限り、真偽の列を0・1だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'ultras_subscriptions_stripe_status_check',
        sql: inList('stripe_status', EXPECTED_STRIPE_SUBSCRIPTION_STATUSES),
      },
      {
        name: 'ultras_subscriptions_cancel_scheduled_check',
        sql: '"cancel_scheduled" in (0, 1)',
      },
      {
        name: 'ultras_subscriptions_benefit_end_fixed_check',
        sql: '"benefit_end_fixed" in (0, 1)',
      },
      {
        name: 'ultras_subscriptions_cancellation_source_check',
        sql: inList('cancellation_source', EXPECTED_CANCELLATION_SOURCES),
      },
      {
        name: 'ultras_subscriptions_pending_cancellation_source_check',
        sql: inList(
          'pending_cancellation_source',
          EXPECTED_PENDING_CANCELLATION_SOURCES,
        ),
      },
    ]);
  });

  test('user_idはusersのidを参照し削除時の動作を指定せず、purchase_idは外部キーにしない', () => {
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
