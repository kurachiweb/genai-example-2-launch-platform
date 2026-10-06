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
import { dirname, join, relative } from 'node:path';

import { ESLint, type Linter } from 'eslint';

const ROOT = import.meta.dirname;
const SPAWN_TIMEOUT_MS = 60_000;

const eslint = new ESLint({
  cwd: ROOT,
  overrideConfigFile: join(ROOT, 'eslint.config.ts'),
});

const ROOT_OWNED_FILES = [
  'eslint.config.ts',
  'eslint.config.base.ts',
  'eslint.config.base.unit.test.ts',
  'config/test-patterns.ts',
  'config/vitest/browser.ts',
  'scripts/merge-claude-trust-config.ts',
  'scripts/tooling/staged-tasks.ts',
  'e2e/support/targets.ts',
  'test-support/module-references.ts',
];

const NOT_ROOT_OWNED_FILES = [
  'apps/api/src/index.ts',
  'apps/event/src/index.ts',
  'apps/backend-lib/utilities/index.ts',
  'apps/db/schema/users.ts',
  'apps/frontend-lib/components/button.tsx',
  'apps/client/src/routes/index.tsx',
  'mockups/src/routes/index.tsx',
  'mockups/eslint.config.ts',
  '.claude/hooks/hook.js',
  'docs/ai-extensions/example.js',
  '.kiro/settings/templates/example.js',
  'test-results/trace/sw.bundle.js',
  'playwright-report/trace/sw.bundle.js',
];

const severityOf = (entry: Linter.RuleEntry | undefined): unknown =>
  Array.isArray(entry) ? entry[0] : entry;

describe('eslint.config.ts', () => {
  test.each(ROOT_OWNED_FILES)(
    'ルート所有の%sを検査対象にする',
    async (path) => {
      expect(await eslint.isPathIgnored(path)).toBe(false);
    },
  );

  test.each(NOT_ROOT_OWNED_FILES)(
    'ルート所有ではない%sを検査対象外にする',
    async (path) => {
      expect(await eslint.isPathIgnored(path)).toBe(true);
    },
  );

  test('ルート所有のファイルを基底設定の規則とルートのtsconfigによる型情報で検査する', async () => {
    const config = (await eslint.calculateConfigForFile(
      join(ROOT, 'scripts/tooling/staged-tasks.ts'),
    )) as Linter.Config;

    expect(severityOf(config.rules?.['no-restricted-globals'])).toBe(2);
    expect(
      severityOf(config.rules?.['@typescript-eslint/no-floating-promises']),
    ).toBe(2);
    expect(config.languageOptions?.parserOptions).toMatchObject({
      projectService: true,
      tsconfigRootDir: ROOT,
    });
  });
});

const VIOLATION_TS = 'export const value = isNaN(1);\n';
const VIOLATION_JS = 'var value = isNaN(1);\nconsole.log(value);\n';
const THROWING_CONFIG =
  "throw new Error('ルートの静的解析がこの設定を読み込んだ');\n";

const FILES_COPIED_FROM_ROOT = [
  'eslint.config.ts',
  'eslint.config.base.ts',
  'config/workspace-layout.ts',
  'tsconfig.json',
  'tsconfig.base.json',
];

const ROOT_OWNED_SOURCES_COPIED = FILES_COPIED_FROM_ROOT.filter((path) =>
  path.endsWith('.ts'),
);

const ROOT_OWNED_VIOLATION = 'scripts/tooling/violation.ts';

const NOT_ROOT_OWNED_FIXTURES = {
  'apps/api/eslint.config.ts': THROWING_CONFIG,
  'apps/api/src/violation.ts': VIOLATION_TS,
  'apps/event/src/violation.ts': VIOLATION_TS,
  'mockups/eslint.config.ts': THROWING_CONFIG,
  'mockups/src/violation.ts': VIOLATION_TS,
  '.claude/hooks/violation.js': VIOLATION_JS,
  'docs/ai-extensions/violation.js': VIOLATION_JS,
  '.kiro/settings/violation.js': VIOLATION_JS,
  'test-results/violation.js': VIOLATION_JS,
  'playwright-report/trace/violation.js': VIOLATION_JS,
} as const;

let fixtureRoot = '';

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'eslint-root-test-'));
});

afterAll(async () => {
  if (fixtureRoot !== '') {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

const writeFixtureFile = async (
  dir: string,
  path: string,
  content: string,
): Promise<void> => {
  await mkdir(dirname(join(dir, path)), { recursive: true });
  await writeFile(join(dir, path), content);
};

const copyFromRoot = async (dir: string, path: string): Promise<void> => {
  await mkdir(dirname(join(dir, path)), { recursive: true });
  await copyFile(join(ROOT, path), join(dir, path));
};

const rootLintScript = async (): Promise<string> => {
  const { scripts } = JSON.parse(
    await readFile(join(ROOT, 'package.json'), 'utf8'),
  ) as { readonly scripts: Readonly<Record<string, string>> };
  return scripts['lint'] ?? '';
};

const createLintFixtureDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(fixtureRoot, 'fixture-'));
  const packageJson = {
    private: true,
    type: 'module',
    scripts: { lint: await rootLintScript() },
  };
  await Promise.all([
    ...FILES_COPIED_FROM_ROOT.map((path) => copyFromRoot(dir, path)),
    writeFixtureFile(
      dir,
      'package.json',
      `${JSON.stringify(packageJson, null, 2)}\n`,
    ),
    writeFixtureFile(dir, ROOT_OWNED_VIOLATION, VIOLATION_TS),
    ...Object.entries(NOT_ROOT_OWNED_FIXTURES).map(([path, content]) =>
      writeFixtureFile(dir, path, content),
    ),
    symlink(join(ROOT, 'node_modules'), join(dir, 'node_modules')),
  ]);
  return dir;
};

interface LintScriptResult {
  readonly exitCode: number;
  readonly results: readonly ESLint.LintResult[];
}

const runLintScript = async (cwd: string): Promise<LintScriptResult> => {
  const child = Bun.spawn(
    [process.execPath, 'run', 'lint', '--format', 'json'],
    { cwd, stdout: 'pipe', stderr: 'pipe' },
  );
  const [exitCode, stdout] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
  ]);
  return {
    exitCode,
    results: exitCode === 2 ? [] : (JSON.parse(stdout) as ESLint.LintResult[]),
  };
};

describe('ルートの静的解析のスクリプト', () => {
  test('アプリと同じくカレントディレクトリ全体を対象にする', async () => {
    expect(await rootLintScript()).toBe('bun --bun eslint .');
  });

  test(
    'ルート所有のファイルの違反を報告し、アプリ・mockups・外部由来・E2Eの出力は設定も含めて読み込まない',
    async () => {
      const dir = await createLintFixtureDir();

      const { exitCode, results } = await runLintScript(dir);
      const reportedFiles = results
        .filter(({ messages }) => messages.length > 0)
        .map(({ filePath }) => relative(dir, filePath));
      const lintedFiles = results.map(({ filePath }) =>
        relative(dir, filePath),
      );

      expect(exitCode).toBe(1);
      expect(reportedFiles).toEqual([ROOT_OWNED_VIOLATION]);
      expect(lintedFiles.toSorted()).toEqual(
        [...ROOT_OWNED_SOURCES_COPIED, ROOT_OWNED_VIOLATION].toSorted(),
      );
    },
    SPAWN_TIMEOUT_MS,
  );
});
