import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import {
  ULTRAS_NOTICE_KIND_VALUES,
  ULTRAS_NOTICE_STATUS_VALUES,
  ultrasNotices,
} from './ultras-notices.ts';

const EXPECTED_NOTICE_KINDS = ['payment_failed', 'cancellation_accepted'];

const EXPECTED_NOTICE_STATUSES = ['pending', 'requested', 'skipped'];

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(ultrasNotices);

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

const inList = (column: string, values: readonly string[]): string =>
  `"${column}" in (${values.map((value) => `'${value}'`).join(', ')})`;

describe('ultras_notices', () => {
  test('テーブル名はメールの依頼の複数形のスネークケースになる', () => {
    expect(config.name).toBe('ultras_notices');
  });

  test('利用者・定期課金・種別・重複防止の鍵・内容・状態・完了の時刻の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'user_id',
      'stripe_subscription_id',
      'kind',
      'dedupe_key',
      'payload_json',
      'status',
      'finished_at',
      'created_at',
      'updated_at',
    ]);
  });

  test.each([
    {
      name: 'メールの依頼の種別',
      values: ULTRAS_NOTICE_KIND_VALUES,
      expected: EXPECTED_NOTICE_KINDS,
    },
    {
      name: 'メールの依頼の状態',
      values: ULTRAS_NOTICE_STATUS_VALUES,
      expected: EXPECTED_NOTICE_STATUSES,
    },
  ])(
    '他のテーブルとアプリの一致の検査が使う$nameの一覧をエクスポートする',
    ({ values, expected }) => {
      expect<readonly string[]>([...values]).toEqual(expected);
    },
  );

  test('idはULIDを採番するテキストの主キーになる', () => {
    const id = columnOf('id');

    expect(id.getSQLType()).toBe('text');
    expect(id.primary).toBe(true);
    expect(id.defaultFn?.()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test.each([
    'user_id',
    'stripe_subscription_id',
    'dedupe_key',
    'payload_json',
  ])('%sはNOT NULLのテキストで、既定値を持たない', (name) => {
    const column = columnOf(name);

    expect(column.getSQLType()).toBe('text');
    expect(column.notNull).toBe(true);
    expect(column.hasDefault).toBe(false);
  });

  test('kindは共有定義のメールの依頼の種別だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const kind = columnOf('kind');

    expect(kind.getSQLType()).toBe('text');
    expect(kind.notNull).toBe(true);
    expect(kind.enumValues).toEqual(EXPECTED_NOTICE_KINDS);
    expect(kind.hasDefault).toBe(false);
  });

  test('statusは共有定義のメールの依頼の状態だけを取るNOT NULLのテキストで、既定は依頼待ちになる', () => {
    const status = columnOf('status');

    expect(status.getSQLType()).toBe('text');
    expect(status.notNull).toBe(true);
    expect(status.enumValues).toEqual(EXPECTED_NOTICE_STATUSES);
    expect(status.default).toBe('pending');
  });

  test('finished_atはNULLを許すUTCミリ秒の整数で、既定値を持たない', () => {
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

  test('重複防止の鍵の一意索引と、定期課金と状態で探す索引を持つ', () => {
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
        name: 'ultras_notices_dedupe_key_unique',
        columns: ['dedupe_key'],
        unique: true,
        where: undefined,
      },
      {
        name: 'ultras_notices_stripe_subscription_id_idx',
        columns: ['stripe_subscription_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'ultras_notices_status_created_at_idx',
        columns: ['status', 'created_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('種別と状態を共有定義の値だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'ultras_notices_kind_check',
        sql: inList('kind', EXPECTED_NOTICE_KINDS),
      },
      {
        name: 'ultras_notices_status_check',
        sql: inList('status', EXPECTED_NOTICE_STATUSES),
      },
    ]);
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
