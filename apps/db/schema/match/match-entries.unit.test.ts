import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { productLaunches } from '../product/product-launches.ts';
import { products } from '../product/products.ts';
import { matchEntries } from './match-entries.ts';
import { matches } from './matches.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(matchEntries);

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

describe('match_entries', () => {
  test('テーブル名はマッチの側の複数形のスネークケースになる', () => {
    expect(config.name).toBe('match_entries');
  });

  test('マッチ・側の番号・マッチの写し・ローンチ・プロダクト・投稿者・集計値・該当・結果・紐付けの解除の列と共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'match_id',
      'slot',
      'match_kind',
      'match_date',
      'launch_id',
      'product_id',
      'owner_user_id',
      'upvote_count',
      'last_upvoted_at',
      'last_upvote_seq',
      'forfeited_at',
      'result',
      'unlinked_at',
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

  test.each(['match_id', 'match_date'])(
    '%sは単独では一意にならず既定値を持たないNOT NULLのテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.isUnique).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('slotは既定値を持たないNOT NULLの数値の整数になる', () => {
    const slot = columnOf('slot');

    expect(slot.getSQLType()).toBe('integer');
    expect(slot.columnType).toBe('SQLiteInteger');
    expect(slot.notNull).toBe(true);
    expect(slot.hasDefault).toBe(false);
  });

  test('match_kindはマッチの種別と同じ値だけを取るNOT NULLのテキストになる', () => {
    const matchKind = columnOf('match_kind');

    expect(matchKind.getSQLType()).toBe('text');
    expect(matchKind.notNull).toBe(true);
    expect(matchKind.enumValues).toEqual(['qualifier', 'week', 'year']);
    expect(matchKind.hasDefault).toBe(false);
  });

  test.each(['launch_id', 'product_id', 'owner_user_id'])(
    '%sは紐付けの解除を表すNULLを許し、単独では一意にならないテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(false);
      expect(column.isUnique).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('upvote_countは数値の整数でNOT NULLになり、既定値は0になる', () => {
    const upvoteCount = columnOf('upvote_count');

    expect(upvoteCount.getSQLType()).toBe('integer');
    expect(upvoteCount.columnType).toBe('SQLiteInteger');
    expect(upvoteCount.notNull).toBe(true);
    expect(upvoteCount.default).toBe(0);
  });

  test('last_upvote_seqはUpvoteが無いことを表すNULLを許す数値の整数になる', () => {
    const lastUpvoteSeq = columnOf('last_upvote_seq');

    expect(lastUpvoteSeq.getSQLType()).toBe('integer');
    expect(lastUpvoteSeq.columnType).toBe('SQLiteInteger');
    expect(lastUpvoteSeq.notNull).toBe(false);
    expect(lastUpvoteSeq.hasDefault).toBe(false);
  });

  test.each(['last_upvoted_at', 'forfeited_at', 'unlinked_at'])(
    '%sはUTCミリ秒の整数で、該当しないことを表すNULLを許す',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('resultは勝利・敗北・不戦勝・相手の退会等による勝利だけを取り、未確定を表すNULLを許すテキストになる', () => {
    const result = columnOf('result');

    expect(result.getSQLType()).toBe('text');
    expect(result.notNull).toBe(false);
    expect(result.enumValues).toEqual(['won', 'lost', 'bye', 'walkover']);
    expect(result.hasDefault).toBe(false);
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

  test('マッチ・ローンチ・プロダクトのIDだけが外部キーで、削除時の動作を指定せず、投稿者のIDは外部キーを持たない', () => {
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
        columns: ['match_id'],
        foreignTable: matches,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
      {
        columns: ['launch_id'],
        foreignTable: productLaunches,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
      {
        columns: ['product_id'],
        foreignTable: products,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
    ]);
  });

  test('マッチと側の番号の一意索引・予選の側のローンチの部分一意索引と、照会の索引を持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
      where:
        index.config.where === undefined
          ? undefined
          : dialect.sqlToQuery(index.config.where, 'indexes').sql,
    }));

    expect(indexes).toEqual([
      {
        name: 'match_entries_match_id_slot_unique',
        columns: ['match_id', 'slot'],
        unique: true,
        where: undefined,
      },
      {
        name: 'match_entries_qualifier_launch_id_unique',
        columns: ['launch_id'],
        unique: true,
        where: `("match_kind" = 'qualifier' and "launch_id" is not null)`,
      },
      {
        name: 'match_entries_product_id_idx',
        columns: ['product_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'match_entries_owner_user_id_idx',
        columns: ['owner_user_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'match_entries_launch_id_idx',
        columns: ['launch_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'match_entries_match_kind_match_date_idx',
        columns: ['match_kind', 'match_date'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('側の番号を1・2に、種別と結果を決まった値だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'match_entries_slot_check',
        sql: `"slot" in (1, 2)`,
      },
      {
        name: 'match_entries_match_kind_check',
        sql: `"match_kind" in ('qualifier', 'week', 'year')`,
      },
      {
        name: 'match_entries_result_check',
        sql: `"result" in ('won', 'lost', 'bye', 'walkover')`,
      },
    ]);
  });
});
