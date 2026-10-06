import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { getFileInfo, resolveConfig } from 'prettier';

import config from './prettier.config.ts';
import {
  typeOnlyImportsOf,
  valueModuleReferencesOf,
} from './test-support/module-references.ts';

const ROOT = import.meta.dirname;
const ROOT_IGNORE_FILES = ['.gitignore', '.prettierignore'] as const;
const FORMAT_SCRIPTS = ['format', 'format:check'];
const SPAWN_TIMEOUT_MS = 30_000;
const PRETTIER_BIN = join(ROOT, 'node_modules/.bin/prettier');

const UNFORMATTED = {
  markdown: '*  item\n',
  json: '{"a":1}\n',
  yaml: 'key:    value\n',
  typescript: 'export const value = "x"\n',
  shell: '#!/bin/sh\n  echo   1\n',
  toml: '[test]\n  key=1\n',
  sql: 'select   1\n',
} as const;

const IGNORED_BY_PRETTIERIGNORE = [
  'mockups/src/routes/index.tsx',
  'mockups/README.md',
  'docs/ai-extensions/cc-sdd.md',
  '.claude/rules/common/testing.md',
  '.claude/settings.json',
  '.kiro/settings/templates/specs/design.md',
  'bun.lock',
  'apps/client/bun.lock',
  'apps/email/messages.json',
  'apps/db/migrations/20261004000000_init/snapshot.json',
  '.playwright-mcp/page-2026-10-04T00-00-00-000Z.yml',
  'apps/api/worker-configuration.d.ts',
  'apps/client/src/routeTree.gen.ts',
  'apps/api/src/generated/graphql.ts',
];

const IGNORED_BY_GITIGNORE = [
  'apps/api/lib/utilities/index.ts',
  'apps/client/lib/components/button.tsx',
  '.wrangler/state/v3/d1/metadata.json',
  'coverage/unit/coverage-summary.json',
];

const FORMATTED_FILES = [
  'README.md',
  'docs/GUIDES/tech/README.md',
  '.kiro/specs/dev-tooling/design.md',
  '.kiro/specs/dev-tooling/spec.json',
  'package.json',
  'compose.yaml',
  '.github/workflows/ci.yml',
  'prettier.config.ts',
  'config/test-patterns.ts',
  'apps/api/src/index.ts',
  'apps/db/schema/users.ts',
  'apps/frontend-lib/components/button.tsx',
  'apps/mockups/index.ts',
];

const UNSUPPORTED_FILES = [
  'scripts/entrypoint.sh',
  'bunfig.toml',
  'apps/api/src/query.sql',
  'Dockerfile',
  '.husky/pre-commit',
];

const fileInfoOf = (
  path: string,
  ignoreFiles: readonly string[] = ROOT_IGNORE_FILES,
): ReturnType<typeof getFileInfo> =>
  getFileInfo(join(ROOT, path), {
    ignorePath: ignoreFiles.map((name) => join(ROOT, name)),
  });

let fixtureRoot = '';

const writeFixtureFiles = async (
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

const createFixtureDir = async (
  files: Readonly<Record<string, string>>,
): Promise<string> => {
  const dir = await mkdtemp(join(fixtureRoot, 'fixture-'));
  await copyFile(
    join(ROOT, 'prettier.config.ts'),
    join(dir, 'prettier.config.ts'),
  );
  await writeFixtureFiles(dir, files);
  return dir;
};

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'prettier-config-test-'));
});

afterAll(async () => {
  if (fixtureRoot !== '') {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

interface ScriptResult {
  readonly exitCode: number;
  readonly output: string;
}

const runCommand = async (
  cwd: string,
  command: readonly string[],
): Promise<ScriptResult> => {
  const child = Bun.spawn([...command], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, output: `${stdout}\n${stderr}` };
};

const runScript = (
  cwd: string,
  args: readonly string[],
): Promise<ScriptResult> => runCommand(cwd, [process.execPath, 'run', ...args]);

const runPrettier = (
  cwd: string,
  args: readonly string[],
): Promise<ScriptResult> =>
  runCommand(cwd, [process.execPath, '--bun', PRETTIER_BIN, ...args]);

const reportedFilesOf = (output: string): readonly string[] =>
  output
    .split('\n')
    .flatMap((line) => /^\[warn\] (.+)$/.exec(line)?.[1] ?? [])
    .filter((path) => !path.startsWith('Code style issues'))
    .toSorted();

describe('prettier.config.ts', () => {
  test('既存のモックアップと同じくシングルクォートを使う整形設定をdefault exportする', () => {
    expect(config).toEqual({ singleQuote: true });
  });

  test.each([
    'README.md',
    'config/test-patterns.ts',
    '.github/workflows/ci.yml',
  ])('リポジトリ内の%sにはルートの整形設定が使われる', async (path) => {
    expect(await resolveConfig(join(ROOT, path))).toEqual({
      singleQuote: true,
    });
  });

  test('npmパッケージを型としてのみ参照し、値のimportを持たない', async () => {
    const source = await readFile(join(ROOT, 'prettier.config.ts'), 'utf8');

    expect(typeOnlyImportsOf(source).length).toBeGreaterThan(0);
    expect(valueModuleReferencesOf(source)).toEqual([]);
  });

  test(
    'アプリの整形設定は継承して差分を加えられ、アプリ配下のファイルに適用される',
    async () => {
      const formattedForApp = "export const value = 'x'\n";
      const dir = await createFixtureDir({
        'apps/client/prettier.config.ts': [
          "import base from '../../prettier.config.ts';",
          '',
          'export default { ...base, semi: false };',
          '',
        ].join('\n'),
        'apps/client/src/index.ts': formattedForApp,
        'src/index.ts': formattedForApp,
      });

      const { exitCode, output } = await runPrettier(dir, [
        '--check',
        'apps/client/src/index.ts',
        'src/index.ts',
      ]);

      expect(exitCode).toBe(1);
      expect(reportedFilesOf(output)).toEqual(['src/index.ts']);
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe('.prettierignore', () => {
  test.each(IGNORED_BY_PRETTIERIGNORE)('%sを整形対象外にする', async (path) => {
    expect((await fileInfoOf(path, ['.prettierignore'])).ignored).toBe(true);
  });

  test.each(IGNORED_BY_GITIGNORE)(
    'Gitの管理対象外の%sも整形対象外になる',
    async (path) => {
      expect((await fileInfoOf(path)).ignored).toBe(true);
    },
  );

  test.each(FORMATTED_FILES)(
    '%sを整形ツールが対応する整形対象にする',
    async (path) => {
      const { ignored, inferredParser } = await fileInfoOf(path);

      expect(ignored).toBe(false);
      expect(inferredParser).not.toBeNull();
    },
  );

  test.each(UNSUPPORTED_FILES)(
    '%sは整形ツールが対応しない種類として扱われる',
    async (path) => {
      expect((await fileInfoOf(path)).inferredParser).toBeNull();
    },
  );
});

const TARGET_FIXTURES = {
  'README.md': UNFORMATTED.markdown,
  'docs/guide.md': UNFORMATTED.markdown,
  '.kiro/specs/sample/spec.json': UNFORMATTED.json,
  'compose.yaml': UNFORMATTED.yaml,
  '.github/workflows/ci.yml': UNFORMATTED.yaml,
  'src/index.ts': UNFORMATTED.typescript,
} as const;

const EXCLUDED_FIXTURES = {
  'mockups/src/index.ts': UNFORMATTED.typescript,
  'docs/ai-extensions/guide.md': UNFORMATTED.markdown,
  '.claude/rules/rule.md': UNFORMATTED.markdown,
  '.kiro/settings/template.md': UNFORMATTED.markdown,
  'bun.lock': UNFORMATTED.json,
  'apps/email/messages.json': UNFORMATTED.json,
  'apps/db/migrations/0000_init/snapshot.json': UNFORMATTED.json,
  '.playwright-mcp/page.yml': UNFORMATTED.yaml,
  'apps/api/worker-configuration.d.ts': UNFORMATTED.typescript,
  'apps/client/src/routeTree.gen.ts': UNFORMATTED.typescript,
  'apps/api/src/generated/schema.ts': UNFORMATTED.typescript,
  'apps/api/lib/index.ts': UNFORMATTED.typescript,
  '.wrangler/state/metadata.json': UNFORMATTED.json,
} as const;

const UNSUPPORTED_FIXTURES = {
  'scripts/entrypoint.sh': UNFORMATTED.shell,
  'bunfig.toml': UNFORMATTED.toml,
  'apps/api/src/query.sql': UNFORMATTED.sql,
} as const;

const WHOLE_REPOSITORY_TARGET = ' .';

const rootScriptOf = async (name: string): Promise<string> => {
  const { scripts } = JSON.parse(
    await readFile(join(ROOT, 'package.json'), 'utf8'),
  ) as { readonly scripts: Readonly<Record<string, string>> };
  return scripts[name] ?? '';
};

const createScriptFixtureDir = async (
  toFixtureScript: (command: string) => string = (command) => command,
): Promise<string> => {
  const scripts = Object.fromEntries(
    await Promise.all(
      FORMAT_SCRIPTS.map(async (name): Promise<readonly [string, string]> => [
        name,
        toFixtureScript(await rootScriptOf(name)),
      ]),
    ),
  );
  const dir = await createFixtureDir({
    'package.json': `${JSON.stringify({ private: true, scripts }, null, 2)}\n`,
    ...TARGET_FIXTURES,
    ...EXCLUDED_FIXTURES,
    ...UNSUPPORTED_FIXTURES,
  });
  await Promise.all(
    ROOT_IGNORE_FILES.map((name) =>
      copyFile(join(ROOT, name), join(dir, name)),
    ),
  );
  await symlink(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  return dir;
};

const readFixtures = (
  dir: string,
  paths: readonly string[],
): Promise<readonly string[]> =>
  Promise.all(paths.map((path) => readFile(join(dir, path), 'utf8')));

const UNTOUCHED_FIXTURES = [
  ...Object.keys(EXCLUDED_FIXTURES),
  ...Object.keys(UNSUPPORTED_FIXTURES),
];

describe('整形のスクリプト', () => {
  test.each(FORMAT_SCRIPTS)(
    '%sはルートから実行するとリポジトリ全体を対象にする',
    async (name) => {
      expect(await rootScriptOf(name)).toEndWith(WHOLE_REPOSITORY_TARGET);
    },
  );

  test(
    '整形検査は対象外のファイルを除き、マークダウン・JSON・YAMLを含む対象ファイルの整形差分を報告して失敗終了する',
    async () => {
      const dir = await createScriptFixtureDir();

      const { exitCode, output } = await runScript(dir, ['format:check']);

      expect(exitCode).toBe(1);
      expect(reportedFilesOf(output)).toEqual(
        Object.keys(TARGET_FIXTURES).toSorted(),
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    '整形は対象外と対応しない種類のファイルを変更せず、整形後の整形検査は成功する',
    async () => {
      const dir = await createScriptFixtureDir();
      const before = await readFixtures(dir, UNTOUCHED_FIXTURES);

      const formatResult = await runScript(dir, ['format']);
      const checkResult = await runScript(dir, ['format:check']);

      expect(formatResult.exitCode).toBe(0);
      expect(await readFixtures(dir, UNTOUCHED_FIXTURES)).toEqual(before);
      expect(checkResult.exitCode).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  test.each(FORMAT_SCRIPTS)(
    '%sは対象のファイルを明示されても、整形ツールが対応しない種類のファイルを無視する',
    async (name) => {
      const dir = await createScriptFixtureDir((command) =>
        command.slice(0, -WHOLE_REPOSITORY_TARGET.length),
      );
      const before = await readFixtures(dir, UNTOUCHED_FIXTURES);

      const { exitCode } = await runScript(dir, [
        name,
        ...Object.keys(UNSUPPORTED_FIXTURES),
      ]);

      expect(exitCode).toBe(0);
      expect(await readFixtures(dir, UNTOUCHED_FIXTURES)).toEqual(before);
    },
    SPAWN_TIMEOUT_MS,
  );
});
