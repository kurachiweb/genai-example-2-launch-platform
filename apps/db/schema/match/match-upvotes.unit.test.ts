import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import { matchEntries } from './match-entries.ts';
import { matchUpvotes } from './match-upvotes.ts';
import { matches } from './matches.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(matchUpvotes);

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

describe('match_upvotes', () => {
  test('テーブル名はマッチのUpvoteの複数形のスネークケースになる', () => {
    expect(config.name).toBe('match_upvotes');
  });

  test('マッチ・側・利用者・実施日・Upvoteの日時・記録の順の列と、論理削除を含む共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'match_id',
      'entry_id',
      'user_id',
      'match_date',
      'upvoted_at',
      'seq',
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

  test.each(['match_id', 'entry_id', 'user_id', 'match_date'])(
    '%sは単独では一意にならず既定値を持たないNOT NULLのテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.isUnique).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('upvoted_atはUTCミリ秒の整数でNOT NULLになり、既定値と更新時の値を持たない', () => {
    const upvotedAt = columnOf('upvoted_at');

    expect(upvotedAt.getSQLType()).toBe('integer');
    expect(modeOf(upvotedAt)).toBe('timestamp_ms');
    expect(upvotedAt.notNull).toBe(true);
    expect(upvotedAt.hasDefault).toBe(false);
    expect(upvotedAt.onUpdateFn).toBeUndefined();
  });

  test('seqは既定値を持たないNOT NULLの数値の整数になる', () => {
    const seq = columnOf('seq');

    expect(seq.getSQLType()).toBe('integer');
    expect(seq.columnType).toBe('SQLiteInteger');
    expect(seq.notNull).toBe(true);
    expect(seq.hasDefault).toBe(false);
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

  test('deleted_atは論理削除の共通カラムで、未削除を表すNULLを許すUTCミリ秒の整数になる', () => {
    const deletedAt = columnOf('deleted_at');

    expect(deletedAt.getSQLType()).toBe('integer');
    expect(modeOf(deletedAt)).toBe('timestamp_ms');
    expect(deletedAt.notNull).toBe(false);
    expect(deletedAt.hasDefault).toBe(false);
  });

  test('マッチ・側・利用者のIDがそれぞれのidを参照し、削除時の動作を指定しない', () => {
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
        columns: ['match_id'],
        foreignTable: matches,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
      {
        columns: ['entry_id'],
        foreignTable: matchEntries,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
      {
        columns: ['user_id'],
        foreignTable: users,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
    ]);
  });

  test('有効なUpvoteをマッチと利用者で1つに限る部分一意索引と、側・利用者・記録の順の照会の索引を持つ', () => {
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
        name: 'match_upvotes_match_id_user_id_active_unique',
        columns: ['match_id', 'user_id'],
        unique: true,
        where: `"deleted_at" is null`,
      },
      {
        name: 'match_upvotes_entry_id_deleted_at_upvoted_at_seq_idx',
        columns: ['entry_id', 'deleted_at', 'upvoted_at', 'seq'],
        unique: false,
        where: undefined,
      },
      {
        name: 'match_upvotes_user_id_deleted_at_match_date_upvoted_at_id_idx',
        columns: ['user_id', 'deleted_at', 'match_date', 'upvoted_at', 'id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'match_upvotes_match_id_seq_idx',
        columns: ['match_id', 'seq'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('CHECK制約を持たない', () => {
    expect(config.checks).toEqual([]);
  });
});
