import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import { userFollows } from './user-follows.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(userFollows);

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

describe('user_follows', () => {
  test('テーブル名はフォローの複数形のスネークケースになる', () => {
    expect(config.name).toBe('user_follows');
  });

  test('フォロワー・相手の列と共通カラム・論理削除の列だけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'follower_id',
      'followee_id',
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

  test.each(['follower_id', 'followee_id'])(
    '%sは単独では一意にならないNOT NULLのテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.isUnique).toBe(false);
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

  test('deleted_atは論理削除のUTCミリ秒のNULLを許す列になる', () => {
    const deletedAt = columnOf('deleted_at');

    expect(deletedAt.getSQLType()).toBe('integer');
    expect(modeOf(deletedAt)).toBe('timestamp_ms');
    expect(deletedAt.notNull).toBe(false);
  });

  test('follower_idとfollowee_idはどちらもusersのidを参照し、削除時の動作を指定しない', () => {
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
        columns: ['follower_id'],
        foreignTable: users,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
      {
        columns: ['followee_id'],
        foreignTable: users,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
    ]);
  });

  test('組の一意とフォロワー側・相手側の一覧の索引を持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
    }));

    expect(indexes).toEqual([
      {
        name: 'user_follows_follower_id_followee_id_unique',
        columns: ['follower_id', 'followee_id'],
        unique: true,
      },
      {
        name: 'user_follows_follower_id_created_at_id_idx',
        columns: ['follower_id', 'created_at', 'id'],
        unique: false,
      },
      {
        name: 'user_follows_followee_id_created_at_id_idx',
        columns: ['followee_id', 'created_at', 'id'],
        unique: false,
      },
    ]);
  });

  test('自分自身へのフォローを拒むCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'user_follows_not_self_check',
        sql: `"follower_id" <> "followee_id"`,
      },
    ]);
  });
});
