import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { mediaFiles } from './media-files.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(mediaFiles);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('media_files', () => {
  test('テーブル名はファイルの記録の複数形のスネークケースになる', () => {
    expect(config.name).toBe('media_files');
  });

  test('保存先・保有者・内容・判定・削除の状態の列と共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'object_key',
      'purpose',
      'storage',
      'location',
      'owner_kind',
      'owner_id',
      'original_file_name',
      'content_type',
      'byte_size',
      'width',
      'height',
      'stored_at',
      'attached_at',
      'moderation_status',
      'moderation_detail',
      'moderated_at',
      'erase_requested_at',
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

  test('object_keyは大文字小文字を区別する一意のNOT NULLのテキストになる', () => {
    const objectKey = columnOf('object_key');

    expect(objectKey.getSQLType()).toBe('text');
    expect(objectKey.notNull).toBe(true);
    expect(objectKey.isUnique).toBe(true);
    expect(objectKey.hasDefault).toBe(false);
  });

  test.each(['purpose', 'original_file_name', 'content_type'])(
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

  test.each([
    ['storage', ['images', 'files']],
    ['location', ['images', 'files', 'quarantine']],
    ['owner_kind', ['user', 'admin', 'system']],
    [
      'moderation_status',
      ['not_required', 'pending', 'passed', 'flagged', 'undetermined'],
    ],
  ])(
    '%sは決まった値だけを取るNOT NULLのテキストで、既定値を持たない',
    (name, values) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.isUnique).toBe(false);
      expect(column.enumValues).toEqual(values);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('owner_idは保有者の識別子のテキストで、動作確認の主体を表すNULLを許す', () => {
    const ownerId = columnOf('owner_id');

    expect(ownerId.getSQLType()).toBe('text');
    expect(ownerId.notNull).toBe(false);
    expect(ownerId.isUnique).toBe(false);
    expect(ownerId.hasDefault).toBe(false);
  });

  test('byte_sizeは数値の整数でNOT NULLになり、既定値を持たない', () => {
    const byteSize = columnOf('byte_size');

    expect(byteSize.getSQLType()).toBe('integer');
    expect(byteSize.columnType).toBe('SQLiteInteger');
    expect(byteSize.notNull).toBe(true);
    expect(byteSize.hasDefault).toBe(false);
  });

  test.each(['width', 'height'])(
    '%sは数値の整数で、寸法を持たないファイルを表すNULLを許す',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(column.columnType).toBe('SQLiteInteger');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test.each(['stored_at', 'attached_at', 'moderated_at', 'erase_requested_at'])(
    '%sはUTCミリ秒の整数で、未到達を表すNULLを許し、既定値と更新時の値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
      expect(column.onUpdateFn).toBeUndefined();
    },
  );

  test('moderation_detailはJSONを保持するテキストで、検出内容が無いことを表すNULLを許す', () => {
    const detail = columnOf('moderation_detail');

    expect(detail.getSQLType()).toBe('text');
    expect(detail.columnType).toBe('SQLiteTextJson');
    expect(detail.notNull).toBe(false);
    expect(detail.hasDefault).toBe(false);
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

  test('deleted_atは共通カラムの論理削除のUTCミリ秒の列で、未削除を表すNULLを許す', () => {
    const deletedAt = columnOf('deleted_at');

    expect(deletedAt.getSQLType()).toBe('integer');
    expect(modeOf(deletedAt)).toBe('timestamp_ms');
    expect(deletedAt.notNull).toBe(false);
    expect(deletedAt.hasDefault).toBe(false);
  });

  test('保有者・未紐付け・論理削除・判定の状態・削除待ち・保存先の照会に、一意でない索引を持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
    }));

    expect(indexes).toEqual([
      {
        name: 'media_files_owner_kind_owner_id_idx',
        columns: ['owner_kind', 'owner_id'],
        unique: false,
      },
      {
        name: 'media_files_attached_at_created_at_idx',
        columns: ['attached_at', 'created_at'],
        unique: false,
      },
      {
        name: 'media_files_deleted_at_idx',
        columns: ['deleted_at'],
        unique: false,
      },
      {
        name: 'media_files_moderation_status_created_at_idx',
        columns: ['moderation_status', 'created_at'],
        unique: false,
      },
      {
        name: 'media_files_erase_requested_at_idx',
        columns: ['erase_requested_at'],
        unique: false,
      },
      {
        name: 'media_files_storage_location_idx',
        columns: ['storage', 'location'],
        unique: false,
      },
    ]);
  });

  test('他のテーブルへの外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });
});
