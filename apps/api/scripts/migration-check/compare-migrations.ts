import { stripVTControlCharacters } from 'node:util';

export interface MigrationComparison {
  readonly ok: boolean;
  readonly undetected: readonly string[];
  readonly unexpected: readonly string[];
}

const MIGRATION_FILE_SUFFIX = '/migration.sql';

const NO_MIGRATIONS_MESSAGE = 'No migrations to apply!';

const MIGRATIONS_TABLE_HEADING = 'Migrations to be applied:';

const TABLE_HEADER_CELL = 'Name';

const TABLE_ROW_PATTERN = /^│(?<cell>.*)│$/u;

const NESTED_MIGRATION_PATTERN = /^(?<directory>[^/]+)\/migration\.sql$/u;

export function listMigrationNames(
  migrationDirEntries: readonly string[],
): readonly string[] {
  return migrationDirEntries
    .map((entry) => NESTED_MIGRATION_PATTERN.exec(entry)?.groups?.directory)
    .filter((directory) => directory !== undefined)
    .toSorted();
}

export function parseMigrationsListOutput(stdout: string): readonly string[] {
  const lines = stripVTControlCharacters(stdout)
    .split('\n')
    .map((line) => line.trim());

  const cells = lines
    .map((line) => TABLE_ROW_PATTERN.exec(line)?.groups?.cell?.trim())
    .filter(
      (cell): cell is string =>
        cell !== undefined && cell !== TABLE_HEADER_CELL,
    );

  if (lines.includes(MIGRATIONS_TABLE_HEADING) && cells.length > 0) {
    return cells.map(toMigrationName);
  }
  if (
    cells.length === 0 &&
    lines.some((line) => line.endsWith(NO_MIGRATIONS_MESSAGE))
  ) {
    return [];
  }
  throw new Error(
    `Wranglerのマイグレーションの一覧を解析できませんでした。出力:\n${stdout}`,
  );
}

// Wranglerはmigrations_dirからの相対パスで表示するため、保存先のディレクトリ名にそろえる。
// 入れ子の形でない名前は保存先に無い名前として検出させるため、そのまま返す
function toMigrationName(listedName: string): string {
  return listedName.endsWith(MIGRATION_FILE_SUFFIX)
    ? listedName.slice(0, -MIGRATION_FILE_SUFFIX.length)
    : listedName;
}

export function compareMigrations(
  stored: readonly string[],
  listed: readonly string[],
): MigrationComparison {
  const listedSet = new Set(listed);
  const storedSet = new Set(stored);
  const undetected = stored.filter((name) => !listedSet.has(name));
  const unexpected = listed.filter((name) => !storedSet.has(name));

  return {
    ok: undetected.length === 0 && unexpected.length === 0,
    undetected,
    unexpected,
  };
}
