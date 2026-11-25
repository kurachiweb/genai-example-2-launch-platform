import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import { productLaunches } from '../product/product-launches.ts';
import { products } from '../product/products.ts';
import { bracketParticipants } from './bracket-participants.ts';
import { tournamentBrackets } from './tournament-brackets.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(bracketParticipants);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('bracket_participants', () => {
  test('テーブル名はブラケットの参加者の複数形のスネークケースになる', () => {
    expect(config.name).toBe('bracket_participants');
  });

  test('ブラケット・参加者の番号・枠の参照・ローンチ・プロダクト・投稿者・敗退したラウンドの列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'bracket_id',
      'participant_no',
      'entry_ref',
      'launch_id',
      'product_id',
      'owner_user_id',
      'eliminated_round',
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

  test('bracket_idはNOT NULLのテキストになる', () => {
    const bracketId = columnOf('bracket_id');

    expect(bracketId.getSQLType()).toBe('text');
    expect(bracketId.notNull).toBe(true);
    expect(bracketId.hasDefault).toBe(false);
  });

  test('participant_noは参加者の番号を持つNOT NULLの数値の整数で、既定値を持たない', () => {
    const participantNo = columnOf('participant_no');

    expect(participantNo.getSQLType()).toBe('integer');
    expect(participantNo.columnType).toBe('SQLiteInteger');
    expect(participantNo.notNull).toBe(true);
    expect(participantNo.hasDefault).toBe(false);
  });

  test('entry_refは種類ごとの枠を指すNOT NULLのテキストで、単独では一意にならない', () => {
    const entryRef = columnOf('entry_ref');

    expect(entryRef.getSQLType()).toBe('text');
    expect(entryRef.notNull).toBe(true);
    expect(entryRef.isUnique).toBe(false);
    expect(entryRef.hasDefault).toBe(false);
  });

  test.each(['launch_id', 'product_id', 'owner_user_id'])(
    '%sは紐付けの解除を表すNULLを許すテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('eliminated_roundは敗退したラウンドを持つ数値の整数で、勝ち残りを表すNULLを許す', () => {
    const eliminatedRound = columnOf('eliminated_round');

    expect(eliminatedRound.getSQLType()).toBe('integer');
    expect(eliminatedRound.columnType).toBe('SQLiteInteger');
    expect(eliminatedRound.notNull).toBe(false);
    expect(eliminatedRound.hasDefault).toBe(false);
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

  test('ブラケット・ローンチ・プロダクト・投稿者のIDが外部キーで、削除時の動作を指定しない', () => {
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
      {
        columns: ['owner_user_id'],
        foreignTable: users,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
    ]);
  });

  test('ブラケットと参加者の番号・ブラケットと枠の参照の一意索引と、プロダクトの索引を持つ', () => {
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
        name: 'bracket_participants_bracket_id_participant_no_unique',
        columns: ['bracket_id', 'participant_no'],
        unique: true,
        where: undefined,
      },
      {
        name: 'bracket_participants_bracket_id_entry_ref_unique',
        columns: ['bracket_id', 'entry_ref'],
        unique: true,
        where: undefined,
      },
      {
        name: 'bracket_participants_product_id_idx',
        columns: ['product_id'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('CHECK制約を持たない', () => {
    expect(config.checks).toEqual([]);
  });
});
