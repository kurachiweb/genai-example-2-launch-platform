import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { reportCases } from './report-cases.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(reportCases);

const dialect = new SQLiteDialect();

const TARGET_KINDS = ['user', 'product', 'comment'];

const STATUSES = ['open', 'in_progress', 'resolved', 'rejected'];

const RESOLUTIONS = ['product.hide', 'comment.hide', 'user.suspend', 'none'];

const NOTICE_STATUSES = ['none', 'pending', 'requested', 'skipped'];

const quoted = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(', ');

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('report_cases', () => {
  test('テーブル名は通報の案件の複数形のスネークケースになる', () => {
    expect(config.name).toBe('report_cases');
  });

  test('対象・状態・受付・完了・照会・投稿者への通知の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'target_kind',
      'target_id',
      'target_owner_user_id',
      'product_id',
      'target_detached_at',
      'status',
      'status_changed_at',
      'last_reported_at',
      'infringement_reported_at',
      'closed_at',
      'resolution',
      'resolution_action_id',
      'closing_reason',
      'poster_notice_status',
      'poster_notice_requested_at',
      'last_inquired_at',
      'last_inquiry_message',
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

  test('target_kindは利用者・プロダクト・コメントだけを取る、既定値を持たないNOT NULLのテキストになる', () => {
    const targetKind = columnOf('target_kind');

    expect(targetKind.getSQLType()).toBe('text');
    expect(targetKind.notNull).toBe(true);
    expect(targetKind.hasDefault).toBe(false);
    expect(targetKind.enumValues).toEqual(TARGET_KINDS);
  });

  test('statusは4つの対応ステータスだけを取るNOT NULLのテキストで、新しい案件は未対応で始まる', () => {
    const status = columnOf('status');

    expect(status.getSQLType()).toBe('text');
    expect(status.notNull).toBe(true);
    expect(status.default).toBe('open');
    expect(status.enumValues).toEqual(STATUSES);
  });

  test('resolutionは3つの措置と措置なしだけを取り、未完了を表すNULLを許すテキストになる', () => {
    const resolution = columnOf('resolution');

    expect(resolution.getSQLType()).toBe('text');
    expect(resolution.notNull).toBe(false);
    expect(resolution.hasDefault).toBe(false);
    expect(resolution.enumValues).toEqual(RESOLUTIONS);
  });

  test('poster_notice_statusは送らない・依頼待ち・依頼済み・送らなかっただけを取るNOT NULLのテキストで、既定は送らないになる', () => {
    const noticeStatus = columnOf('poster_notice_status');

    expect(noticeStatus.getSQLType()).toBe('text');
    expect(noticeStatus.notNull).toBe(true);
    expect(noticeStatus.default).toBe('none');
    expect(noticeStatus.enumValues).toEqual(NOTICE_STATUSES);
  });

  test.each([
    'target_id',
    'target_owner_user_id',
    'product_id',
    'resolution_action_id',
    'closing_reason',
    'last_inquiry_message',
  ])(
    '%sは対象への参照を消した後や未完了・未照会を表すNULLを許すテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test.each(['status_changed_at', 'last_reported_at'])(
    '%sはUTCミリ秒の整数でNOT NULLになり、既定値と更新時の値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
      expect(column.onUpdateFn).toBeUndefined();
    },
  );

  test.each([
    'target_detached_at',
    'infringement_reported_at',
    'closed_at',
    'poster_notice_requested_at',
    'last_inquired_at',
  ])('%sはUTCミリ秒の整数で、無いことを表すNULLを許す', (name) => {
    const column = columnOf(name);

    expect(column.getSQLType()).toBe('integer');
    expect(modeOf(column)).toBe('timestamp_ms');
    expect(column.notNull).toBe(false);
    expect(column.hasDefault).toBe(false);
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

  test('対象・投稿者・対象のプロダクト・措置の記録の物理削除を妨げないよう、外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });

  test('対象ごとの未完了の案件の部分一意索引と、一覧・絞り込み・参照の消去・保持期間の削除の索引を持つ', () => {
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
        name: 'report_cases_target_kind_target_id_open_unique',
        columns: ['target_kind', 'target_id'],
        unique: true,
        where: '"closed_at" is null',
      },
      {
        name: 'report_cases_last_reported_at_id_idx',
        columns: ['last_reported_at', 'id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'report_cases_status_last_reported_at_idx',
        columns: ['status', 'last_reported_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'report_cases_target_owner_user_id_idx',
        columns: ['target_owner_user_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'report_cases_product_id_idx',
        columns: ['product_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'report_cases_closed_at_idx',
        columns: ['closed_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'report_cases_target_detached_at_idx',
        columns: ['target_detached_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('値を限るCHECK制約と、完了の日時・参照の消去の日時・措置の記録のIDの整合のCHECK制約を、値を埋め込んで持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'report_cases_target_kind_check',
        sql: `"target_kind" in (${quoted(TARGET_KINDS)})`,
      },
      {
        name: 'report_cases_status_check',
        sql: `"status" in (${quoted(STATUSES)})`,
      },
      {
        name: 'report_cases_resolution_check',
        sql: `"resolution" in (${quoted(RESOLUTIONS)})`,
      },
      {
        name: 'report_cases_poster_notice_status_check',
        sql: `"poster_notice_status" in (${quoted(NOTICE_STATUSES)})`,
      },
      {
        name: 'report_cases_closed_at_check',
        sql: `("status" in ('resolved', 'rejected')) = ("closed_at" is not null)`,
      },
      {
        name: 'report_cases_target_detached_at_check',
        sql: `("target_id" is null) = ("target_detached_at" is not null)`,
      },
      {
        name: 'report_cases_resolution_action_id_check',
        sql: `("resolution_action_id" is null or ("status" = 'resolved' and "resolution" in ('product.hide', 'comment.hide', 'user.suspend')))`,
      },
    ]);
  });
});
