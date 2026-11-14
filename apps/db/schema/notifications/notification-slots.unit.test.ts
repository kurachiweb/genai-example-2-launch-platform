import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { notificationSlots } from './notification-slots.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(notificationSlots);

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

describe('notification_slots', () => {
  test('テーブル名は送信枠の複数形のスネークケースになる', () => {
    expect(config.name).toBe('notification_slots');
  });

  test('枠のキー・種類・期日・送り出しの前提と依頼・段・カーソル・リース・開始と完了の列と共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'slot_key',
      'kind',
      'due_at',
      'settle_until',
      'required_participants',
      'dispatch_requested_at',
      'phase',
      'cursor',
      'lease_holder',
      'lease_until',
      'started_at',
      'completed_at',
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

  test('slot_keyは既定値を持たないNOT NULLのテキストになる', () => {
    const slotKey = columnOf('slot_key');

    expect(slotKey.getSQLType()).toBe('text');
    expect(slotKey.notNull).toBe(true);
    expect(slotKey.hasDefault).toBe(false);
  });

  test('kindは夜・朝・受賞だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const kind = columnOf('kind');

    expect(kind.getSQLType()).toBe('text');
    expect(kind.notNull).toBe(true);
    expect(kind.enumValues).toEqual(['evening', 'morning', 'award']);
    expect(kind.hasDefault).toBe(false);
  });

  test('phaseは待機・収集・送信・完了だけを取るNOT NULLのテキストで、既定値は待機になる', () => {
    const phase = columnOf('phase');

    expect(phase.getSQLType()).toBe('text');
    expect(phase.notNull).toBe(true);
    expect(phase.enumValues).toEqual([
      'waiting',
      'collecting',
      'sending',
      'done',
    ]);
    expect(phase.default).toBe('waiting');
  });

  test.each(['due_at', 'settle_until'])(
    '%sはUTCミリ秒の整数でNOT NULLになり、既定値と更新時の値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
      expect(column.onUpdateFn).toBeUndefined();
    },
  );

  test.each([
    'dispatch_requested_at',
    'lease_until',
    'started_at',
    'completed_at',
  ])('%sはUTCミリ秒の整数で、まだ無いことを表すNULLを許す', (name) => {
    const column = columnOf(name);

    expect(column.getSQLType()).toBe('integer');
    expect(modeOf(column)).toBe('timestamp_ms');
    expect(column.notNull).toBe(false);
    expect(column.hasDefault).toBe(false);
  });

  test('required_participantsは前提の名前の配列をJSONで持つテキストで、未確定を表すNULLを許す', () => {
    const requiredParticipants = columnOf('required_participants');

    expect(requiredParticipants.getSQLType()).toBe('text');
    expect(requiredParticipants.columnType).toBe('SQLiteTextJson');
    expect(requiredParticipants.notNull).toBe(false);
    expect(requiredParticipants.hasDefault).toBe(false);
  });

  test.each(['cursor', 'lease_holder'])(
    '%sはまだ無いことを表すNULLを許すテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
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

  test('外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });

  test('枠のキーの一意索引と、期限切れと完了の照会の索引を持つ', () => {
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
        name: 'notification_slots_slot_key_unique',
        columns: ['slot_key'],
        unique: true,
        where: undefined,
      },
      {
        name: 'notification_slots_phase_settle_until_idx',
        columns: ['phase', 'settle_until'],
        unique: false,
        where: undefined,
      },
      {
        name: 'notification_slots_phase_completed_at_idx',
        columns: ['phase', 'completed_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('種類と段を決まった値だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'notification_slots_kind_check',
        sql: `"kind" in ('evening', 'morning', 'award')`,
      },
      {
        name: 'notification_slots_phase_check',
        sql: `"phase" in ('waiting', 'collecting', 'sending', 'done')`,
      },
    ]);
  });
});
