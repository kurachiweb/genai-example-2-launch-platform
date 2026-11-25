import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import { productLaunches } from '../product/product-launches.ts';
import { products } from '../product/products.ts';
import { weekTournamentEntries } from './week-tournament-entries.ts';
import { weekTournaments } from './week-tournaments.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(weekTournamentEntries);

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

describe('week_tournament_entries', () => {
  test('テーブル名は週のトーナメントの参加の枠の複数形のスネークケースになる', () => {
    expect(config.name).toBe('week_tournament_entries');
  });

  test('トーナメント・紐付け・予選の写し・状態・参加資格・終了・返金・返金の知らせの列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'tournament_id',
      'launch_id',
      'product_id',
      'owner_user_id',
      'launch_date',
      'qualifier_match_id',
      'qualifier_upvote_count',
      'qualifier_last_upvote_elapsed_ms',
      'won_at',
      'status',
      'entitlement_source',
      'purchase_id',
      'entitled_at',
      'closed_at',
      'close_reason',
      'refund_status',
      'refund_requested_at',
      'refund_notice_status',
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

  test.each(['tournament_id', 'launch_date', 'qualifier_match_id'])(
    '%sはNOT NULLのテキストで、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test.each(['launch_id', 'product_id', 'owner_user_id'])(
    '%sは紐付けの解除を表すNULLを許すテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('qualifier_upvote_countは予選の確定したUpvote数を持つNOT NULLの数値の整数で、既定値を持たない', () => {
    const upvoteCount = columnOf('qualifier_upvote_count');

    expect(upvoteCount.getSQLType()).toBe('integer');
    expect(upvoteCount.columnType).toBe('SQLiteInteger');
    expect(upvoteCount.notNull).toBe(true);
    expect(upvoteCount.hasDefault).toBe(false);
  });

  test('qualifier_last_upvote_elapsed_msは最終Upvoteまでの経過ミリ秒の数値の整数で、Upvoteが無いことを表すNULLを許す', () => {
    const elapsed = columnOf('qualifier_last_upvote_elapsed_ms');

    expect(elapsed.getSQLType()).toBe('integer');
    expect(elapsed.columnType).toBe('SQLiteInteger');
    expect(elapsed.notNull).toBe(false);
    expect(elapsed.hasDefault).toBe(false);
  });

  test('won_atはUTCミリ秒の整数でNOT NULLになり、既定値を持たない', () => {
    const wonAt = columnOf('won_at');

    expect(wonAt.getSQLType()).toBe('integer');
    expect(modeOf(wonAt)).toBe('timestamp_ms');
    expect(wonAt.notNull).toBe(true);
    expect(wonAt.hasDefault).toBe(false);
  });

  test.each(['entitled_at', 'closed_at', 'refund_requested_at'])(
    '%sはUTCミリ秒の整数で、まだ起きていないことを表すNULLを許す',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('statusは6つの状態だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const status = columnOf('status');

    expect(status.getSQLType()).toBe('text');
    expect(status.notNull).toBe(true);
    expect(status.enumValues).toEqual([
      'awaiting_payment',
      'entitled',
      'drawn',
      'expired',
      'forfeited',
      'excluded',
    ]);
    expect(status.hasDefault).toBe(false);
  });

  test('entitlement_sourceは決済・Ultrasだけを取り、参加資格が無いことを表すNULLを許すテキストになる', () => {
    const source = columnOf('entitlement_source');

    expect(source.getSQLType()).toBe('text');
    expect(source.notNull).toBe(false);
    expect(source.enumValues).toEqual(['payment', 'ultras']);
    expect(source.hasDefault).toBe(false);
  });

  test('purchase_idは決済の購入のIDを持ち、決済でないことを表すNULLを許すテキストになる', () => {
    const purchaseId = columnOf('purchase_id');

    expect(purchaseId.getSQLType()).toBe('text');
    expect(purchaseId.notNull).toBe(false);
    expect(purchaseId.hasDefault).toBe(false);
  });

  test('close_reasonは5つの理由だけを取り、終わっていないことを表すNULLを許すテキストになる', () => {
    const closeReason = columnOf('close_reason');

    expect(closeReason.getSQLType()).toBe('text');
    expect(closeReason.notNull).toBe(false);
    expect(closeReason.enumValues).toEqual([
      'deadline',
      'deleted',
      'withdrawn',
      'hidden_or_suspended',
      'late_entry',
    ]);
    expect(closeReason.hasDefault).toBe(false);
  });

  test('refund_statusは返金済みと拒否を含む6つの値だけを取るNOT NULLのテキストで、既定値はnoneになる', () => {
    const refundStatus = columnOf('refund_status');

    expect(refundStatus.getSQLType()).toBe('text');
    expect(refundStatus.notNull).toBe(true);
    expect(refundStatus.enumValues).toEqual([
      'none',
      'pending',
      'requested',
      'not_needed',
      'already_refunded',
      'rejected',
    ]);
    expect(refundStatus.default).toBe('none');
  });

  test('refund_notice_statusは4つの値だけを取るNOT NULLのテキストで、既定値はnoneになる', () => {
    const noticeStatus = columnOf('refund_notice_status');

    expect(noticeStatus.getSQLType()).toBe('text');
    expect(noticeStatus.notNull).toBe(true);
    expect(noticeStatus.enumValues).toEqual([
      'none',
      'pending',
      'sent',
      'skipped',
    ]);
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

  test('トーナメント・ローンチ・プロダクト・投稿者のIDが外部キーで、削除時の動作を指定せず、予選のマッチと購入のIDは外部キーを持たない', () => {
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
        columns: ['tournament_id'],
        foreignTable: weekTournaments,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
      {
        columns: ['launch_id'],
        foreignTable: productLaunches,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
      {
        columns: ['product_id'],
        foreignTable: products,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
      {
        columns: ['owner_user_id'],
        foreignTable: users,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
    ]);
  });

  test('ローンチの一意索引・週ごとのプロダクトの一意索引と、照会と再処理の索引を持つ', () => {
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
        name: 'week_tournament_entries_launch_id_unique',
        columns: ['launch_id'],
        unique: true,
        where: undefined,
      },
      {
        name: 'week_tournament_entries_tournament_id_product_id_unique',
        columns: ['tournament_id', 'product_id'],
        unique: true,
        where: undefined,
      },
      {
        name: 'week_tournament_entries_owner_user_id_status_idx',
        columns: ['owner_user_id', 'status'],
        unique: false,
        where: undefined,
      },
      {
        name: 'week_tournament_entries_tournament_id_status_idx',
        columns: ['tournament_id', 'status'],
        unique: false,
        where: undefined,
      },
      {
        name: 'week_tournament_entries_refund_status_updated_at_idx',
        columns: ['refund_status', 'updated_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'week_tournament_entries_refund_notice_status_updated_at_idx',
        columns: ['refund_notice_status', 'updated_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('状態・出どころ・理由・返金・知らせを決まった値だけに限り、参加資格の状態なら出どころを、決済なら購入を必須にするCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'week_tournament_entries_status_check',
        sql: `"status" in ('awaiting_payment', 'entitled', 'drawn', 'expired', 'forfeited', 'excluded')`,
      },
      {
        name: 'week_tournament_entries_entitlement_source_check',
        sql: `"entitlement_source" in ('payment', 'ultras')`,
      },
      {
        name: 'week_tournament_entries_close_reason_check',
        sql: `"close_reason" in ('deadline', 'deleted', 'withdrawn', 'hidden_or_suspended', 'late_entry')`,
      },
      {
        name: 'week_tournament_entries_refund_status_check',
        sql: `"refund_status" in ('none', 'pending', 'requested', 'not_needed', 'already_refunded', 'rejected')`,
      },
      {
        name: 'week_tournament_entries_refund_notice_status_check',
        sql: `"refund_notice_status" in ('none', 'pending', 'sent', 'skipped')`,
      },
      {
        name: 'week_tournament_entries_entitled_source_check',
        sql: `("status" not in ('entitled', 'drawn') or "entitlement_source" is not null)`,
      },
      {
        name: 'week_tournament_entries_payment_purchase_check',
        sql: `("entitlement_source" is null or "entitlement_source" <> 'payment' or "purchase_id" is not null)`,
      },
    ]);
  });
});
