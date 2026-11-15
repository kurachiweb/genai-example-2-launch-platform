import type { SearchIndexDefinition } from '../search/search-index-definition.ts';
import {
  renderSearchIndexDropSql,
  renderSearchIndexRebuildSql,
  renderSearchIndexSql,
  renderSearchIndexTriggersSql,
  STATEMENT_SEPARATOR,
} from '../search/search-index-sql.ts';
import { SEARCH_INDEXES } from '../search/search-indexes.ts';

interface TextSink {
  readonly write: (text: string) => unknown;
}

interface CommandOutput {
  readonly stdout: TextSink;
  readonly stderr: TextSink;
}

const TRIGGERS_OPTION = '--triggers';
const REBUILD_OPTION = '--rebuild';
const DROP_OPTION = '--drop';
const RECREATE_OPTION = '--recreate';
const COMBINABLE_OPTIONS: readonly string[] = [TRIGGERS_OPTION, REBUILD_OPTION];
const STANDALONE_OPTIONS: readonly string[] = [DROP_OPTION, RECREATE_OPTION];

const USAGE = `使い方: bun run db:search-index-sql <索引文書のテーブル名> [${TRIGGERS_OPTION}] [${REBUILD_OPTION}] | ${DROP_OPTION} | ${RECREATE_OPTION}`;

export class SearchIndexSqlRequestError extends Error {
  override readonly name = 'SearchIndexSqlRequestError';
}

function isValidOptionSet(options: readonly string[]): boolean {
  const [first] = options;
  if (first !== undefined && STANDALONE_OPTIONS.includes(first)) {
    return options.length === 1;
  }
  return options.every((option) => COMBINABLE_OPTIONS.includes(option));
}

function findDefinition(
  name: string,
  definitions: readonly SearchIndexDefinition[],
): SearchIndexDefinition {
  const definition = definitions.find(
    (candidate) => candidate.documentsTableName === name,
  );
  if (definition === undefined) {
    const registered =
      definitions.map((candidate) => candidate.documentsTableName).join('・') ||
      '(無し)';
    throw new SearchIndexSqlRequestError(
      `${name}の索引の定義はSEARCH_INDEXESに登録されていません。登録済みの名前: ${registered}`,
    );
  }
  return definition;
}

function renderStatements(
  definition: SearchIndexDefinition,
  options: readonly string[],
): string[] {
  if (options.includes(DROP_OPTION)) {
    return [renderSearchIndexDropSql(definition)];
  }
  if (options.includes(RECREATE_OPTION)) {
    return [
      renderSearchIndexDropSql(definition),
      renderSearchIndexSql(definition),
      renderSearchIndexRebuildSql(definition),
    ];
  }
  if (options.length === 0) {
    return [renderSearchIndexSql(definition)];
  }
  return [
    ...(options.includes(TRIGGERS_OPTION)
      ? [renderSearchIndexTriggersSql(definition)]
      : []),
    ...(options.includes(REBUILD_OPTION)
      ? [renderSearchIndexRebuildSql(definition)]
      : []),
  ];
}

export function renderRequestedSearchIndexSql(
  args: readonly string[],
  definitions: readonly SearchIndexDefinition[],
): string {
  const options = args.filter((arg) => arg.startsWith('--'));
  const names = args.filter((arg) => !arg.startsWith('--'));
  const [name] = names;
  if (name === undefined || names.length > 1 || !isValidOptionSet(options)) {
    throw new SearchIndexSqlRequestError(USAGE);
  }

  return renderStatements(findDefinition(name, definitions), options).join(
    STATEMENT_SEPARATOR,
  );
}

export function runPrintSearchIndexSql(
  args: readonly string[],
  definitions: readonly SearchIndexDefinition[],
  output: CommandOutput,
): number {
  try {
    output.stdout.write(
      `${renderRequestedSearchIndexSql(args, definitions)}\n`,
    );
    return 0;
  } catch (error) {
    output.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = runPrintSearchIndexSql(
    process.argv.slice(2),
    SEARCH_INDEXES,
    process,
  );
}
