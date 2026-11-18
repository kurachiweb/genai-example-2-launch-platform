import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { sponsorshipDisplayStops } from './sponsorship-display-stops.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(sponsorshipDisplayStops);

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

describe('sponsorship_display_stops', () => {
  test('テーブル名は表示停止の区間の複数形のスネークケースになる', () => {
    expect(config.name).toBe('sponsorship_display_stops');
  });

  test('主体の種類と識別・始まりと終わりの列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'subject_kind',
      'subject_id',
      'started_at',
      'ended_at',
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

  test('subject_kindはプロダクトと利用者だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const subjectKind = columnOf('subject_kind');

    expect(subjectKind.getSQLType()).toBe('text');
    expect(subjectKind.notNull).toBe(true);
    expect(subjectKind.enumValues).toEqual(['product', 'user']);
    expect(subjectKind.hasDefault).toBe(false);
  });

  test('subject_idはNOT NULLのテキストで、既定値を持たない', () => {
    const subjectId = columnOf('subject_id');

    expect(subjectId.getSQLType()).toBe('text');
    expect(subjectId.notNull).toBe(true);
    expect(subjectId.hasDefault).toBe(false);
  });

  test('started_atはUTCミリ秒の整数でNOT NULLになり、既定値を持たない', () => {
    const startedAt = columnOf('started_at');

    expect(startedAt.getSQLType()).toBe('integer');
    expect(modeOf(startedAt)).toBe('timestamp_ms');
    expect(startedAt.notNull).toBe(true);
    expect(startedAt.hasDefault).toBe(false);
  });

  test('ended_atはUTCミリ秒の整数で、継続中を表すNULLを許す', () => {
    const endedAt = columnOf('ended_at');

    expect(endedAt.getSQLType()).toBe('integer');
    expect(modeOf(endedAt)).toBe('timestamp_ms');
    expect(endedAt.notNull).toBe(false);
    expect(endedAt.hasDefault).toBe(false);
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

  test('上流の物理削除を妨げないよう外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });

  test('主体ごとに始まりの順で読む索引だけを持つ', () => {
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
        name: 'sponsorship_display_stops_subject_idx',
        columns: ['subject_kind', 'subject_id', 'started_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('主体の種類をプロダクトと利用者に限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'sponsorship_display_stops_subject_kind_check',
        sql: `"subject_kind" in ('product', 'user')`,
      },
    ]);
  });
});
