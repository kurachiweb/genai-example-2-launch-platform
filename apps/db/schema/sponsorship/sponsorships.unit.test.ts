import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import { products } from '../product/products.ts';
import { sponsorships } from './sponsorships.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(sponsorships);

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

const NOTICE_VALUES = ['none', 'pending', 'requested', 'skipped'];

const REFUND_STATUS_VALUES = [
  'none',
  'requested',
  'not_needed',
  'already_refunded',
  'rejected',
];

describe('sponsorships', () => {
  test('テーブル名は申込の複数形のスネークケースになる', () => {
    expect(config.name).toBe('sponsorships');
  });

  test('申込・掲載権・強制終了・通知・プロダクトの論理削除・2つの返金の列と共通カラムと論理削除の列を持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'user_id',
      'product_id',
      'tier',
      'starts_on',
      'ends_on',
      'days',
      'state',
      'purchase_id',
      'payment_record_id',
      'amount_total',
      'paid_at',
      'terminated_at',
      'termination_reason',
      'start_notice',
      'end_notice',
      'termination_notice',
      'product_deleted_at',
      'termination_refund_status',
      'termination_refund_days',
      'termination_refund_amount',
      'termination_refund_request_id',
      'stop_refund_status',
      'stop_refund_days',
      'stop_refund_amount',
      'stop_refund_request_id',
      'created_at',
      'updated_at',
      'deleted_at',
    ]);
  });

  test('idはULIDを採番するテキストの主キーになる', () => {
    const id = columnOf('id');

    expect(id.getSQLType()).toBe('text');
    expect(id.primary).toBe(true);
    expect(id.defaultFn?.()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test.each(['user_id', 'product_id', 'starts_on', 'ends_on'])(
    '%sはNOT NULLのテキストで、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('tierは3つのティアだけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const tier = columnOf('tier');

    expect(tier.getSQLType()).toBe('text');
    expect(tier.notNull).toBe(true);
    expect(tier.enumValues).toEqual(['legend', 'gold', 'silver']);
    expect(tier.hasDefault).toBe(false);
  });

  test('stateは保存の3つの状態だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const state = columnOf('state');

    expect(state.getSQLType()).toBe('text');
    expect(state.notNull).toBe(true);
    expect(state.enumValues).toEqual(['pending_payment', 'paid', 'terminated']);
    expect(state.hasDefault).toBe(false);
  });

  test('daysは掲載期間の日数を持つNOT NULLの数値の整数で、既定値を持たない', () => {
    const days = columnOf('days');

    expect(days.getSQLType()).toBe('integer');
    expect(days.columnType).toBe('SQLiteInteger');
    expect(days.notNull).toBe(true);
    expect(days.hasDefault).toBe(false);
  });

  test.each([
    'purchase_id',
    'payment_record_id',
    'termination_reason',
    'termination_refund_request_id',
    'stop_refund_request_id',
  ])('%sはまだ値が無いことを表すNULLを許すテキストになる', (name) => {
    const column = columnOf(name);

    expect(column.getSQLType()).toBe('text');
    expect(column.notNull).toBe(false);
    expect(column.hasDefault).toBe(false);
  });

  test.each([
    'amount_total',
    'termination_refund_days',
    'termination_refund_amount',
    'stop_refund_days',
    'stop_refund_amount',
  ])('%sは数値の整数で、まだ値が無いことを表すNULLを許す', (name) => {
    const column = columnOf(name);

    expect(column.getSQLType()).toBe('integer');
    expect(column.columnType).toBe('SQLiteInteger');
    expect(column.notNull).toBe(false);
    expect(column.hasDefault).toBe(false);
  });

  test.each(['paid_at', 'terminated_at', 'product_deleted_at', 'deleted_at'])(
    '%sはUTCミリ秒の整数で、まだ起きていないことを表すNULLを許す',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test.each(['start_notice', 'end_notice', 'termination_notice'])(
    '%sは4つの値だけを取るNOT NULLのテキストで、既定値はnoneになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.enumValues).toEqual(NOTICE_VALUES);
      expect(column.default).toBe('none');
    },
  );

  test.each(['termination_refund_status', 'stop_refund_status'])(
    '%sは返金不要・返金済み・拒否を含む5つの値だけを取るNOT NULLのテキストで、既定値はnoneになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.enumValues).toEqual(REFUND_STATUS_VALUES);
      expect(column.default).toBe('none');
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

  test('利用者とプロダクトのIDが外部キーで削除時の動作を指定せず、購入・決済履歴の記録・返金の依頼のIDは外部キーを持たない', () => {
    const foreignKeys = config.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference();
      return {
        columns: reference.columns.map((column) => column.name),
        foreignTable: reference.foreignTable,
        foreignColumns: reference.foreignColumns.map((column) => column.name),
        onDelete: foreignKey.onDelete,
      };
    });

    expect(foreignKeys).toEqual([
      {
        columns: ['user_id'],
        foreignTable: users,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
      {
        columns: ['product_id'],
        foreignTable: products,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
    ]);
  });

  test('表示・自分の一覧・重なり・作成順の索引と、通知の依頼待ちと未精算か終了通知の未依頼の決済済みの部分索引を持つ', () => {
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
        name: 'sponsorships_display_idx',
        columns: ['state', 'starts_on', 'ends_on'],
        unique: false,
        where: undefined,
      },
      {
        name: 'sponsorships_user_idx',
        columns: ['user_id', 'created_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'sponsorships_product_tier_idx',
        columns: ['product_id', 'tier', 'state'],
        unique: false,
        where: undefined,
      },
      {
        name: 'sponsorships_created_idx',
        columns: ['created_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'sponsorships_unsettled_end_idx',
        columns: ['ends_on'],
        unique: false,
        where: `("state" = 'paid' and "deleted_at" is null and ("stop_refund_status" = 'none' or "end_notice" = 'none'))`,
      },
      {
        name: 'sponsorships_pending_notice_idx',
        columns: ['updated_at'],
        unique: false,
        where: `("start_notice" = 'pending' or "end_notice" = 'pending' or "termination_notice" = 'pending')`,
      },
    ]);
  });

  test('ティア・状態・3つの通知・2つの返金の状態を決まった値に限り、日数を1〜366に、決済済みと強制終了の行に必要な列を必須にするCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'sponsorships_tier_check',
        sql: `"tier" in ('legend', 'gold', 'silver')`,
      },
      {
        name: 'sponsorships_state_check',
        sql: `"state" in ('pending_payment', 'paid', 'terminated')`,
      },
      {
        name: 'sponsorships_start_notice_check',
        sql: `"start_notice" in ('none', 'pending', 'requested', 'skipped')`,
      },
      {
        name: 'sponsorships_end_notice_check',
        sql: `"end_notice" in ('none', 'pending', 'requested', 'skipped')`,
      },
      {
        name: 'sponsorships_termination_notice_check',
        sql: `"termination_notice" in ('none', 'pending', 'requested', 'skipped')`,
      },
      {
        name: 'sponsorships_termination_refund_status_check',
        sql: `"termination_refund_status" in ('none', 'requested', 'not_needed', 'already_refunded', 'rejected')`,
      },
      {
        name: 'sponsorships_stop_refund_status_check',
        sql: `"stop_refund_status" in ('none', 'requested', 'not_needed', 'already_refunded', 'rejected')`,
      },
      {
        name: 'sponsorships_days_range_check',
        sql: `"days" between 1 and 366`,
      },
      {
        name: 'sponsorships_paid_columns_check',
        sql: `("state" not in ('paid', 'terminated') or ("purchase_id" is not null and "payment_record_id" is not null and "amount_total" is not null and "paid_at" is not null))`,
      },
      {
        name: 'sponsorships_terminated_columns_check',
        sql: `("state" <> 'terminated' or ("terminated_at" is not null and "termination_reason" is not null))`,
      },
    ]);
  });
});
