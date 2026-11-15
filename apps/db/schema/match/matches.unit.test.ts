import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { matches } from './matches.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(matches);

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

describe('matches', () => {
  test('テーブル名はマッチの複数形のスネークケースになる', () => {
    expect(config.name).toBe('matches');
  });

  test('種別・実施日・ラウンド・段階・開始と終了・開始の記録・確定・決着・即時の終了の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'kind',
      'match_date',
      'round',
      'stage',
      'starts_at',
      'ends_at',
      'started_at',
      'decided_at',
      'decision',
      'ended_early_at',
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

  test('kindは予選・Weekトーナメント・Yearトーナメントだけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const kind = columnOf('kind');

    expect(kind.getSQLType()).toBe('text');
    expect(kind.notNull).toBe(true);
    expect(kind.enumValues).toEqual(['qualifier', 'week', 'year']);
    expect(kind.hasDefault).toBe(false);
  });

  test('match_dateは業務日付の文字列を持つNOT NULLのテキストで、単独では一意にならない', () => {
    const matchDate = columnOf('match_date');

    expect(matchDate.getSQLType()).toBe('text');
    expect(matchDate.notNull).toBe(true);
    expect(matchDate.isUnique).toBe(false);
    expect(matchDate.hasDefault).toBe(false);
  });

  test('roundは予選に無いことを表すNULLを許す数値の整数になる', () => {
    const round = columnOf('round');

    expect(round.getSQLType()).toBe('integer');
    expect(round.columnType).toBe('SQLiteInteger');
    expect(round.notNull).toBe(false);
    expect(round.hasDefault).toBe(false);
  });

  test('stageは準々決勝・準決勝・決勝だけを取り、それ以外のラウンドと予選を表すNULLを許すテキストになる', () => {
    const stage = columnOf('stage');

    expect(stage.getSQLType()).toBe('text');
    expect(stage.notNull).toBe(false);
    expect(stage.enumValues).toEqual(['quarterfinal', 'semifinal', 'final']);
    expect(stage.hasDefault).toBe(false);
  });

  test('decisionは6種の決着だけを取り、未確定を表すNULLを許すテキストになる', () => {
    const decision = columnOf('decision');

    expect(decision.getSQLType()).toBe('text');
    expect(decision.notNull).toBe(false);
    expect(decision.enumValues).toEqual([
      'votes',
      'last_upvote',
      'no_votes',
      'bye',
      'walkover',
      'both_forfeited',
    ]);
    expect(decision.hasDefault).toBe(false);
  });

  test.each(['starts_at', 'ends_at'])(
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

  test.each(['started_at', 'decided_at', 'ended_early_at'])(
    '%sはUTCミリ秒の整数で、まだ起きていないことを表すNULLを許す',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
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

  test('実施日と種別・開始・確定の照会に一意でない索引を持つ', () => {
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
        name: 'matches_match_date_kind_idx',
        columns: ['match_date', 'kind'],
        unique: false,
        where: undefined,
      },
      {
        name: 'matches_started_at_starts_at_idx',
        columns: ['started_at', 'starts_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'matches_decided_at_ends_at_idx',
        columns: ['decided_at', 'ends_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'matches_decided_at_idx',
        columns: ['decided_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('種別・段階・決着を決まった値だけに限り、開始を終了より前に限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'matches_kind_check',
        sql: `"kind" in ('qualifier', 'week', 'year')`,
      },
      {
        name: 'matches_stage_check',
        sql: `"stage" in ('quarterfinal', 'semifinal', 'final')`,
      },
      {
        name: 'matches_decision_check',
        sql: `"decision" in ('votes', 'last_upvote', 'no_votes', 'bye', 'walkover', 'both_forfeited')`,
      },
      {
        name: 'matches_starts_before_ends_check',
        sql: `"starts_at" < "ends_at"`,
      },
    ]);
  });
});
