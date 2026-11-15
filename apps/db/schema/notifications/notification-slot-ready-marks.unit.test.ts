import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { notificationSlotReadyMarks } from './notification-slot-ready-marks.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(notificationSlotReadyMarks);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('notification_slot_ready_marks', () => {
  test('テーブル名は送信枠の準備の完了の複数形のスネークケースになる', () => {
    expect(config.name).toBe('notification_slot_ready_marks');
  });

  test('追加だけで更新しないため、枠のキー・前提の機能の列と作成日時だけを持ち、更新日時を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'slot_key',
      'participant',
      'created_at',
    ]);
  });

  test('idはULIDを採番するテキストの主キーになる', () => {
    const id = columnOf('id');

    expect(id.getSQLType()).toBe('text');
    expect(id.primary).toBe(true);
    expect(id.defaultFn?.()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test.each(['slot_key', 'participant'])(
    '%sは既定値を持たないNOT NULLのテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('created_atは追加する側が値を渡すUTCミリ秒のNOT NULLの列で、既定値と更新時の値を持たない', () => {
    const createdAt = columnOf('created_at');

    expect(createdAt.getSQLType()).toBe('integer');
    expect(modeOf(createdAt)).toBe('timestamp_ms');
    expect(createdAt.notNull).toBe(true);
    expect(createdAt.hasDefault).toBe(false);
    expect(createdAt.onUpdateFn).toBeUndefined();
  });

  test('枠のキーを含めて外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });

  test('枠と前提の機能の組で1行に限る一意索引だけを持つ', () => {
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
        name: 'notification_slot_ready_marks_slot_key_participant_unique',
        columns: ['slot_key', 'participant'],
        unique: true,
        where: undefined,
      },
    ]);
  });

  test('CHECK制約を持たない', () => {
    expect(config.checks).toEqual([]);
  });
});
