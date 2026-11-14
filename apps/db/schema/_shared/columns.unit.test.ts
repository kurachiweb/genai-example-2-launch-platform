import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  snakeCase,
  SQLiteDialect,
  text,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import {
  notDeleted,
  softDelete,
  timestamps,
  ulidPrimaryKey,
} from './columns.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const probeItems = snakeCase.table('probe_items', {
  id: ulidPrimaryKey(),
  displayName: text().notNull(),
  ...timestamps(),
  ...softDelete(),
});

const columnOf = (name: string): TableColumn => {
  const column = getTableConfig(probeItems).columns.find(
    (candidate) => candidate.name === name,
  );
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const expectCurrentDate = (value: unknown, before: number, after: number) => {
  expect(value).toBeInstanceOf(Date);
  const time = (value as Date).getTime();
  expect(time).toBeGreaterThanOrEqual(before);
  expect(time).toBeLessThanOrEqual(after);
};

describe('列名の変換', () => {
  test('キャメルケースのキーがスネークケースの列名になる', () => {
    const names = getTableConfig(probeItems).columns.map(
      (column) => column.name,
    );

    expect(names).toEqual([
      'id',
      'display_name',
      'created_at',
      'updated_at',
      'deleted_at',
    ]);
  });
});

describe('ulidPrimaryKey', () => {
  test('テキストの主キーで、データベース側の既定値を持たない', () => {
    const id = columnOf('id');

    expect(id.getSQLType()).toBe('text');
    expect(id.primary).toBe(true);
    expect(id.notNull).toBe(true);
    expect(id.default).toBeUndefined();
    expect(id.onUpdateFn).toBeUndefined();
  });

  test('追加時の既定値として、呼び出しごとに異なるULIDを採番する', () => {
    const generate = columnOf('id').defaultFn;

    const first: unknown = generate?.();
    const second: unknown = generate?.();

    expect(first).toMatch(ULID_PATTERN);
    expect(second).toMatch(ULID_PATTERN);
    expect(second).not.toBe(first);
  });

  test('呼び出しごとに別の列ビルダーを返す', () => {
    expect(ulidPrimaryKey()).not.toBe(ulidPrimaryKey());
  });
});

describe('timestamps', () => {
  test.each(['created_at', 'updated_at'])(
    '%sはUTCミリ秒の整数でNOT NULLになり、データベース側の既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(column.columnType).toBe('SQLiteTimestamp');
      expect((column as SQLiteColumn & { mode: string }).mode).toBe(
        'timestamp_ms',
      );
      expect(column.notNull).toBe(true);
      expect(column.primary).toBe(false);
      expect(column.default).toBeUndefined();
    },
  );

  test.each(['created_at', 'updated_at'])(
    '%sは追加時の既定値として現在時刻を返す',
    (name) => {
      const before = Date.now();

      const value: unknown = columnOf(name).defaultFn?.();

      expectCurrentDate(value, before, Date.now());
    },
  );

  test('更新時はupdated_atだけに現在時刻を設定する', () => {
    const before = Date.now();

    const value: unknown = columnOf('updated_at').onUpdateFn?.();

    expectCurrentDate(value, before, Date.now());
    expect(columnOf('created_at').onUpdateFn).toBeUndefined();
  });

  test('呼び出しごとに別の列ビルダーを返す', () => {
    const first = timestamps();
    const second = timestamps();

    expect(second.createdAt).not.toBe(first.createdAt);
    expect(second.updatedAt).not.toBe(first.updatedAt);
  });
});

describe('softDelete', () => {
  test('deleted_atはUTCミリ秒の整数でNULLを許し、既定値と更新時の値を持たない', () => {
    const deletedAt = columnOf('deleted_at');

    expect(deletedAt.getSQLType()).toBe('integer');
    expect(deletedAt.columnType).toBe('SQLiteTimestamp');
    expect((deletedAt as SQLiteColumn & { mode: string }).mode).toBe(
      'timestamp_ms',
    );
    expect(deletedAt.notNull).toBe(false);
    expect(deletedAt.hasDefault).toBe(false);
    expect(deletedAt.defaultFn).toBeUndefined();
    expect(deletedAt.onUpdateFn).toBeUndefined();
  });

  test('呼び出しごとに別の列ビルダーを返す', () => {
    expect(softDelete().deletedAt).not.toBe(softDelete().deletedAt);
  });
});

describe('notDeleted', () => {
  test('削除日時がNULLの行だけに絞り込む条件になる', () => {
    const query = new SQLiteDialect().sqlToQuery(
      notDeleted(probeItems.deletedAt),
    );

    expect(query.sql).toBe('("probe_items"."deleted_at" is null)');
    expect(query.params).toEqual([]);
  });
});
