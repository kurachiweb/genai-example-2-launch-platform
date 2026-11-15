import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import { ultrasActivations } from './ultras-activations.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(ultrasActivations);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('ultras_activations', () => {
  test('テーブル名は加入が有効になった知らせの複数形のスネークケースになる', () => {
    expect(config.name).toBe('ultras_activations');
  });

  test('利用者・定期課金・有効化と送り出しと完了の時刻の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'user_id',
      'stripe_subscription_id',
      'activated_at',
      'dispatched_at',
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

  test.each(['user_id', 'stripe_subscription_id'])(
    '%sはNOT NULLのテキストで、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('activated_atはUTCミリ秒のNOT NULLの整数で、既定値と更新時の値を持たない', () => {
    const activatedAt = columnOf('activated_at');

    expect(activatedAt.getSQLType()).toBe('integer');
    expect(modeOf(activatedAt)).toBe('timestamp_ms');
    expect(activatedAt.notNull).toBe(true);
    expect(activatedAt.hasDefault).toBe(false);
    expect(activatedAt.onUpdateFn).toBeUndefined();
  });

  test.each(['dispatched_at', 'completed_at'])(
    '%sはNULLを許すUTCミリ秒の整数で、既定値を持たない',
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

  test('定期課金ごとに知らせを1つにする一意索引と、未送り出しの知らせを作成からの経過で探す索引を持つ', () => {
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
        name: 'ultras_activations_stripe_subscription_id_unique',
        columns: ['stripe_subscription_id'],
        unique: true,
        where: undefined,
      },
      {
        name: 'ultras_activations_completed_at_dispatched_at_created_at_idx',
        columns: ['completed_at', 'dispatched_at', 'created_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('CHECK制約を持たない', () => {
    expect(config.checks).toEqual([]);
  });

  test('user_idはusersのidを参照し、削除時の動作を指定しない', () => {
    const references = config.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference();
      return {
        columns: reference.columns.map((column) => column.name),
        foreignTable: reference.foreignTable,
        foreignColumns: reference.foreignColumns.map((column) => column.name),
        onDelete: foreignKey.onDelete,
      };
    });

    expect(references).toEqual([
      {
        columns: ['user_id'],
        foreignTable: users,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
    ]);
  });
});
