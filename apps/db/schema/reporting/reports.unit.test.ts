import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import { reportCases } from './report-cases.ts';
import { reportCategories } from './report-categories.ts';
import { reports } from './reports.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(reports);

const dialect = new SQLiteDialect();

const NOTICE_STATUSES = ['none', 'pending', 'requested', 'skipped'];

const quoted = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(', ');

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('reports', () => {
  test('テーブル名は通報の複数形のスネークケースになる', () => {
    expect(config.name).toBe('reports');
  });

  test('案件・通報者・連絡先・カテゴリ・理由・受付日時・申出者への通知の列と共通カラム・論理削除の列だけを持ち、送信元IPアドレスの列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'case_id',
      'reporter_user_id',
      'contact_email',
      'category_id',
      'category_name',
      'reason',
      'reported_at',
      'outcome_notice_status',
      'outcome_notice_requested_at',
      'created_at',
      'updated_at',
      'deleted_at',
    ]);
  });

  test('idはULIDを採番するテキストの主キーになる', () => {
    const id = columnOf('id');

    expect(id.getSQLType()).toBe('text');
    expect(id.primary).toBe(true);
    expect(id.defaultFn?.()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test.each(['case_id', 'category_id', 'category_name', 'reason'])(
    '%sは既定値を持たないNOT NULLのテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test.each(['reporter_user_id', 'contact_email'])(
    '%sは未ログインの通報者や連絡先なしを表すNULLを許すテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('outcome_notice_statusは送らない・依頼待ち・依頼済み・送らなかっただけを取るNOT NULLのテキストで、既定は送らないになる', () => {
    const noticeStatus = columnOf('outcome_notice_status');

    expect(noticeStatus.getSQLType()).toBe('text');
    expect(noticeStatus.notNull).toBe(true);
    expect(noticeStatus.default).toBe('none');
    expect(noticeStatus.enumValues).toEqual(NOTICE_STATUSES);
  });

  test('reported_atはUTCミリ秒の整数でNOT NULLになり、既定値と更新時の値を持たない', () => {
    const reportedAt = columnOf('reported_at');

    expect(reportedAt.getSQLType()).toBe('integer');
    expect(modeOf(reportedAt)).toBe('timestamp_ms');
    expect(reportedAt.notNull).toBe(true);
    expect(reportedAt.hasDefault).toBe(false);
    expect(reportedAt.onUpdateFn).toBeUndefined();
  });

  test.each(['outcome_notice_requested_at', 'deleted_at'])(
    '%sはUTCミリ秒の整数で、無いことを表すNULLを許す',
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

  test('case_idはreport_casesのidを、reporter_user_idはusersのidを、category_idはreport_categoriesのidを参照し、削除時の動作を指定しない', () => {
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
        columns: ['case_id'],
        foreignTable: reportCases,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
      {
        columns: ['reporter_user_id'],
        foreignTable: users,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
      {
        columns: ['category_id'],
        foreignTable: reportCategories,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
    ]);
  });

  test('案件ごとの通報の一覧・通報者ごと・カテゴリごと・通知の状態ごとの照会の索引を持つ', () => {
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
        name: 'reports_case_id_reported_at_idx',
        columns: ['case_id', 'reported_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'reports_reporter_user_id_idx',
        columns: ['reporter_user_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'reports_category_id_idx',
        columns: ['category_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'reports_outcome_notice_status_case_id_idx',
        columns: ['outcome_notice_status', 'case_id'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('通知の状態を限るCHECK制約と、通報者と連絡先を同時に持たないCHECK制約を、値を埋め込んで持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'reports_outcome_notice_status_check',
        sql: `"outcome_notice_status" in (${quoted(NOTICE_STATUSES)})`,
      },
      {
        name: 'reports_contact_email_check',
        sql: `not ("reporter_user_id" is not null and "contact_email" is not null)`,
      },
    ]);
  });
});
