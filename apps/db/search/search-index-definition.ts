import { getColumnTable, getTableName } from 'drizzle-orm';
import {
  getTableConfig,
  type SQLiteColumn,
  type SQLiteTable,
} from 'drizzle-orm/sqlite-core';

import { SQLITE_KEYWORDS } from './sqlite-keywords.ts';

export const SEARCH_DOCUMENT_COLUMN_NAMES = [
  'id',
  'source_id',
  'source_version',
  'keywords',
  'keyword_status',
  'extraction_input_hash',
  'status_changed_at',
] as const;

export const KEYWORDS_COLUMN_NAME = 'keywords';

const DOCUMENTS_TABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*_search_documents$/;
const COLUMN_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const FTS5_RESERVED_COLUMN_NAMES: readonly string[] = ['rank', 'rowid'];
const DEFAULT_PREFIX_LENGTHS: readonly number[] = [2, 3];
const MIN_PREFIX_LENGTH = 1;
const MAX_PREFIX_LENGTH = 4;

// SQLのひな形は名前を引用符無しで埋め込むため、検証を通さずに組み立てた値を型で拒否する
declare const validatedSearchIndex: unique symbol;

export interface SearchIndexColumnInput {
  readonly column: SQLiteColumn;
  readonly weight: number;
}

export interface SearchIndexDefinition {
  readonly [validatedSearchIndex]: true;
  readonly documentsTableName: string;
  readonly ftsTableName: string;
  readonly textColumns: readonly {
    readonly name: string;
    readonly weight: number;
  }[];
  readonly keywordsWeight: number;
  readonly prefixLengths: readonly number[];
}

export interface SearchIndexDefinitionInput {
  readonly documents: SQLiteTable;
  readonly textColumns: readonly SearchIndexColumnInput[];
  readonly keywordsWeight: number;
  readonly prefixLengths?: readonly number[];
}

export class SearchIndexDefinitionError extends Error {
  override readonly name = 'SearchIndexDefinitionError';
}

export function defineSearchIndex(
  input: SearchIndexDefinitionInput,
): SearchIndexDefinition {
  const documentsTableName = getTableName(input.documents);
  const ftsTableName = `${documentsTableName}_fts`;
  const prefixLengths = input.prefixLengths ?? DEFAULT_PREFIX_LENGTHS;

  assertDocumentsTableName(documentsTableName);
  assertSearchDocumentColumns(input.documents, documentsTableName);
  assertTextColumns(input, documentsTableName, ftsTableName);
  assertWeight(KEYWORDS_COLUMN_NAME, input.keywordsWeight);
  assertPrefixLengths(prefixLengths);

  const definition: Omit<SearchIndexDefinition, typeof validatedSearchIndex> = {
    documentsTableName,
    ftsTableName,
    textColumns: input.textColumns.map(({ column, weight }) => ({
      name: column.name,
      weight,
    })),
    keywordsWeight: input.keywordsWeight,
    prefixLengths: [...prefixLengths],
  };
  return definition as SearchIndexDefinition;
}

function assertDocumentsTableName(name: string): void {
  if (!DOCUMENTS_TABLE_NAME_PATTERN.test(name)) {
    throw new SearchIndexDefinitionError(
      `索引文書のテーブル名${name}は、英小文字で始まる英小文字・数字・_の名前に_search_documentsを付けた名前にしてください。`,
    );
  }
}

function assertSearchDocumentColumns(
  documents: SQLiteTable,
  tableName: string,
): void {
  const columns = getTableConfig(documents).columns;
  const missing = SEARCH_DOCUMENT_COLUMN_NAMES.filter(
    (name) => !columns.some((column) => column.name === name),
  );
  if (missing.length > 0) {
    throw new SearchIndexDefinitionError(
      `${tableName}に共通の列${missing.join('・')}がありません。searchDocumentColumns()を展開して定義してください。`,
    );
  }

  const id = columns.find((column) => column.name === 'id');
  if (id?.getSQLType() !== 'integer' || !id.primary) {
    throw new SearchIndexDefinitionError(
      `${tableName}のidが整数の主キーではありません。searchDocumentColumns()のidを使ってください。`,
    );
  }
}

function assertTextColumns(
  input: SearchIndexDefinitionInput,
  tableName: string,
  ftsTableName: string,
): void {
  if (input.textColumns.length === 0) {
    throw new SearchIndexDefinitionError(
      `${tableName}の索引には元テキストの列を1つ以上指定してください。`,
    );
  }

  const seen = new Set<string>();
  for (const { column, weight } of input.textColumns) {
    const { name } = column;
    if (getColumnTable(column) !== input.documents) {
      throw new SearchIndexDefinitionError(
        `列${name}は${tableName}の列ではありません。`,
      );
    }
    if ((SEARCH_DOCUMENT_COLUMN_NAMES as readonly string[]).includes(name)) {
      throw new SearchIndexDefinitionError(
        `列${name}は共通の列のため、元テキストの列に指定できません。`,
      );
    }
    assertColumnName(name, ftsTableName);
    if (seen.has(name)) {
      throw new SearchIndexDefinitionError(
        `列${name}が元テキストの列に重複して指定されています。`,
      );
    }
    seen.add(name);
    assertWeight(name, weight);
  }
}

// ひな形のSQLは列名を引用符無しで埋め込むため、SQLの語として解釈され得る名前を拒否する
function assertColumnName(name: string, ftsTableName: string): void {
  if (!COLUMN_NAME_PATTERN.test(name)) {
    throw new SearchIndexDefinitionError(
      `列名${name}は、英小文字で始まる英小文字・数字・_の名前にしてください。`,
    );
  }
  if (SQLITE_KEYWORDS.includes(name)) {
    throw new SearchIndexDefinitionError(
      `列名${name}はSQLiteの予約語のため使えません。`,
    );
  }
  if (FTS5_RESERVED_COLUMN_NAMES.includes(name) || name === ftsTableName) {
    throw new SearchIndexDefinitionError(
      `列名${name}は全文検索の索引で予約されているため使えません。`,
    );
  }
}

function assertWeight(columnName: string, weight: number): void {
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new SearchIndexDefinitionError(
      `列${columnName}の重みは0より大きい有限の数にしてください。`,
    );
  }
}

function assertPrefixLengths(prefixLengths: readonly number[]): void {
  const isValid =
    prefixLengths.length > 0 &&
    prefixLengths.every(
      (length, index) =>
        Number.isInteger(length) &&
        length >= MIN_PREFIX_LENGTH &&
        length <= MAX_PREFIX_LENGTH &&
        (index === 0 || length > (prefixLengths[index - 1] ?? length)),
    );
  if (!isValid) {
    throw new SearchIndexDefinitionError(
      `前方一致の長さ[${prefixLengths.join(', ')}]は、${String(MIN_PREFIX_LENGTH)}〜${String(MAX_PREFIX_LENGTH)}の整数を重複無しの昇順で1つ以上並べてください。`,
    );
  }
}
