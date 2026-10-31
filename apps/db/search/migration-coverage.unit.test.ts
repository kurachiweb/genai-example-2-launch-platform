import { describe, expect, test } from 'bun:test';

import { snakeCase } from 'drizzle-orm/sqlite-core';

import {
  searchDocumentColumns,
  searchTextColumn,
} from '../schema/_shared/search-documents.ts';
import { findMissingSearchIndexSql } from './migration-coverage.ts';
import {
  defineSearchIndex,
  type SearchIndexDefinition,
} from './search-index-definition.ts';
import {
  renderSearchIndexDropSql,
  renderSearchIndexRebuildSql,
  renderSearchIndexSql,
  renderSearchIndexTriggersSql,
} from './search-index-sql.ts';

const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

const probeSearchDocuments = snakeCase.table('probe_search_documents', {
  ...searchDocumentColumns(),
  name: searchTextColumn('name'),
  tagline: searchTextColumn('tagline'),
});

const otherSearchDocuments = snakeCase.table('other_search_documents', {
  ...searchDocumentColumns(),
  title: searchTextColumn('title'),
});

const probeIndex: SearchIndexDefinition = defineSearchIndex({
  documents: probeSearchDocuments,
  textColumns: [
    { column: probeSearchDocuments.name, weight: 10 },
    { column: probeSearchDocuments.tagline, weight: 5 },
  ],
  keywordsWeight: 1,
});

const otherIndex: SearchIndexDefinition = defineSearchIndex({
  documents: otherSearchDocuments,
  textColumns: [{ column: otherSearchDocuments.title, weight: 3 }],
  keywordsWeight: 1,
});

const statementsOf = (sqlText: string): string[] =>
  sqlText.split(`\n${STATEMENT_BREAKPOINT}\n`);

const [probeVirtualTable = '', probeInsertTrigger = '', ...probeOtherTriggers] =
  statementsOf(renderSearchIndexSql(probeIndex));
const [probeDeleteTrigger = '', probeUpdateTrigger = ''] = probeOtherTriggers;

const CREATE_DOCUMENTS_TABLE_SQL = `CREATE TABLE \`probe_search_documents\` (
	\`id\` integer PRIMARY KEY,
	\`source_id\` text NOT NULL UNIQUE,
	\`name\` text DEFAULT '' NOT NULL,
	\`tagline\` text DEFAULT '' NOT NULL
);`;

// 列の追加でdrizzle-kit generateが出力する、テーブルの作り直しの手順(トリガーも消える)
const RECREATE_DOCUMENTS_TABLE_SQL = `PRAGMA foreign_keys=OFF;
${STATEMENT_BREAKPOINT}
CREATE TABLE \`__new_probe_search_documents\` (
	\`id\` integer PRIMARY KEY,
	\`source_id\` text NOT NULL UNIQUE,
	\`name\` text DEFAULT '' NOT NULL,
	\`tagline\` text DEFAULT '' NOT NULL,
	\`locale\` text DEFAULT 'ja' NOT NULL
);
${STATEMENT_BREAKPOINT}
INSERT INTO \`__new_probe_search_documents\`(\`id\`, \`source_id\`, \`name\`, \`tagline\`) SELECT \`id\`, \`source_id\`, \`name\`, \`tagline\` FROM \`probe_search_documents\`;
${STATEMENT_BREAKPOINT}
DROP TABLE \`probe_search_documents\`;
${STATEMENT_BREAKPOINT}
ALTER TABLE \`__new_probe_search_documents\` RENAME TO \`probe_search_documents\`;
${STATEMENT_BREAKPOINT}
PRAGMA foreign_keys=ON;`;

const reformat = (sqlText: string): string =>
  sqlText.replaceAll('\n', '\r\n    ').replaceAll(', ', ',\n\t');

describe('findMissingSearchIndexSql', () => {
  test('定義が0件なら、欠けは無い', () => {
    expect(findMissingSearchIndexSql([], [])).toEqual([]);
  });

  test('索引と3つのトリガーの作成文がマイグレーションに含まれていれば、欠けは無い', () => {
    expect(
      findMissingSearchIndexSql(
        [probeIndex],
        [
          CREATE_DOCUMENTS_TABLE_SQL,
          `${renderSearchIndexSql(probeIndex)}\n${STATEMENT_BREAKPOINT}\n${renderSearchIndexRebuildSql(probeIndex)}`,
        ],
      ),
    ).toEqual([]);
  });

  test('改行・字下げ・空白の違いは無視する', () => {
    expect(
      findMissingSearchIndexSql(
        [probeIndex],
        [reformat(renderSearchIndexSql(probeIndex))],
      ),
    ).toEqual([]);
  });

  test('作成文が複数のマイグレーションに分かれていても、欠けは無い', () => {
    expect(
      findMissingSearchIndexSql(
        [probeIndex],
        [
          probeVirtualTable,
          [probeInsertTrigger, probeDeleteTrigger].join(
            `\n${STATEMENT_BREAKPOINT}\n`,
          ),
          probeUpdateTrigger,
        ],
      ),
    ).toEqual([]);
  });

  test('作成文が無ければ、定義と、欠けている全ての作成文を貼れる形で返す', () => {
    expect(
      findMissingSearchIndexSql([probeIndex], [CREATE_DOCUMENTS_TABLE_SQL]),
    ).toEqual([
      {
        definition: probeIndex,
        missingStatements: [
          probeVirtualTable,
          probeInsertTrigger,
          probeDeleteTrigger,
          probeUpdateTrigger,
        ],
      },
    ]);
  });

  test('索引する列を変えた定義は、古い作成文では満たされない', () => {
    const changed = defineSearchIndex({
      documents: probeSearchDocuments,
      textColumns: [{ column: probeSearchDocuments.name, weight: 10 }],
      keywordsWeight: 1,
    });

    const missing = findMissingSearchIndexSql(
      [changed],
      [renderSearchIndexSql(probeIndex)],
    );

    expect(missing).toEqual([
      {
        definition: changed,
        missingStatements: statementsOf(renderSearchIndexSql(changed)),
      },
    ]);
  });

  test('重みだけを変えた定義は、作成文が同じため欠けにならない', () => {
    const reweighted = defineSearchIndex({
      documents: probeSearchDocuments,
      textColumns: [
        { column: probeSearchDocuments.name, weight: 1 },
        { column: probeSearchDocuments.tagline, weight: 2 },
      ],
      keywordsWeight: 3,
    });

    expect(
      findMissingSearchIndexSql(
        [reweighted],
        [renderSearchIndexSql(probeIndex)],
      ),
    ).toEqual([]);
  });

  test('後のマイグレーションで索引文書のテーブルを作り直すと、3つのトリガーが欠けになる', () => {
    expect(
      findMissingSearchIndexSql(
        [probeIndex],
        [
          CREATE_DOCUMENTS_TABLE_SQL,
          renderSearchIndexSql(probeIndex),
          RECREATE_DOCUMENTS_TABLE_SQL,
        ],
      ),
    ).toEqual([
      {
        definition: probeIndex,
        missingStatements: [
          probeInsertTrigger,
          probeDeleteTrigger,
          probeUpdateTrigger,
        ],
      },
    ]);
  });

  test('テーブルの作り直しの後でトリガーを作り直せば、欠けは無い', () => {
    expect(
      findMissingSearchIndexSql(
        [probeIndex],
        [
          renderSearchIndexSql(probeIndex),
          RECREATE_DOCUMENTS_TABLE_SQL,
          `${renderSearchIndexTriggersSql(probeIndex)}\n${STATEMENT_BREAKPOINT}\n${renderSearchIndexRebuildSql(probeIndex)}`,
        ],
      ),
    ).toEqual([]);
  });

  test('索引する列を消す前に索引とトリガーを消し、列の削除の後に新しい定義で作り直せば、欠けは無い', () => {
    const nameOnly = defineSearchIndex({
      documents: probeSearchDocuments,
      textColumns: [{ column: probeSearchDocuments.name, weight: 10 }],
      keywordsWeight: 1,
    });

    expect(
      findMissingSearchIndexSql(
        [nameOnly],
        [
          renderSearchIndexSql(probeIndex),
          renderSearchIndexDropSql(probeIndex),
          'ALTER TABLE `probe_search_documents` DROP COLUMN `tagline`;',
          `${renderSearchIndexSql(nameOnly)}\n${STATEMENT_BREAKPOINT}\n${renderSearchIndexRebuildSql(nameOnly)}`,
        ],
      ),
    ).toEqual([]);
  });

  test('索引とトリガーを消したまま作り直さなければ、全ての作成文が欠けになる', () => {
    expect(
      findMissingSearchIndexSql(
        [probeIndex],
        [
          renderSearchIndexSql(probeIndex),
          renderSearchIndexDropSql(probeIndex),
        ],
      ),
    ).toEqual([
      {
        definition: probeIndex,
        missingStatements: statementsOf(renderSearchIndexSql(probeIndex)),
      },
    ]);
  });

  test('同じマイグレーションの中でも、作成文より後の削除で欠けになる', () => {
    expect(
      findMissingSearchIndexSql(
        [probeIndex],
        [
          `${renderSearchIndexSql(probeIndex)}\n${STATEMENT_BREAKPOINT}\nDROP TRIGGER IF EXISTS probe_search_documents_fts_ad;`,
        ],
      ),
    ).toEqual([
      { definition: probeIndex, missingStatements: [probeDeleteTrigger] },
    ]);
  });

  test('後のマイグレーションで全文検索の索引を削除すると、索引の作成文が欠けになる', () => {
    expect(
      findMissingSearchIndexSql(
        [probeIndex],
        [
          renderSearchIndexSql(probeIndex),
          'DROP TABLE IF EXISTS `probe_search_documents_fts`;',
        ],
      ),
    ).toEqual([
      { definition: probeIndex, missingStatements: [probeVirtualTable] },
    ]);
  });

  test('名前が前方で一致するだけの別のテーブルやトリガーの削除では、欠けにならない', () => {
    expect(
      findMissingSearchIndexSql(
        [probeIndex],
        [
          renderSearchIndexSql(probeIndex),
          [
            'DROP TABLE probe_search_documents_archive;',
            'DROP TABLE "probe_search_documents_fts_old";',
            'DROP TRIGGER probe_search_documents_fts_ai_legacy;',
          ].join(`\n${STATEMENT_BREAKPOINT}\n`),
        ],
      ),
    ).toEqual([]);
  });

  test('複数の定義のうち、欠けのある定義だけを返す', () => {
    const missing = findMissingSearchIndexSql(
      [probeIndex, otherIndex],
      [renderSearchIndexSql(probeIndex)],
    );

    expect(missing.map(({ definition }) => definition)).toEqual([otherIndex]);
    expect(missing[0]?.missingStatements).toHaveLength(4);
  });
});
