import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { legalDocumentVersions } from './legal-document-versions.ts';
import { legalDocuments } from './legal-documents.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(legalDocumentVersions);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('legal_document_versions', () => {
  test('テーブル名は法務文書の版の複数形のスネークケースになる', () => {
    expect(config.name).toBe('legal_document_versions');
  });

  test('文書・版番号・本文・変更概要・公開日時・公開した管理者の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'document_id',
      'version_number',
      'body',
      'change_summary',
      'published_at',
      'published_by_admin_id',
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

  test.each(['document_id', 'body', 'change_summary', 'published_by_admin_id'])(
    '%sは値を限らない一意でないNOT NULLのテキストで、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.isUnique).toBe(false);
      expect(column.enumValues).toBeUndefined();
      expect(column.hasDefault).toBe(false);
    },
  );

  test('version_numberは一意でないNOT NULLの整数で、既定値を持たない', () => {
    const versionNumber = columnOf('version_number');

    expect(versionNumber.getSQLType()).toBe('integer');
    expect(versionNumber.notNull).toBe(true);
    expect(versionNumber.isUnique).toBe(false);
    expect(versionNumber.hasDefault).toBe(false);
  });

  test('published_atはUTCミリ秒のNOT NULLの整数で、既定値と更新時の値を持たない', () => {
    const publishedAt = columnOf('published_at');

    expect(publishedAt.getSQLType()).toBe('integer');
    expect(modeOf(publishedAt)).toBe('timestamp_ms');
    expect(publishedAt.notNull).toBe(true);
    expect(publishedAt.hasDefault).toBe(false);
    expect(publishedAt.onUpdateFn).toBeUndefined();
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

  test('文書ごとの版番号を一意にする索引と、文書ごとの公開日時の照会の一意でない索引を持つ', () => {
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
        name: 'legal_document_versions_document_id_version_number_unique',
        columns: ['document_id', 'version_number'],
        unique: true,
        where: undefined,
      },
      {
        name: 'legal_document_versions_document_id_published_at_idx',
        columns: ['document_id', 'published_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('document_idだけがlegal_documentsのidを参照し、公開した管理者のIDは他のテーブルを参照せず、削除時の動作を指定しない', () => {
    expect(config.foreignKeys).toHaveLength(1);
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'document_id',
    ]);
    expect(reference?.foreignTable).toBe(legalDocuments);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      'id',
    ]);
    expect(foreignKey?.onDelete).toBeUndefined();
  });

  test('CHECK制約を持たない', () => {
    expect(config.checks).toEqual([]);
  });
});
