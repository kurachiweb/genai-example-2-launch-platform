import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { snakeCase } from 'drizzle-orm/sqlite-core';

import {
  searchDocumentColumns,
  searchTextColumn,
} from '../schema/_shared/search-documents.ts';
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

const probeSearchDocuments = snakeCase.table('probe_search_documents', {
  ...searchDocumentColumns(),
  name: searchTextColumn('name'),
  tagline: searchTextColumn('tagline'),
});

const defineProbeIndex = (
  weights: { name: number; tagline: number; keywords: number },
  prefixLengths?: readonly number[],
): SearchIndexDefinition =>
  defineSearchIndex({
    documents: probeSearchDocuments,
    textColumns: [
      { column: probeSearchDocuments.name, weight: weights.name },
      { column: probeSearchDocuments.tagline, weight: weights.tagline },
    ],
    keywordsWeight: weights.keywords,
    ...(prefixLengths === undefined ? {} : { prefixLengths }),
  });

const definition = defineProbeIndex({ name: 10, tagline: 5, keywords: 1 });

// drizzle-kit generateが共通の列と2つの元テキストの列から生成するテーブル
const CREATE_DOCUMENTS_TABLE_SQL = `CREATE TABLE \`probe_search_documents\` (
	\`id\` integer PRIMARY KEY,
	\`source_id\` text NOT NULL UNIQUE,
	\`source_version\` integer DEFAULT 0 NOT NULL,
	\`keywords\` text DEFAULT '' NOT NULL,
	\`keyword_status\` text DEFAULT 'pending' NOT NULL,
	\`extraction_input_hash\` text,
	\`status_changed_at\` integer NOT NULL,
	\`name\` text DEFAULT '' NOT NULL,
	\`tagline\` text DEFAULT '' NOT NULL
);`;

// 列の追加でdrizzle-kit generateが出力する、テーブルの作り直しの手順
const RECREATE_DOCUMENTS_TABLE_SQL = `PRAGMA foreign_keys=OFF;
CREATE TABLE \`__new_probe_search_documents\` (
	\`id\` integer PRIMARY KEY,
	\`source_id\` text NOT NULL UNIQUE,
	\`source_version\` integer DEFAULT 0 NOT NULL,
	\`keywords\` text DEFAULT '' NOT NULL,
	\`keyword_status\` text DEFAULT 'pending' NOT NULL,
	\`extraction_input_hash\` text,
	\`status_changed_at\` integer NOT NULL,
	\`name\` text DEFAULT '' NOT NULL,
	\`tagline\` text DEFAULT '' NOT NULL,
	\`locale\` text DEFAULT 'ja' NOT NULL
);
INSERT INTO \`__new_probe_search_documents\`(\`id\`, \`source_id\`, \`source_version\`, \`keywords\`, \`keyword_status\`, \`extraction_input_hash\`, \`status_changed_at\`, \`name\`, \`tagline\`) SELECT \`id\`, \`source_id\`, \`source_version\`, \`keywords\`, \`keyword_status\`, \`extraction_input_hash\`, \`status_changed_at\`, \`name\`, \`tagline\` FROM \`probe_search_documents\`;
DROP TABLE \`probe_search_documents\`;
ALTER TABLE \`__new_probe_search_documents\` RENAME TO \`probe_search_documents\`;
PRAGMA foreign_keys=ON;`;

const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

interface ProbeDocument {
  readonly sourceId: string;
  readonly name?: string;
  readonly tagline?: string;
  readonly keywords?: string;
}

let db: Database;

const setUp = (target: SearchIndexDefinition = definition) => {
  db.run(CREATE_DOCUMENTS_TABLE_SQL);
  db.run(renderSearchIndexSql(target));
};

const insertDocument = ({
  sourceId,
  name = '',
  tagline = '',
  keywords = '',
}: ProbeDocument) => {
  db.query(
    'INSERT INTO probe_search_documents (source_id, name, tagline, keywords, status_changed_at) VALUES (?, ?, ?, ?, 0)',
  ).run(sourceId, name, tagline, keywords);
};

const search = (
  matchExpression: string,
  target: SearchIndexDefinition = definition,
): string[] => {
  const weights = [
    ...target.textColumns.map((column) => column.weight),
    target.keywordsWeight,
  ].join(', ');
  return db
    .query<{ source_id: string }, [string]>(
      `SELECT d.source_id AS source_id FROM probe_search_documents_fts JOIN probe_search_documents AS d ON d.id = probe_search_documents_fts.rowid WHERE probe_search_documents_fts MATCH ? ORDER BY bm25(probe_search_documents_fts, ${weights}), d.source_id`,
    )
    .all(matchExpression)
    .map((row) => row.source_id);
};

const checkIntegrity = () => {
  db.run(
    "INSERT INTO probe_search_documents_fts(probe_search_documents_fts, rank) VALUES ('integrity-check', 1)",
  );
};

const snapshotIndexData = () =>
  db
    .query<{ id: number; block: Uint8Array }, []>(
      'SELECT id, block FROM probe_search_documents_fts_data ORDER BY id',
    )
    .all();

const triggerNames = () =>
  db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
    )
    .all()
    .map((row) => row.name);

beforeEach(() => {
  db = new Database(':memory:');
});

afterEach(() => {
  db.close();
});

describe('renderSearchIndexSql', () => {
  test('external contentの全文検索の索引と、追加・削除・索引する列の更新の3つのトリガーを、文の区切りで分けて返す', () => {
    expect(renderSearchIndexSql(definition)).toBe(
      `CREATE VIRTUAL TABLE probe_search_documents_fts USING fts5(
  name, tagline, keywords,
  content='probe_search_documents', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2', prefix='2 3'
);
${STATEMENT_BREAKPOINT}
CREATE TRIGGER probe_search_documents_fts_ai AFTER INSERT ON probe_search_documents BEGIN
  INSERT INTO probe_search_documents_fts(rowid, name, tagline, keywords) VALUES (new.id, new.name, new.tagline, new.keywords);
END;
${STATEMENT_BREAKPOINT}
CREATE TRIGGER probe_search_documents_fts_ad AFTER DELETE ON probe_search_documents BEGIN
  INSERT INTO probe_search_documents_fts(probe_search_documents_fts, rowid, name, tagline, keywords) VALUES ('delete', old.id, old.name, old.tagline, old.keywords);
END;
${STATEMENT_BREAKPOINT}
CREATE TRIGGER probe_search_documents_fts_au AFTER UPDATE OF name, tagline, keywords ON probe_search_documents BEGIN
  INSERT INTO probe_search_documents_fts(probe_search_documents_fts, rowid, name, tagline, keywords) VALUES ('delete', old.id, old.name, old.tagline, old.keywords);
  INSERT INTO probe_search_documents_fts(rowid, name, tagline, keywords) VALUES (new.id, new.name, new.tagline, new.keywords);
END;`,
    );
  });

  test('前方一致の長さの指定を、索引のprefixに反映する', () => {
    expect(
      renderSearchIndexSql(
        defineProbeIndex({ name: 1, tagline: 1, keywords: 1 }, [1, 2, 3, 4]),
      ),
    ).toContain("prefix='1 2 3 4'");
  });

  test('作成した索引が、追加・更新・削除の後も索引文書のテーブルと一致する', () => {
    setUp();

    insertDocument({ sourceId: 'a', name: 'Launch Stadium' });
    insertDocument({ sourceId: 'b', tagline: 'stadium tour' });
    checkIntegrity();
    expect(search('stadium')).toEqual(['a', 'b']);

    db.run(
      "UPDATE probe_search_documents SET name = 'Orbit Board' WHERE source_id = 'a'",
    );
    checkIntegrity();
    expect(search('stadium')).toEqual(['b']);
    expect(search('orbit')).toEqual(['a']);

    db.run(
      "UPDATE probe_search_documents SET keywords = 'arena' WHERE source_id = 'b'",
    );
    checkIntegrity();
    expect(search('arena')).toEqual(['b']);

    db.run("DELETE FROM probe_search_documents WHERE source_id = 'b'");
    checkIntegrity();
    expect(search('stadium')).toEqual([]);
    expect(search('arena')).toEqual([]);
    expect(search('orbit')).toEqual(['a']);
  });

  test('状態の列だけの更新では全文検索の索引を書き換えず、索引する列を含む更新では書き換える', () => {
    setUp();
    insertDocument({ sourceId: 'a', name: 'Launch Stadium' });

    const initial = snapshotIndexData();
    db.run(
      "UPDATE probe_search_documents SET keyword_status = 'extracted', status_changed_at = 1, source_version = 2, extraction_input_hash = 'h' WHERE source_id = 'a'",
    );
    expect(snapshotIndexData()).toEqual(initial);

    db.run(
      "UPDATE probe_search_documents SET keyword_status = 'pending', name = name WHERE source_id = 'a'",
    );
    expect(snapshotIndexData()).not.toEqual(initial);
    checkIntegrity();
    expect(search('stadium')).toEqual(['a']);
  });

  test('前方一致の検索語で、語の先頭が一致する文書だけが見つかる', () => {
    setUp();
    insertDocument({ sourceId: 'a', name: 'Launchpad' });
    insertDocument({ sourceId: 'b', name: 'Relaunch' });

    expect(search('"l"*')).toEqual(['a']);
    expect(search('"la"*')).toEqual(['a']);
    expect(search('"lau"*')).toEqual(['a']);
    expect(search('"launchp"*')).toEqual(['a']);
    expect(search('"pad"*')).toEqual([]);
    expect(search('"launch"')).toEqual([]);
  });

  test('列ごとの重みの大きい列で一致した文書から順に並ぶ', () => {
    setUp();
    insertDocument({
      sourceId: 'keywords-hit',
      name: 'beta',
      tagline: 'gamma',
      keywords: 'alpha',
    });
    insertDocument({
      sourceId: 'tagline-hit',
      name: 'beta',
      tagline: 'alpha',
      keywords: 'gamma',
    });
    insertDocument({
      sourceId: 'name-hit',
      name: 'alpha',
      tagline: 'beta',
      keywords: 'gamma',
    });

    expect(search('alpha')).toEqual([
      'name-hit',
      'tagline-hit',
      'keywords-hit',
    ]);
    expect(
      search('alpha', defineProbeIndex({ name: 1, tagline: 5, keywords: 10 })),
    ).toEqual(['keywords-hit', 'tagline-hit', 'name-hit']);
  });

  test('大文字小文字と発音区別符号の違いを無視して照合する', () => {
    setUp();
    insertDocument({ sourceId: 'a', name: 'Café Résumé' });
    insertDocument({ sourceId: 'b', keywords: 'NAÏVE' });

    expect(search('cafe')).toEqual(['a']);
    expect(search('CAFE')).toEqual(['a']);
    expect(search('"résumé"')).toEqual(['a']);
    expect(search('resume')).toEqual(['a']);
    expect(search('"naive"*')).toEqual(['b']);
  });
});

describe('renderSearchIndexTriggersSql', () => {
  test('3つのトリガーを消してから作り直すSQLを、文の区切りで分けて返す', () => {
    const triggers = renderSearchIndexSql(definition)
      .split(`\n${STATEMENT_BREAKPOINT}\n`)
      .slice(1);

    expect(renderSearchIndexTriggersSql(definition)).toBe(
      [
        'DROP TRIGGER IF EXISTS probe_search_documents_fts_ai;',
        'DROP TRIGGER IF EXISTS probe_search_documents_fts_ad;',
        'DROP TRIGGER IF EXISTS probe_search_documents_fts_au;',
        ...triggers,
      ].join(`\n${STATEMENT_BREAKPOINT}\n`),
    );
  });

  test('トリガーがある状態で実行しても、トリガーは重複せず索引が二重に書き込まれない', () => {
    setUp();
    insertDocument({ sourceId: 'a', name: 'Launch Stadium' });

    db.run(renderSearchIndexTriggersSql(definition));

    expect(triggerNames()).toEqual([
      'probe_search_documents_fts_ad',
      'probe_search_documents_fts_ai',
      'probe_search_documents_fts_au',
    ]);
    insertDocument({ sourceId: 'b', name: 'Stadium Pass' });
    db.run(
      "UPDATE probe_search_documents SET name = 'Orbit' WHERE source_id = 'a'",
    );
    checkIntegrity();
    expect(search('stadium')).toEqual(['b']);
  });
});

describe('renderSearchIndexRebuildSql', () => {
  test('索引文書のテーブルから全文検索の索引を全件作り直すSQLを返す', () => {
    expect(renderSearchIndexRebuildSql(definition)).toBe(
      "INSERT INTO probe_search_documents_fts(probe_search_documents_fts) VALUES('rebuild');",
    );
  });

  test('索引文書のテーブルを作り直した後、トリガーを作り直して再構築すると検索結果が元に戻る', () => {
    setUp();
    insertDocument({
      sourceId: 'a',
      name: 'Launch Stadium',
      keywords: 'rocket',
    });
    insertDocument({ sourceId: 'b', tagline: 'stadium tour' });
    insertDocument({ sourceId: 'c', name: 'Orbit Board' });
    const unchangedTerms = ['stadium', 'rocket', '"tou"*', 'board'];
    const before = unchangedTerms.map((term) => search(term));

    db.run(RECREATE_DOCUMENTS_TABLE_SQL);
    expect(triggerNames()).toEqual([]);
    db.run(
      "UPDATE probe_search_documents SET name = 'Comet Board' WHERE source_id = 'c'",
    );
    expect(search('orbit')).toEqual(['c']);
    expect(search('comet')).toEqual([]);
    expect(() => {
      checkIntegrity();
    }).toThrow();

    db.run(renderSearchIndexTriggersSql(definition));
    db.run(renderSearchIndexRebuildSql(definition));

    checkIntegrity();
    expect(unchangedTerms.map((term) => search(term))).toEqual(before);
    expect(search('orbit')).toEqual([]);
    expect(search('comet')).toEqual(['c']);

    insertDocument({ sourceId: 'd', name: 'Stadium Map' });
    db.run(
      "UPDATE probe_search_documents SET keywords = 'galaxy' WHERE source_id = 'b'",
    );
    checkIntegrity();
    expect(search('stadium').toSorted()).toEqual(['a', 'b', 'd']);
    expect(search('galaxy')).toEqual(['b']);
  });
});

describe('renderSearchIndexDropSql', () => {
  const nameOnlyDefinition = defineSearchIndex({
    documents: probeSearchDocuments,
    textColumns: [{ column: probeSearchDocuments.name, weight: 10 }],
    keywordsWeight: 1,
  });

  const seedDocuments = () => {
    insertDocument({ sourceId: 'a', name: 'Launch Stadium', tagline: 'orbit' });
    insertDocument({ sourceId: 'b', tagline: 'stadium tour' });
  };

  test('全文検索の索引と3つのトリガーを、存在する場合だけ消すSQLを、文の区切りで分けて返す', () => {
    expect(renderSearchIndexDropSql(definition)).toBe(
      [
        'DROP TABLE IF EXISTS probe_search_documents_fts;',
        'DROP TRIGGER IF EXISTS probe_search_documents_fts_ai;',
        'DROP TRIGGER IF EXISTS probe_search_documents_fts_ad;',
        'DROP TRIGGER IF EXISTS probe_search_documents_fts_au;',
      ].join(`\n${STATEMENT_BREAKPOINT}\n`),
    );
  });

  test('既存の索引に作成文だけを重ねると、索引が既にあるため失敗する', () => {
    setUp();

    expect(() => db.run(renderSearchIndexSql(nameOnlyDefinition))).toThrow(
      /already exists/,
    );
  });

  test('索引している列は、先にトリガーを消さないと列の削除が失敗する', () => {
    setUp();

    expect(() =>
      db.run('ALTER TABLE probe_search_documents DROP COLUMN tagline'),
    ).toThrow(/no such column: new\.tagline/);
  });

  test('消してから列を削除し、新しい定義で作り直して再構築すると、残った列で検索できる', () => {
    setUp();
    seedDocuments();

    db.run(renderSearchIndexDropSql(definition));
    db.run('ALTER TABLE probe_search_documents DROP COLUMN tagline');
    db.run(renderSearchIndexSql(nameOnlyDefinition));
    db.run(renderSearchIndexRebuildSql(nameOnlyDefinition));

    checkIntegrity();
    expect(search('stadium', nameOnlyDefinition)).toEqual(['a']);
    expect(search('orbit', nameOnlyDefinition)).toEqual([]);
    db.run(
      "INSERT INTO probe_search_documents (source_id, name, status_changed_at) VALUES ('c', 'Stadium Map', 0)",
    );
    checkIntegrity();
    expect(search('stadium', nameOnlyDefinition)).toEqual(['a', 'c']);
  });

  test('消してから前方一致の長さを変えた定義で作り直して再構築すると、新しい前方一致の長さの索引になる', () => {
    const longerPrefix = defineProbeIndex(
      { name: 10, tagline: 5, keywords: 1 },
      [2, 3, 4],
    );
    setUp();
    seedDocuments();

    db.run(renderSearchIndexDropSql(longerPrefix));
    db.run(renderSearchIndexSql(longerPrefix));
    db.run(renderSearchIndexRebuildSql(longerPrefix));

    checkIntegrity();
    expect(
      db
        .query<{ sql: string }, []>(
          "SELECT sql FROM sqlite_master WHERE name = 'probe_search_documents_fts'",
        )
        .get()?.sql,
    ).toContain("prefix='2 3 4'");
    expect(search('"stad"*', longerPrefix)).toEqual(['a', 'b']);
    expect(triggerNames()).toEqual([
      'probe_search_documents_fts_ad',
      'probe_search_documents_fts_ai',
      'probe_search_documents_fts_au',
    ]);
  });

  test('索引もトリガーも無い状態で実行しても失敗しない', () => {
    db.run(CREATE_DOCUMENTS_TABLE_SQL);

    expect(() => db.run(renderSearchIndexDropSql(definition))).not.toThrow();
  });
});
