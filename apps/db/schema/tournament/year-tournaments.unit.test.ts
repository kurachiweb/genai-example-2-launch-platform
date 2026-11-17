import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { tournamentBrackets } from './tournament-brackets.ts';
import { yearTournaments } from './year-tournaments.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(yearTournaments);

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

describe('year_tournaments', () => {
  test('テーブル名は年のトーナメントの複数形のスネークケースになる', () => {
    expect(config.name).toBe('year_tournaments');
  });

  test('対象年・決勝日とその出どころと版・期限と組み合わせ決定の日時・状態・組み合わせの記録・ブラケット・結果・受賞・終了の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'year',
      'final_date',
      'final_date_source',
      'final_date_version',
      'final_date_updated_at',
      'final_date_updated_by_admin_id',
      'deadline_date',
      'accept_until',
      'deadline_at',
      'draw_at',
      'change_lock_at',
      'status',
      'draw_started_at',
      'drawn_at',
      'bracket_id',
      'first_round_date',
      'participant_count',
      'outcome',
      'champion_entry_id',
      'awarded_at',
      'finished_at',
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

  test('yearは対象年を持つNOT NULLの数値の整数で、既定値を持たない', () => {
    const year = columnOf('year');

    expect(year.getSQLType()).toBe('integer');
    expect(year.columnType).toBe('SQLiteInteger');
    expect(year.notNull).toBe(true);
    expect(year.hasDefault).toBe(false);
  });

  test.each(['final_date', 'deadline_date'])(
    '%sは業務日付を持つNOT NULLのテキストで、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('final_date_sourceは設定済み・既定だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const source = columnOf('final_date_source');

    expect(source.getSQLType()).toBe('text');
    expect(source.notNull).toBe(true);
    expect(source.enumValues).toEqual(['explicit', 'default']);
    expect(source.hasDefault).toBe(false);
  });

  test('final_date_versionは決勝日の保存の版を持つNOT NULLの数値の整数で、既定値は0になる', () => {
    const version = columnOf('final_date_version');

    expect(version.getSQLType()).toBe('integer');
    expect(version.columnType).toBe('SQLiteInteger');
    expect(version.notNull).toBe(true);
    expect(version.default).toBe(0);
  });

  test('final_date_updated_by_admin_idは保存した管理者のIDを持ち、保存されていないことを表すNULLを許すテキストになる', () => {
    const adminId = columnOf('final_date_updated_by_admin_id');

    expect(adminId.getSQLType()).toBe('text');
    expect(adminId.notNull).toBe(false);
    expect(adminId.hasDefault).toBe(false);
  });

  test.each(['accept_until', 'deadline_at', 'draw_at', 'change_lock_at'])(
    '%sはUTCミリ秒の整数でNOT NULLになり、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('statusは受付中・組み合わせ決定中・進行中・終了だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const status = columnOf('status');

    expect(status.getSQLType()).toBe('text');
    expect(status.notNull).toBe(true);
    expect(status.enumValues).toEqual([
      'open',
      'drawing',
      'in_progress',
      'finished',
    ]);
    expect(status.hasDefault).toBe(false);
  });

  test.each([
    'final_date_updated_at',
    'draw_started_at',
    'drawn_at',
    'awarded_at',
    'finished_at',
  ])('%sはUTCミリ秒の整数で、まだ起きていないことを表すNULLを許す', (name) => {
    const column = columnOf(name);

    expect(column.getSQLType()).toBe('integer');
    expect(modeOf(column)).toBe('timestamp_ms');
    expect(column.notNull).toBe(false);
    expect(column.hasDefault).toBe(false);
  });

  test.each(['bracket_id', 'first_round_date', 'champion_entry_id'])(
    '%sは決まっていないことを表すNULLを許すテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('participant_countは組み合わせの参加数を持つ数値の整数で、決まっていないことを表すNULLを許す', () => {
    const count = columnOf('participant_count');

    expect(count.getSQLType()).toBe('integer');
    expect(count.columnType).toBe('SQLiteInteger');
    expect(count.notNull).toBe(false);
    expect(count.hasDefault).toBe(false);
  });

  test('outcomeは授与・授与なしだけを取り、終わっていないことを表すNULLを許すテキストになる', () => {
    const outcome = columnOf('outcome');

    expect(outcome.getSQLType()).toBe('text');
    expect(outcome.notNull).toBe(false);
    expect(outcome.enumValues).toEqual(['awarded', 'no_award']);
    expect(outcome.hasDefault).toBe(false);
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

  test('ブラケットのIDだけが外部キーで、削除時の動作を指定せず、管理者と優勝の枠のIDは外部キーを持たない', () => {
    const foreignKeys = config.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference();
      return {
        columns: reference.columns.map((column) => column.name),
        foreignTable: reference.foreignTable,
        foreignColumns: reference.foreignColumns.map((column) => column.name),
        onDelete: foreignKey.onDelete,
      };
    });

    expect(foreignKeys).toEqual([
      {
        columns: ['bracket_id'],
        foreignTable: tournamentBrackets,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
    ]);
  });

  test('対象年の一意索引と、状態と組み合わせ決定の日時の索引、凍結と決済期限日の索引を持つ', () => {
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
        name: 'year_tournaments_year_unique',
        columns: ['year'],
        unique: true,
        where: undefined,
      },
      {
        name: 'year_tournaments_status_draw_at_idx',
        columns: ['status', 'draw_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'year_tournaments_draw_started_at_deadline_date_idx',
        columns: ['draw_started_at', 'deadline_date'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('対象年の範囲・出どころ・版・状態・結果を限り、設定済みなら版を1以上に、終了なら結果を、受賞なら優勝の枠を必須にするCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'year_tournaments_year_range_check',
        sql: `"year" between 1000 and 9999`,
      },
      {
        name: 'year_tournaments_final_date_source_check',
        sql: `"final_date_source" in ('explicit', 'default')`,
      },
      {
        name: 'year_tournaments_final_date_version_check',
        sql: `"final_date_version" >= 0`,
      },
      {
        name: 'year_tournaments_status_check',
        sql: `"status" in ('open', 'drawing', 'in_progress', 'finished')`,
      },
      {
        name: 'year_tournaments_outcome_check',
        sql: `"outcome" in ('awarded', 'no_award')`,
      },
      {
        name: 'year_tournaments_explicit_version_check',
        sql: `("final_date_source" <> 'explicit' or "final_date_version" >= 1)`,
      },
      {
        name: 'year_tournaments_finished_outcome_check',
        sql: `("status" <> 'finished' or "outcome" is not null)`,
      },
      {
        name: 'year_tournaments_awarded_champion_check',
        sql: `("outcome" is null or "outcome" <> 'awarded' or "champion_entry_id" is not null)`,
      },
    ]);
  });
});
