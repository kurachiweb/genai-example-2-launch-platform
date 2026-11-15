import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import { inquiryCategories } from './inquiry-categories.ts';
import { memberInquiries } from './member-inquiries.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(memberInquiries);

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

describe('member_inquiries', () => {
  test('テーブル名はログインの問い合わせの複数形のスネークケースになる', () => {
    expect(config.name).toBe('member_inquiries');
  });

  test('利用者・カテゴリ・ステータス・最後のメッセージの日時の列と共通カラム・論理削除の列を持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'user_id',
      'category_id',
      'status',
      'status_changed_at',
      'last_message_at',
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

  test.each(['user_id', 'category_id'])(
    '%sは一意でないNOT NULLのテキストで、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.isUnique).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('statusは4つの対応ステータスだけを取るNOT NULLのテキストで、既定は未対応になる', () => {
    const status = columnOf('status');

    expect(status.getSQLType()).toBe('text');
    expect(status.notNull).toBe(true);
    expect(status.enumValues).toEqual([
      'open',
      'in_progress',
      'resolved',
      'rejected',
    ]);
    expect(status.default).toBe('open');
  });

  test.each(['status_changed_at', 'last_message_at'])(
    '%sはUTCミリ秒のNOT NULLの整数で、既定値と更新時の値を持たない',
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

  test('deleted_atは論理削除の日時で、未削除を表すNULLを許す', () => {
    const deletedAt = columnOf('deleted_at');

    expect(deletedAt.getSQLType()).toBe('integer');
    expect(modeOf(deletedAt)).toBe('timestamp_ms');
    expect(deletedAt.notNull).toBe(false);
    expect(deletedAt.hasDefault).toBe(false);
  });

  test('利用者ごと・ステータスごとの受付日時、カテゴリ、受付日時の照会に索引を持つ', () => {
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
        name: 'member_inquiries_user_id_created_at_idx',
        columns: ['user_id', 'created_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'member_inquiries_status_created_at_idx',
        columns: ['status', 'created_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'member_inquiries_category_id_idx',
        columns: ['category_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'member_inquiries_created_at_idx',
        columns: ['created_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('statusを4つの対応ステータスだけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'member_inquiries_status_check',
        sql: `"status" in ('open', 'in_progress', 'resolved', 'rejected')`,
      },
    ]);
  });

  test('user_idはusersのidを、category_idはinquiry_categoriesのidを参照し、削除時の動作を指定しない', () => {
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
      {
        columns: ['category_id'],
        foreignTable: inquiryCategories,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
    ]);
  });
});
