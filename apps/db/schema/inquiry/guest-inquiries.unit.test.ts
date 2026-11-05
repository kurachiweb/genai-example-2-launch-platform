import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { guestInquiries } from './guest-inquiries.ts';
import { inquiryCategories } from './inquiry-categories.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(guestInquiries);

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

describe('guest_inquiries', () => {
  test('テーブル名は未ログインの問い合わせの複数形のスネークケースになる', () => {
    expect(config.name).toBe('guest_inquiries');
  });

  test('カテゴリ・連絡先・本文・ステータスの列と共通カラムだけを持ち、利用者と論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'category_id',
      'nickname',
      'email',
      'body',
      'status',
      'status_changed_at',
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

  test.each(['category_id', 'nickname', 'email', 'body'])(
    '%sは値を限らない一意でないNOT NULLのテキストで、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.isUnique).toBe(false);
      expect(column.enumValues).toBeUndefined();
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

  test('status_changed_atはUTCミリ秒のNOT NULLの整数で、既定値と更新時の値を持たない', () => {
    const statusChangedAt = columnOf('status_changed_at');

    expect(statusChangedAt.getSQLType()).toBe('integer');
    expect(modeOf(statusChangedAt)).toBe('timestamp_ms');
    expect(statusChangedAt.notNull).toBe(true);
    expect(statusChangedAt.hasDefault).toBe(false);
    expect(statusChangedAt.onUpdateFn).toBeUndefined();
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

  test('ステータスごとの受付日時と変更日時、カテゴリ、受付日時の照会に索引を持つ', () => {
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
        name: 'guest_inquiries_status_created_at_idx',
        columns: ['status', 'created_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'guest_inquiries_status_status_changed_at_idx',
        columns: ['status', 'status_changed_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'guest_inquiries_category_id_idx',
        columns: ['category_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'guest_inquiries_created_at_idx',
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
        name: 'guest_inquiries_status_check',
        sql: `"status" in ('open', 'in_progress', 'resolved', 'rejected')`,
      },
    ]);
  });

  test('category_idだけがinquiry_categoriesのidを参照し、利用者を参照せず、削除時の動作を指定しない', () => {
    expect(config.foreignKeys).toHaveLength(1);
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'category_id',
    ]);
    expect(reference?.foreignTable).toBe(inquiryCategories);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      'id',
    ]);
    expect(foreignKey?.onDelete).toBeUndefined();
  });
});
