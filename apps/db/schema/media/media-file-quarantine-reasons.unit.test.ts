import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { mediaFileQuarantineReasons } from './media-file-quarantine-reasons.ts';
import { mediaFiles } from './media-files.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(mediaFileQuarantineReasons);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('media_file_quarantine_reasons', () => {
  test('テーブル名はファイルの隔離理由の複数形のスネークケースになる', () => {
    expect(config.name).toBe('media_file_quarantine_reasons');
  });

  test('ファイルと理由の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'file_id',
      'reason',
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

  test('file_idはファイルのIDを持つNOT NULLのテキストで、単独では一意にならない', () => {
    const fileId = columnOf('file_id');

    expect(fileId.getSQLType()).toBe('text');
    expect(fileId.notNull).toBe(true);
    expect(fileId.isUnique).toBe(false);
    expect(fileId.hasDefault).toBe(false);
  });

  test('reasonは4種の隔離理由だけを値に取るNOT NULLのテキストになる', () => {
    const reason = columnOf('reason');

    expect(reason.getSQLType()).toBe('text');
    expect(reason.notNull).toBe(true);
    expect(reason.isUnique).toBe(false);
    expect(reason.enumValues).toEqual([
      'auto',
      'product_hidden',
      'user_suspended',
      'admin_action',
    ]);
    expect(reason.hasDefault).toBe(false);
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

  test('file_idはmedia_filesのidを参照し、ファイルの削除で理由も連鎖削除される', () => {
    expect(config.foreignKeys).toHaveLength(1);
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'file_id',
    ]);
    expect(reference?.foreignTable).toBe(mediaFiles);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      'id',
    ]);
    expect(foreignKey?.onDelete).toBe('cascade');
  });

  test('ファイルと理由の組の一意な索引と、理由ごとの照会の索引を持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
    }));

    expect(indexes).toEqual([
      {
        name: 'media_file_quarantine_reasons_file_id_reason_unique',
        columns: ['file_id', 'reason'],
        unique: true,
      },
      {
        name: 'media_file_quarantine_reasons_reason_created_at_idx',
        columns: ['reason', 'created_at'],
        unique: false,
      },
    ]);
  });
});
