import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { moderationActions } from './moderation-actions.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(moderationActions);

const dialect = new SQLiteDialect();

const ACTIONS = [
  'user.suspend',
  'user.unsuspend',
  'user.administrative-withdraw',
  'product.hide',
  'product.unhide',
  'comment.hide',
  'comment.unhide',
  'rating.invalidate',
  'rating.revalidate',
  'image.approve',
  'image.quarantine',
  'image.release',
  'image.delete',
];

const TARGET_KINDS = ['user', 'product', 'comment', 'rating', 'image'];

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

describe('moderation_actions', () => {
  test('テーブル名は措置の記録の複数形のスネークケースになる', () => {
    expect(config.name).toBe('moderation_actions');
  });

  test('措置の種類・対象・関わる利用者とプロダクト・操作者・理由・イベント・日時・通知の状態の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'action',
      'target_kind',
      'target_id',
      'subject_user_id',
      'product_id',
      'operator_admin_id',
      'reason',
      'lifecycle_event_id',
      'occurred_at',
      'notice_status',
      'notice_requested_at',
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

  test('actionは13種の措置だけを取る、既定値を持たないNOT NULLのテキストになる', () => {
    const action = columnOf('action');

    expect(action.getSQLType()).toBe('text');
    expect(action.notNull).toBe(true);
    expect(action.hasDefault).toBe(false);
    expect(action.enumValues).toEqual(ACTIONS);
  });

  test('target_kindは利用者・プロダクト・コメント・評価・画像だけを取る、既定値を持たないNOT NULLのテキストになる', () => {
    const targetKind = columnOf('target_kind');

    expect(targetKind.getSQLType()).toBe('text');
    expect(targetKind.notNull).toBe(true);
    expect(targetKind.hasDefault).toBe(false);
    expect(targetKind.enumValues).toEqual(TARGET_KINDS);
  });

  test('notice_statusは送らない・依頼待ち・依頼済み・送らなかっただけを取り、措置ごとに書き込む側が決めるため既定値を持たないNOT NULLのテキストになる', () => {
    const noticeStatus = columnOf('notice_status');

    expect(noticeStatus.getSQLType()).toBe('text');
    expect(noticeStatus.notNull).toBe(true);
    expect(noticeStatus.hasDefault).toBe(false);
    expect(noticeStatus.enumValues).toEqual(NOTICE_STATUSES);
  });

  test.each(['target_id', 'operator_admin_id'])(
    '%sは既定値を持たないNOT NULLのテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test.each(['subject_user_id', 'product_id', 'reason', 'lifecycle_event_id'])(
    '%sは措置によって無いことを表すNULLを許すテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('occurred_atはUTCミリ秒の整数でNOT NULLになり、既定値と更新時の値を持たない', () => {
    const occurredAt = columnOf('occurred_at');

    expect(occurredAt.getSQLType()).toBe('integer');
    expect(modeOf(occurredAt)).toBe('timestamp_ms');
    expect(occurredAt.notNull).toBe(true);
    expect(occurredAt.hasDefault).toBe(false);
    expect(occurredAt.onUpdateFn).toBeUndefined();
  });

  test('notice_requested_atはUTCミリ秒の整数で、依頼していないことを表すNULLを許す', () => {
    const noticeRequestedAt = columnOf('notice_requested_at');

    expect(noticeRequestedAt.getSQLType()).toBe('integer');
    expect(modeOf(noticeRequestedAt)).toBe('timestamp_ms');
    expect(noticeRequestedAt.notNull).toBe(false);
    expect(noticeRequestedAt.hasDefault).toBe(false);
  });

  test.each(['created_at', 'updated_at'])(
    '通知の状態を更新するため、%sは共通カラムのUTCミリ秒のNOT NULLの列になる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(true);
      expect(column.defaultFn?.()).toBeInstanceOf(Date);
    },
  );

  test('記録が利用者・プロダクト・コメント・評価・画像・管理者・イベントの物理削除を妨げないよう、外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });

  test('対象ごとの最新・依頼待ちの通知・利用者とプロダクトごとの削除・期限切れの削除の照会の索引を持つ', () => {
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
        name: 'moderation_actions_target_kind_target_id_occurred_at_idx',
        columns: ['target_kind', 'target_id', 'occurred_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'moderation_actions_notice_status_occurred_at_idx',
        columns: ['notice_status', 'occurred_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'moderation_actions_subject_user_id_idx',
        columns: ['subject_user_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'moderation_actions_product_id_idx',
        columns: ['product_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'moderation_actions_occurred_at_idx',
        columns: ['occurred_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('措置の種類・対象の種類・通知の状態を決まった値だけに限るCHECK制約を、値を埋め込んで持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'moderation_actions_action_check',
        sql: `"action" in (${quoted(ACTIONS)})`,
      },
      {
        name: 'moderation_actions_target_kind_check',
        sql: `"target_kind" in (${quoted(TARGET_KINDS)})`,
      },
      {
        name: 'moderation_actions_notice_status_check',
        sql: `"notice_status" in (${quoted(NOTICE_STATUSES)})`,
      },
    ]);
  });
});
