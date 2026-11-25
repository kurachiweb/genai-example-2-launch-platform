import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { bracketMatches } from './bracket-matches.ts';
import { tournamentBrackets } from './tournament-brackets.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(bracketMatches);

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

describe('bracket_matches', () => {
  test('テーブル名はブラケットのマッチの複数形のスネークケースになる', () => {
    expect(config.name).toBe('bracket_matches');
  });

  test('マッチ・ブラケット・ラウンド・位置・実施日・2つの参加者の番号・状態・勝者・確定の列と作成・更新の日時だけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'match_id',
      'bracket_id',
      'round',
      'position',
      'match_date',
      'participant1_no',
      'participant2_no',
      'status',
      'winner_participant_no',
      'decided_at',
      'created_at',
      'updated_at',
    ]);
  });

  test('match_idは呼び出し元が採番したマッチのIDを持つテキストの主キーで、既定値を持たない', () => {
    const matchId = columnOf('match_id');

    expect(matchId.getSQLType()).toBe('text');
    expect(matchId.primary).toBe(true);
    expect(matchId.hasDefault).toBe(false);
  });

  test('bracket_idはNOT NULLのテキストになる', () => {
    const bracketId = columnOf('bracket_id');

    expect(bracketId.getSQLType()).toBe('text');
    expect(bracketId.notNull).toBe(true);
    expect(bracketId.hasDefault).toBe(false);
  });

  test.each(['round', 'position', 'participant1_no'])(
    '%sはNOT NULLの数値の整数で、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(column.columnType).toBe('SQLiteInteger');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test.each(['participant2_no', 'winner_participant_no'])(
    '%sは不戦勝や未確定を表すNULLを許す数値の整数になる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(column.columnType).toBe('SQLiteInteger');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('match_dateは業務日付の文字列を持つNOT NULLのテキストになる', () => {
    const matchDate = columnOf('match_date');

    expect(matchDate.getSQLType()).toBe('text');
    expect(matchDate.notNull).toBe(true);
    expect(matchDate.hasDefault).toBe(false);
  });

  test('statusは予定前・予定済み・確定だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const status = columnOf('status');

    expect(status.getSQLType()).toBe('text');
    expect(status.notNull).toBe(true);
    expect(status.enumValues).toEqual(['planned', 'scheduled', 'decided']);
    expect(status.hasDefault).toBe(false);
  });

  test('decided_atはUTCミリ秒の整数で、未確定を表すNULLを許す', () => {
    const decidedAt = columnOf('decided_at');

    expect(decidedAt.getSQLType()).toBe('integer');
    expect(modeOf(decidedAt)).toBe('timestamp_ms');
    expect(decidedAt.notNull).toBe(false);
    expect(decidedAt.hasDefault).toBe(false);
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

  test('ブラケットのIDだけが外部キーで、削除時の動作を指定せず、マッチのIDはマッチへの外部キーを持たない', () => {
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

  test('ブラケット・ラウンド・位置の一意索引と、ブラケットと状態の索引を持つ', () => {
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
        name: 'bracket_matches_bracket_id_round_position_unique',
        columns: ['bracket_id', 'round', 'position'],
        unique: true,
        where: undefined,
      },
      {
        name: 'bracket_matches_bracket_id_status_idx',
        columns: ['bracket_id', 'status'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('状態を決まった値だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'bracket_matches_status_check',
        sql: `"status" in ('planned', 'scheduled', 'decided')`,
      },
    ]);
  });
});
