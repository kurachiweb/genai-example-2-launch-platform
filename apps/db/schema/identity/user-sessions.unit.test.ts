import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { userSessions } from './user-sessions.ts';
import { users } from './users.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(userSessions);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('user_sessions', () => {
  test('テーブル名はセッションの複数形のスネークケースになる', () => {
    expect(config.name).toBe('user_sessions');
  });

  test('利用者・識別子のハッシュ・端末情報・期限の列と共通カラムだけを持ち、IPアドレスの列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'user_id',
      'token_hash',
      'user_agent',
      'last_used_at',
      'absolute_expires_at',
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

  test('user_idは利用者のIDを持つNOT NULLのテキストで、単独では一意にならない', () => {
    const userId = columnOf('user_id');

    expect(userId.getSQLType()).toBe('text');
    expect(userId.notNull).toBe(true);
    expect(userId.isUnique).toBe(false);
    expect(userId.hasDefault).toBe(false);
  });

  test('token_hashは大文字小文字を区別する一意のNOT NULLのテキストになる', () => {
    const tokenHash = columnOf('token_hash');

    expect(tokenHash.getSQLType()).toBe('text');
    expect(tokenHash.notNull).toBe(true);
    expect(tokenHash.isUnique).toBe(true);
    expect(tokenHash.hasDefault).toBe(false);
  });

  test('user_agentはテキストで、端末情報が届かないことを表すNULLを許す', () => {
    const userAgent = columnOf('user_agent');

    expect(userAgent.getSQLType()).toBe('text');
    expect(userAgent.notNull).toBe(false);
    expect(userAgent.hasDefault).toBe(false);
  });

  test.each(['last_used_at', 'absolute_expires_at'])(
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

  test('利用者ごと・アイドル期限・絶対期限の照会に、一意でない索引を持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
    }));

    expect(indexes).toEqual([
      {
        name: 'user_sessions_user_id_idx',
        columns: ['user_id'],
        unique: false,
      },
      {
        name: 'user_sessions_last_used_at_idx',
        columns: ['last_used_at'],
        unique: false,
      },
      {
        name: 'user_sessions_absolute_expires_at_idx',
        columns: ['absolute_expires_at'],
        unique: false,
      },
    ]);
  });
});
