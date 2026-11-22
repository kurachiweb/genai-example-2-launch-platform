import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import { dataExports } from './data-exports.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(dataExports);

const dialect = new SQLiteDialect();

const STATUSES = ['queued', 'generating', 'ready', 'expired', 'failed'];

const FAILURE_KINDS = ['error', 'too_large'];

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

describe('data_exports', () => {
  test('テーブル名はデータエクスポートの要求の複数形のスネークケースになる', () => {
    expect(config.name).toBe('data_exports');
  });

  test('要求・状態・リース・アップロード・ZIP・完了と期限と失敗・通知の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'user_id',
      'status',
      'requested_at',
      'run_token',
      'lease_expires_at',
      'attempts',
      'upload_id',
      'object_key',
      'file_name',
      'byte_size',
      'completed_at',
      'expires_at',
      'failed_at',
      'failure_kind',
      'notice_status',
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

  test('user_idは既定値を持たないNOT NULLのテキストになる', () => {
    const userId = columnOf('user_id');

    expect(userId.getSQLType()).toBe('text');
    expect(userId.notNull).toBe(true);
    expect(userId.hasDefault).toBe(false);
  });

  test('statusは5つの状態だけを取る既定値を持たないNOT NULLのテキストになる', () => {
    const status = columnOf('status');

    expect(status.getSQLType()).toBe('text');
    expect(status.notNull).toBe(true);
    expect(status.hasDefault).toBe(false);
    expect(status.enumValues).toEqual(STATUSES);
  });

  test('failure_kindは失敗の2種類だけを取り、失敗していないことを表すNULLを許すテキストになる', () => {
    const failureKind = columnOf('failure_kind');

    expect(failureKind.getSQLType()).toBe('text');
    expect(failureKind.notNull).toBe(false);
    expect(failureKind.hasDefault).toBe(false);
    expect(failureKind.enumValues).toEqual(FAILURE_KINDS);
  });

  test('notice_statusは送らない・依頼待ち・依頼済み・送らなかっただけを取るNOT NULLのテキストで、既定は送らないになる', () => {
    const noticeStatus = columnOf('notice_status');

    expect(noticeStatus.getSQLType()).toBe('text');
    expect(noticeStatus.notNull).toBe(true);
    expect(noticeStatus.default).toBe('none');
    expect(noticeStatus.enumValues).toEqual(NOTICE_STATUSES);
  });

  test('attemptsは既定が0のNOT NULLの整数になる', () => {
    const attempts = columnOf('attempts');

    expect(attempts.getSQLType()).toBe('integer');
    expect(attempts.notNull).toBe(true);
    expect(attempts.default).toBe(0);
  });

  test.each(['run_token', 'upload_id', 'object_key', 'file_name'])(
    '%sは未生成や削除後を表すNULLを許す、既定値を持たないテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('byte_sizeはZIPの大きさを持つ、NULLを許す整数になる', () => {
    const byteSize = columnOf('byte_size');

    expect(byteSize.getSQLType()).toBe('integer');
    expect(byteSize.notNull).toBe(false);
    expect(byteSize.hasDefault).toBe(false);
  });

  test('requested_atはUTCミリ秒の整数でNOT NULLになり、既定値と更新時の値を持たない', () => {
    const requestedAt = columnOf('requested_at');

    expect(requestedAt.getSQLType()).toBe('integer');
    expect(modeOf(requestedAt)).toBe('timestamp_ms');
    expect(requestedAt.notNull).toBe(true);
    expect(requestedAt.hasDefault).toBe(false);
    expect(requestedAt.onUpdateFn).toBeUndefined();
  });

  test.each(['lease_expires_at', 'completed_at', 'expires_at', 'failed_at'])(
    '%sはUTCミリ秒の整数で、無いことを表すNULLを許す',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(false);
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

  test('本人の一覧・期限切れの走査・失敗に残るアップロードの破棄・滞留の走査・通知の走査の5つの索引を持ち、一意の索引を持たない', () => {
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
        name: 'data_exports_user_id_requested_at_idx',
        columns: ['user_id', 'requested_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'data_exports_status_expires_at_idx',
        columns: ['status', 'expires_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'data_exports_status_upload_id_idx',
        columns: ['status', 'upload_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'data_exports_status_requested_at_idx',
        columns: ['status', 'requested_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'data_exports_notice_status_updated_at_idx',
        columns: ['notice_status', 'updated_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('値を限るCHECK制約と、完了・期限切れ・失敗の整合のCHECK制約を、値を埋め込んで持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'data_exports_status_check',
        sql: `"status" in (${quoted(STATUSES)})`,
      },
      {
        name: 'data_exports_failure_kind_check',
        sql: `"failure_kind" in (${quoted(FAILURE_KINDS)})`,
      },
      {
        name: 'data_exports_notice_status_check',
        sql: `"notice_status" in (${quoted(NOTICE_STATUSES)})`,
      },
      {
        name: 'data_exports_ready_check',
        sql: `("status" <> 'ready' or ("object_key" is not null and "file_name" is not null and "byte_size" is not null and "completed_at" is not null and "expires_at" is not null and "upload_id" is null))`,
      },
      {
        name: 'data_exports_expired_check',
        sql: `("status" <> 'expired' or ("file_name" is not null and "byte_size" is not null and "completed_at" is not null and "expires_at" is not null and "object_key" is null and "upload_id" is null))`,
      },
      {
        name: 'data_exports_failed_check',
        sql: `("status" <> 'failed' or ("failed_at" is not null and "failure_kind" is not null))`,
      },
    ]);
  });
});
