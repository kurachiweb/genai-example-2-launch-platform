import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { inquiryMessageAttachments } from './inquiry-message-attachments.ts';
import { inquiryMessages } from './inquiry-messages.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(inquiryMessageAttachments);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

describe('inquiry_message_attachments', () => {
  test('テーブル名はメッセージの添付の複数形のスネークケースになる', () => {
    expect(config.name).toBe('inquiry_message_attachments');
  });

  test('メッセージ・ファイル・位置の列だけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'message_id',
      'file_id',
      'position',
    ]);
  });

  test.each(['message_id', 'file_id'])(
    '%sは単独では主キーでも一意でもないNOT NULLのテキストで、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.primary).toBe(false);
      expect(column.isUnique).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('positionはNOT NULLの整数で、既定値を持たない', () => {
    const position = columnOf('position');

    expect(position.getSQLType()).toBe('integer');
    expect(position.notNull).toBe(true);
    expect(position.hasDefault).toBe(false);
  });

  test('メッセージとファイルの組を複合主キーにする', () => {
    const primaryKeys = config.primaryKeys.map((primaryKey) => ({
      name: primaryKey.name,
      columns: primaryKey.columns.map((column) => column.name),
    }));

    expect(primaryKeys).toEqual([
      {
        name: 'inquiry_message_attachments_message_id_file_id_pk',
        columns: ['message_id', 'file_id'],
      },
    ]);
  });

  test('ファイルから紐付けを引く索引を持つ', () => {
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
        name: 'inquiry_message_attachments_file_id_idx',
        columns: ['file_id'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('CHECK制約を持たない', () => {
    expect(config.checks).toEqual([]);
  });

  test('message_idだけがinquiry_messagesのidを参照し、ファイルのIDは他のテーブルを参照せず、削除時の動作を指定しない', () => {
    expect(config.foreignKeys).toHaveLength(1);
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'message_id',
    ]);
    expect(reference?.foreignTable).toBe(inquiryMessages);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      'id',
    ]);
    expect(foreignKey?.onDelete).toBeUndefined();
  });
});
