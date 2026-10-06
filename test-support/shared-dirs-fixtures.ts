import { afterAll, beforeAll } from 'bun:test';
import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { APPS, SHARED_DIRS } from '../config/workspace-layout.ts';
import {
  type FileIdentityReader,
  type PlacementReport,
  type PlacementState,
  readFileIdentity,
} from '../scripts/tooling/shared-dirs.ts';

export const MOUNTS = SHARED_DIRS.flatMap(({ source, mounts }) =>
  mounts.map(({ target }) => ({ source, target })),
);

export const TARGETS = MOUNTS.map(({ target }) => target);

export const CONSUMER_DIRS = APPS.filter((app) =>
  SHARED_DIRS.some(({ mounts }) =>
    mounts.some(({ consumer }) => consumer === app.name),
  ),
).map((app) => app.dir);

export const SOURCE_FILES: Readonly<Record<string, string>> = {
  'apps/db/index.ts': "export * from './schema/users.ts';\n",
  'apps/db/schema/users.ts': "export const users = 'users';\n",
  'apps/backend-lib/utilities/clock.ts':
    'export const now = (): number => Date.now();\n',
  'apps/frontend-lib/components/button.tsx':
    'export const Button = () => null;\n',
};

export const SOURCE_NODE_MODULES_FILES: Readonly<Record<string, string>> = {
  'apps/db/node_modules/drizzle-orm/package.json': '{"name":"drizzle-orm"}\n',
  'apps/frontend-lib/node_modules/react/package.json': '{"name":"react"}\n',
};

export const withoutSourceDir = (
  sourceDir: string,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(SOURCE_FILES).filter(
      ([path]) => !path.startsWith(`${sourceDir}/`),
    ),
  );

export const writeFixtureFiles = async (
  dir: string,
  files: Readonly<Record<string, string>>,
): Promise<void> => {
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), content);
    }),
  );
};

export interface RepositoryOptions {
  readonly consumerDirs?: readonly string[];
  readonly files?: Readonly<Record<string, string>>;
}

export type RepositoryFactory = (
  options?: RepositoryOptions,
) => Promise<string>;

// 一時ディレクトリをテストファイルごとに作って最後に消し、リポジトリ内に残骸を作らない
export const useRepositoryFixtures = (): RepositoryFactory => {
  let fixtureRoot = '';

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'shared-dirs-test-'));
  });

  afterAll(async () => {
    if (fixtureRoot !== '') {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  return async ({
    consumerDirs = CONSUMER_DIRS,
    files = { ...SOURCE_FILES, ...SOURCE_NODE_MODULES_FILES },
  } = {}) => {
    const repoRoot = await mkdtemp(join(fixtureRoot, 'repo-'));
    await writeFixtureFiles(repoRoot, files);
    await writeFixtureFiles(
      repoRoot,
      Object.fromEntries(
        consumerDirs.map((dir) => [`${dir}/package.json`, '{}\n']),
      ),
    );
    return repoRoot;
  };
};

export const statesOf = (
  reports: readonly PlacementReport[],
): Readonly<Record<string, PlacementState>> =>
  Object.fromEntries(reports.map(({ target, state }) => [target, state]));

export const allTargetsIn = (
  state: PlacementState,
  overrides: Readonly<Record<string, PlacementState>> = {},
): Readonly<Record<string, PlacementState>> => ({
  ...Object.fromEntries(TARGETS.map((target) => [target, state])),
  ...overrides,
});

export const reportsIn = (
  state: PlacementState,
  overrides: Readonly<Record<string, PlacementState>> = {},
): readonly PlacementReport[] =>
  MOUNTS.map(({ source, target }) => ({
    source,
    target,
    state: overrides[target] ?? state,
  }));

const describeEntry = (dir: string, path: string): string => {
  const fullPath = join(dir, path);
  const stats = lstatSync(fullPath);
  if (stats.isSymbolicLink()) return `link ${path} ${readlinkSync(fullPath)}`;
  if (stats.isDirectory()) return `dir ${path} ${String(stats.ino)}`;
  return `file ${path} ${String(stats.ino)} ${String(stats.mtimeMs)} ${readFileSync(fullPath, 'utf8')}`;
};

// 削除して作り直すと内容が同じでもinodeか更新日時が変わるため、node_modulesを含む全項目のそれらを記録して変更の有無を比べる
export const snapshotTree = (dir: string): readonly string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((path) => describeEntry(dir, path))
    .toSorted();

// テストではbind mountを作れないため、指定した配置先のinode・デバイスを配置元のものとして読み取らせる
export const simulateBindMounts =
  (repoRoot: string, targets: readonly string[]): FileIdentityReader =>
  (path) => {
    const mount = MOUNTS.find(
      ({ target }) =>
        targets.includes(target) && join(repoRoot, target) === path,
    );
    return readFileIdentity(
      mount === undefined ? path : join(repoRoot, mount.source),
    );
  };
