import {
  KEYWORDS_COLUMN_NAME,
  type SearchIndexDefinition,
} from './search-index-definition.ts';

// Workers統合テストのマイグレーションの読み込みはdrizzle-kitの区切りで文を分けて1文ずつ実行するため、文ごとに区切る
const STATEMENT_SEPARATOR = '\n--> statement-breakpoint\n';

const TRIGGER_SUFFIXES = ['ai', 'ad', 'au'] as const;

export function renderSearchIndexSql(
  definition: SearchIndexDefinition,
): string {
  return [
    createVirtualTableStatement(definition),
    ...createTriggerStatements(definition),
  ].join(STATEMENT_SEPARATOR);
}

export function renderSearchIndexTriggersSql(
  definition: SearchIndexDefinition,
): string {
  const dropStatements = TRIGGER_SUFFIXES.map(
    (suffix) => `DROP TRIGGER IF EXISTS ${triggerName(definition, suffix)};`,
  );
  return [...dropStatements, ...createTriggerStatements(definition)].join(
    STATEMENT_SEPARATOR,
  );
}

export function renderSearchIndexRebuildSql(
  definition: SearchIndexDefinition,
): string {
  const { ftsTableName } = definition;
  return `INSERT INTO ${ftsTableName}(${ftsTableName}) VALUES('rebuild');`;
}

function indexedColumnNames(definition: SearchIndexDefinition): string[] {
  return [
    ...definition.textColumns.map((column) => column.name),
    KEYWORDS_COLUMN_NAME,
  ];
}

function triggerName(
  definition: SearchIndexDefinition,
  suffix: (typeof TRIGGER_SUFFIXES)[number],
): string {
  return `${definition.documentsTableName}_fts_${suffix}`;
}

function createVirtualTableStatement(
  definition: SearchIndexDefinition,
): string {
  const { documentsTableName, ftsTableName, prefixLengths } = definition;
  return [
    `CREATE VIRTUAL TABLE ${ftsTableName} USING fts5(`,
    `  ${indexedColumnNames(definition).join(', ')},`,
    `  content='${documentsTableName}', content_rowid='id',`,
    `  tokenize='unicode61 remove_diacritics 2', prefix='${prefixLengths.join(' ')}'`,
    ');',
  ].join('\n');
}

function createTriggerStatements(definition: SearchIndexDefinition): string[] {
  const { documentsTableName, ftsTableName } = definition;
  const columns = indexedColumnNames(definition);
  const columnList = columns.join(', ');
  const valuesOf = (row: 'new' | 'old') =>
    columns.map((column) => `${row}.${column}`).join(', ');
  const insertNew = `  INSERT INTO ${ftsTableName}(rowid, ${columnList}) VALUES (new.id, ${valuesOf('new')});`;
  const deleteOld = `  INSERT INTO ${ftsTableName}(${ftsTableName}, rowid, ${columnList}) VALUES ('delete', old.id, ${valuesOf('old')});`;

  return [
    [
      `CREATE TRIGGER ${triggerName(definition, 'ai')} AFTER INSERT ON ${documentsTableName} BEGIN`,
      insertNew,
      'END;',
    ],
    [
      `CREATE TRIGGER ${triggerName(definition, 'ad')} AFTER DELETE ON ${documentsTableName} BEGIN`,
      deleteOld,
      'END;',
    ],
    [
      `CREATE TRIGGER ${triggerName(definition, 'au')} AFTER UPDATE OF ${columnList} ON ${documentsTableName} BEGIN`,
      deleteOld,
      insertNew,
      'END;',
    ],
  ].map((lines) => lines.join('\n'));
}
