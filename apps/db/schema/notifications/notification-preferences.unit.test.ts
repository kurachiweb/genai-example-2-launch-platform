import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import { notificationPreferences } from './notification-preferences.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(notificationPreferences);

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

describe('notification_preferences', () => {
  test('テーブル名は受信設定の複数形のスネークケースになる', () => {
    expect(config.name).toBe('notification_preferences');
  });

  test('利用者・通知種別・受信の可否の列と共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'user_id',
      'topic',
      'enabled',
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

  test('enabledは真偽を0・1で持つNOT NULLの整数で、既定値を持たない', () => {
    const enabled = columnOf('enabled');

    expect(enabled.getSQLType()).toBe('integer');
    expect(modeOf(enabled)).toBe('boolean');
    expect(enabled.notNull).toBe(true);
    expect(enabled.hasDefault).toBe(false);
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

  test('user_idだけがusersのidを参照し、削除時の動作を指定しない', () => {
    expect(config.foreignKeys).toHaveLength(1);
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'user_id',
    ]);
    expect(reference?.foreignTable).toBe(users);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      'id',
    ]);
    expect(foreignKey?.onDelete).toBeUndefined();
  });

  test('利用者と種別で1行に限る一意索引と、種別ごとに受信する利用者を読む索引を持つ', () => {
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
        name: 'notification_preferences_user_id_topic_unique',
        columns: ['user_id', 'topic'],
        unique: true,
        where: undefined,
      },
      {
        name: 'notification_preferences_topic_enabled_user_id_idx',
        columns: ['topic', 'enabled', 'user_id'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('種別を決まった値に、受信の可否を0・1に限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'notification_preferences_topic_check',
        sql: `"topic" in ('match_preview', 'match_result', 'followed_user_match', 'followed_user_award')`,
      },
      {
        name: 'notification_preferences_enabled_check',
        sql: '"enabled" in (0, 1)',
      },
    ]);
  });
});
