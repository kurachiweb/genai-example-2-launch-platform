import { getTableName, type SQL } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import type { Database } from '../../../db/client.ts';
import { KEYWORD_STATUSES } from '../../../db/schema/_shared/search-documents.ts';
import type { SearchIndexDefinition } from '../../../db/search/search-index-definition.ts';
import type { KeywordStatus } from '../../core/search/keyword-status.ts';
import type { SearchTargetCatalog } from '../../core/search/ports.ts';
import {
  isValidSearchTargetName,
  MAX_SEARCH_TARGET_NAME_LENGTH,
  type SearchSource,
  type SearchTargetInfo,
} from '../../core/search/search-target.ts';

// coreはDBディレクトリを読み込めないため、DBの状態の値とcoreの状態の型が過不足無く同じであることをここで型検査する
type EveryKeywordStatus<TValues extends readonly KeywordStatus[]> = [
  KeywordStatus,
] extends [TValues[number]]
  ? TValues
  : never;

export const SEARCH_KEYWORD_STATUSES =
  KEYWORD_STATUSES satisfies EveryKeywordStatus<typeof KEYWORD_STATUSES>;

export interface SearchTargetDefinition<
  TField extends string = string,
> extends SearchTargetInfo<TField> {
  readonly index: SearchIndexDefinition;
  readonly documents: SQLiteTable;
  // 元データが削除済み・索引の対象外ならundefinedを返す
  read(
    db: Database,
    sourceId: string,
  ): Promise<SearchSource<TField> | undefined>;
  // 元データが存在し索引の対象であることの条件(EXISTSの中身)
  isIndexable(sourceId: string): SQL;
}

export function defineSearchTarget<TField extends string>(
  definition: SearchTargetDefinition<TField>,
): SearchTargetDefinition<TField> {
  return definition;
}

export interface SearchTargetRegistry extends SearchTargetCatalog {
  definition(name: string): SearchTargetDefinition | undefined;
}

export class SearchTargetRegistryError extends Error {
  override readonly name = 'SearchTargetRegistryError';
}

export function createSearchTargetRegistry(
  definitions: readonly SearchTargetDefinition[],
): SearchTargetRegistry {
  const byName = new Map<string, SearchTargetDefinition>();
  const targetByDocumentsTable = new Map<string, string>();

  for (const definition of definitions) {
    assertName(definition.name, byName);
    assertDocumentsTable(definition, targetByDocumentsTable);
    assertTextColumnFields(definition);
    assertExtractedField(definition);
    byName.set(definition.name, definition);
    targetByDocumentsTable.set(
      definition.index.documentsTableName,
      definition.name,
    );
  }

  const names = Object.freeze([...byName.keys()]);
  return {
    find: (name) => byName.get(name),
    definition: (name) => byName.get(name),
    names: () => names,
  };
}

function assertName(
  name: string,
  registered: ReadonlyMap<string, SearchTargetDefinition>,
): void {
  if (!isValidSearchTargetName(name)) {
    throw new SearchTargetRegistryError(
      `検索対象の名前「${name}」は、英小文字で始まる英小文字・数字・-の${String(MAX_SEARCH_TARGET_NAME_LENGTH)}文字以内の名前にしてください。`,
    );
  }
  if (registered.has(name)) {
    throw new SearchTargetRegistryError(
      `検索対象の名前${name}が重複しています。`,
    );
  }
}

function assertDocumentsTable(
  definition: SearchTargetDefinition,
  targetByDocumentsTable: ReadonlyMap<string, string>,
): void {
  const tableName = getTableName(definition.documents);
  const { documentsTableName } = definition.index;
  if (tableName !== documentsTableName) {
    throw new SearchTargetRegistryError(
      `検索対象${definition.name}の索引文書のテーブル${tableName}が、索引の定義のテーブル${documentsTableName}と異なります。`,
    );
  }

  const owner = targetByDocumentsTable.get(documentsTableName);
  if (owner !== undefined) {
    throw new SearchTargetRegistryError(
      `検索対象${definition.name}と${owner}が同じ索引文書のテーブル${documentsTableName}を使っています。`,
    );
  }
}

// 項目の名前を同名の元テキストの列へ保存するため、元テキストの列に保存する項目と索引の定義の列は過不足無く一致させる
function assertTextColumnFields(definition: SearchTargetDefinition): void {
  const fieldNames = Object.entries(definition.fields)
    .filter(([, spec]) => spec.textColumn)
    .map(([name]) => name);
  const columnNames = definition.index.textColumns.map(({ name }) => name);

  const fieldsWithoutColumn = fieldNames.filter(
    (name) => !columnNames.includes(name),
  );
  if (fieldsWithoutColumn.length > 0) {
    throw new SearchTargetRegistryError(
      `検索対象${definition.name}の項目${fieldsWithoutColumn.join('・')}は元テキストの列に保存する指定ですが、索引の定義に同名の列がありません。`,
    );
  }

  const columnsWithoutField = columnNames.filter(
    (name) => !fieldNames.includes(name),
  );
  if (columnsWithoutField.length > 0) {
    throw new SearchTargetRegistryError(
      `検索対象${definition.name}の索引の定義の列${columnsWithoutField.join('・')}に、元テキストの列に保存する同名の項目がありません。`,
    );
  }
}

function assertExtractedField(definition: SearchTargetDefinition): void {
  if (!Object.values(definition.fields).some((spec) => spec.extract)) {
    throw new SearchTargetRegistryError(
      `検索対象${definition.name}には、キーワード抽出の対象の項目を1つ以上指定してください。`,
    );
  }
}

export function requireSearchTargetDefinition(
  registry: SearchTargetRegistry,
  target: string,
): SearchTargetDefinition {
  const definition = registry.definition(target);
  if (definition === undefined) {
    throw new SearchTargetRegistryError(
      `検索対象${target}は登録されていません。`,
    );
  }
  return definition;
}
