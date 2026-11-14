import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import { notificationNotices } from './notification-notices.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(notificationNotices);

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

describe('notification_notices', () => {
  test('テーブル名は通知の複数形のスネークケースになる', () => {
    expect(config.name).toBe('notification_notices');
  });

  test('重複のキー・枠・まとめのキー・種別・宛先・出どころ・状態・理由・送信要求・確定の列と共通カラムの16列だけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'dedupe_key',
      'slot_key',
      'group_key',
      'topic',
      'recipient_user_id',
      'match_id',
      'entry_id',
      'product_id',
      'event_id',
      'status',
      'skip_reason',
      'email_request_id',
      'settled_at',
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

  test.each(['dedupe_key', 'slot_key', 'group_key', 'recipient_user_id'])(
    '%sは既定値を持たないNOT NULLのテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test.each([
    'match_id',
    'entry_id',
    'product_id',
    'event_id',
    'email_request_id',
  ])('%sは無いことを表すNULLを許すテキストになる', (name) => {
    const column = columnOf(name);

    expect(column.getSQLType()).toBe('text');
    expect(column.notNull).toBe(false);
    expect(column.hasDefault).toBe(false);
  });

  test('topicは4つの通知種別だけを順に取るNOT NULLのテキストで、既定値を持たない', () => {
    const topic = columnOf('topic');

    expect(topic.getSQLType()).toBe('text');
    expect(topic.notNull).toBe(true);
    expect(topic.enumValues).toEqual([
      'match_preview',
      'match_result',
      'followed_user_match',
      'followed_user_award',
    ]);
    expect(topic.hasDefault).toBe(false);
  });

  test('statusは未送信・送信済み・送らないだけを取るNOT NULLのテキストで、既定値は未送信になる', () => {
    const status = columnOf('status');

    expect(status.getSQLType()).toBe('text');
    expect(status.notNull).toBe(true);
    expect(status.enumValues).toEqual(['pending', 'sent', 'skipped']);
    expect(status.default).toBe('pending');
  });

  test('skip_reasonは送らない理由だけを取り、送らないと決まっていないことを表すNULLを許すテキストになる', () => {
    const skipReason = columnOf('skip_reason');

    expect(skipReason.getSQLType()).toBe('text');
    expect(skipReason.notNull).toBe(false);
    expect(skipReason.enumValues).toEqual([
      'topic_disabled',
      'recipient_unavailable',
      'email_not_verified',
      'suppressed',
      'sender_info_missing',
      'own_product_unavailable',
      'stale',
      'recipient_withdrawn',
      'send_rejected',
      'expired',
    ]);
    expect(skipReason.hasDefault).toBe(false);
  });

  test('settled_atはUTCミリ秒の整数で、未確定を表すNULLを許す', () => {
    const settledAt = columnOf('settled_at');

    expect(settledAt.getSQLType()).toBe('integer');
    expect(modeOf(settledAt)).toBe('timestamp_ms');
    expect(settledAt.notNull).toBe(false);
    expect(settledAt.hasDefault).toBe(false);
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

  test('recipient_user_idだけがusersのidを参照し、削除時の動作を指定せず、マッチ・プロダクト・通知イベント・枠へは外部キーを持たない', () => {
    expect(config.foreignKeys).toHaveLength(1);
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'recipient_user_id',
    ]);
    expect(reference?.foreignTable).toBe(users);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      'id',
    ]);
    expect(foreignKey?.onDelete).toBeUndefined();
  });

  test('重複のキーの一意索引と、まとめの読み取り・宛先ごとの削除・確定した記録の削除の索引を持つ', () => {
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
        name: 'notification_notices_dedupe_key_unique',
        columns: ['dedupe_key'],
        unique: true,
        where: undefined,
      },
      {
        name: 'notification_notices_slot_key_status_group_key_id_idx',
        columns: ['slot_key', 'status', 'group_key', 'id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'notification_notices_recipient_user_id_idx',
        columns: ['recipient_user_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'notification_notices_status_settled_at_idx',
        columns: ['status', 'settled_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('種別・状態・送らない理由を決まった値だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'notification_notices_topic_check',
        sql: `"topic" in ('match_preview', 'match_result', 'followed_user_match', 'followed_user_award')`,
      },
      {
        name: 'notification_notices_status_check',
        sql: `"status" in ('pending', 'sent', 'skipped')`,
      },
      {
        name: 'notification_notices_skip_reason_check',
        sql: `"skip_reason" in ('topic_disabled', 'recipient_unavailable', 'email_not_verified', 'suppressed', 'sender_info_missing', 'own_product_unavailable', 'stale', 'recipient_withdrawn', 'send_rejected', 'expired')`,
      },
    ]);
  });
});
