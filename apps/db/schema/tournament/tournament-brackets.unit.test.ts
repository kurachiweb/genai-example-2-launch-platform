import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { tournamentBrackets } from './tournament-brackets.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(tournamentBrackets);

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

describe('tournament_brackets', () => {
  test('テーブル名はトーナメントのブラケットの複数形のスネークケースになる', () => {
    expect(config.name).toBe('tournament_brackets');
  });

  test('種類・トーナメントの識別子・形・1回戦の実施日・状態・結果・優勝者・終了の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'kind',
      'tournament_id',
      'participant_count',
      'seed_count',
      'second_round_size',
      'round_count',
      'first_round_date',
      'status',
      'outcome',
      'champion_participant_no',
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

  test('kindはWeekトーナメント・Yearトーナメントだけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const kind = columnOf('kind');

    expect(kind.getSQLType()).toBe('text');
    expect(kind.notNull).toBe(true);
    expect(kind.enumValues).toEqual(['week', 'year']);
    expect(kind.hasDefault).toBe(false);
  });

  test('tournament_idは種類ごとのトーナメントのIDを持つNOT NULLのテキストで、単独では一意にならない', () => {
    const tournamentId = columnOf('tournament_id');

    expect(tournamentId.getSQLType()).toBe('text');
    expect(tournamentId.notNull).toBe(true);
    expect(tournamentId.isUnique).toBe(false);
    expect(tournamentId.hasDefault).toBe(false);
  });

  test.each([
    'participant_count',
    'seed_count',
    'second_round_size',
    'round_count',
  ])(
    '%sはブラケットの形を表すNOT NULLの数値の整数で、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(column.columnType).toBe('SQLiteInteger');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('first_round_dateは業務日付の文字列で、決まっていないことを表すNULLを許す', () => {
    const firstRoundDate = columnOf('first_round_date');

    expect(firstRoundDate.getSQLType()).toBe('text');
    expect(firstRoundDate.notNull).toBe(false);
    expect(firstRoundDate.hasDefault).toBe(false);
  });

  test('statusは進行中・終了だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const status = columnOf('status');

    expect(status.getSQLType()).toBe('text');
    expect(status.notNull).toBe(true);
    expect(status.enumValues).toEqual(['active', 'finished']);
    expect(status.hasDefault).toBe(false);
  });

  test('outcomeは優勝・授与なしだけを取り、終わっていないことを表すNULLを許すテキストになる', () => {
    const outcome = columnOf('outcome');

    expect(outcome.getSQLType()).toBe('text');
    expect(outcome.notNull).toBe(false);
    expect(outcome.enumValues).toEqual(['champion', 'no_award']);
    expect(outcome.hasDefault).toBe(false);
  });

  test('champion_participant_noは優勝者の参加者の番号を持つ数値の整数で、優勝者がいないことを表すNULLを許す', () => {
    const championParticipantNo = columnOf('champion_participant_no');

    expect(championParticipantNo.getSQLType()).toBe('integer');
    expect(championParticipantNo.columnType).toBe('SQLiteInteger');
    expect(championParticipantNo.notNull).toBe(false);
    expect(championParticipantNo.hasDefault).toBe(false);
  });

  test('finished_atはUTCミリ秒の整数で、終わっていないことを表すNULLを許す', () => {
    const finishedAt = columnOf('finished_at');

    expect(finishedAt.getSQLType()).toBe('integer');
    expect(modeOf(finishedAt)).toBe('timestamp_ms');
    expect(finishedAt.notNull).toBe(false);
    expect(finishedAt.hasDefault).toBe(false);
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

  test('外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });

  test('種類とトーナメントの識別子の組の一意索引だけを持つ', () => {
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
        name: 'tournament_brackets_kind_tournament_id_unique',
        columns: ['kind', 'tournament_id'],
        unique: true,
        where: undefined,
      },
    ]);
  });

  test('種類・状態・結果を決まった値だけに限り、終了なら結果を、優勝なら優勝者を必須にするCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'tournament_brackets_kind_check',
        sql: `"kind" in ('week', 'year')`,
      },
      {
        name: 'tournament_brackets_status_check',
        sql: `"status" in ('active', 'finished')`,
      },
      {
        name: 'tournament_brackets_outcome_check',
        sql: `"outcome" in ('champion', 'no_award')`,
      },
      {
        name: 'tournament_brackets_finished_outcome_check',
        sql: `("status" <> 'finished' or "outcome" is not null)`,
      },
      {
        name: 'tournament_brackets_champion_participant_check',
        sql: `("outcome" is null or "outcome" <> 'champion' or "champion_participant_no" is not null)`,
      },
    ]);
  });
});
