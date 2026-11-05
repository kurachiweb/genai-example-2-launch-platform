import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { inquiryMessages } from './inquiry-messages.ts';
import { memberInquiries } from './member-inquiries.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(inquiryMessages);

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

describe('inquiry_messages', () => {
  test('テーブル名は問い合わせのメッセージの複数形のスネークケースになる', () => {
    expect(config.name).toBe('inquiry_messages');
  });

  test('問い合わせ・送信者・本文・送信日時の列だけを持ち、更新日時と論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'inquiry_id',
      'sender_kind',
      'admin_id',
      'body',
      'created_at',
    ]);
  });

  test('idはULIDを採番するテキストの主キーになる', () => {
    const id = columnOf('id');

    expect(id.getSQLType()).toBe('text');
    expect(id.primary).toBe(true);
    expect(id.defaultFn?.()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test.each(['inquiry_id', 'body'])(
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

  test('sender_kindは利用者・管理者だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const senderKind = columnOf('sender_kind');

    expect(senderKind.getSQLType()).toBe('text');
    expect(senderKind.notNull).toBe(true);
    expect(senderKind.enumValues).toEqual(['user', 'admin']);
    expect(senderKind.hasDefault).toBe(false);
  });

  test('admin_idは一意でないテキストで、利用者のメッセージを表すNULLを許す', () => {
    const adminId = columnOf('admin_id');

    expect(adminId.getSQLType()).toBe('text');
    expect(adminId.notNull).toBe(false);
    expect(adminId.isUnique).toBe(false);
    expect(adminId.hasDefault).toBe(false);
  });

  test('created_atは送信日時のUTCミリ秒のNOT NULLの整数で、既定値と更新時の値を持たない', () => {
    const createdAt = columnOf('created_at');

    expect(createdAt.getSQLType()).toBe('integer');
    expect(modeOf(createdAt)).toBe('timestamp_ms');
    expect(createdAt.notNull).toBe(true);
    expect(createdAt.hasDefault).toBe(false);
    expect(createdAt.onUpdateFn).toBeUndefined();
  });

  test('問い合わせごとに送信日時とIDの順で読む索引を持つ', () => {
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
        name: 'inquiry_messages_inquiry_id_created_at_id_idx',
        columns: ['inquiry_id', 'created_at', 'id'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('sender_kindを利用者・管理者に限り、管理者のメッセージのときだけadmin_idを持たせるCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'inquiry_messages_sender_kind_check',
        sql: `"sender_kind" in ('user', 'admin')`,
      },
      {
        name: 'inquiry_messages_admin_id_check',
        sql: `("sender_kind" = 'admin') = ("admin_id" is not null)`,
      },
    ]);
  });

  test('inquiry_idだけがmember_inquiriesのidを参照し、管理者のIDは他のテーブルを参照せず、削除時の動作を指定しない', () => {
    expect(config.foreignKeys).toHaveLength(1);
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'inquiry_id',
    ]);
    expect(reference?.foreignTable).toBe(memberInquiries);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      'id',
    ]);
    expect(foreignKey?.onDelete).toBeUndefined();
  });
});
