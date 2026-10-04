import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { format } from 'node:util';

import lintStaged from 'lint-staged';

import config, { createStagedFilesTask } from './lint-staged.config.ts';
import {
  describePlanError,
  planStagedTasks,
  type StagedTaskPlan,
  toCommands,
  type WorkspaceChecks,
} from './scripts/tooling/staged-tasks.ts';

const ROOT = import.meta.dirname;
const LINT_STAGED_TIMEOUT_MS = 30_000;
// 案内文にはリポジトリのパスが入るため、コマンドの分割を壊しやすい文字をパスに含めて確かめる
const UNUSUAL_REPO_DIR_PREFIX = `lint-staged-config-'"\` 日本語 `;

const ALL_READY: WorkspaceChecks = {
  isInstalled: () => true,
  appExists: () => true,
};

const NOTHING_READY: WorkspaceChecks = {
  isInstalled: () => false,
  appExists: () => false,
};

const absolutePathsOf = (
  repoRoot: string,
  relativePaths: readonly string[],
): readonly string[] => relativePaths.map((path) => join(repoRoot, path));

const planOf = (
  stagedAbsolutePaths: readonly string[],
  repoRoot: string,
  checks: WorkspaceChecks,
): StagedTaskPlan => {
  const result = planStagedTasks(
    stagedAbsolutePaths,
    repoRoot,
    checks.isInstalled,
    checks.appExists,
  );
  if (!result.ok) {
    throw new Error(`計画がエラーになった: ${JSON.stringify(result.errors)}`);
  }
  return result.plan;
};

const planErrorMessagesOf = (
  stagedAbsolutePaths: readonly string[],
  repoRoot: string,
  checks: WorkspaceChecks,
): readonly string[] => {
  const result = planStagedTasks(
    stagedAbsolutePaths,
    repoRoot,
    checks.isInstalled,
    checks.appExists,
  );
  if (result.ok) {
    throw new Error('計画がエラーにならなかった');
  }
  return result.errors.map((error) => describePlanError(error, repoRoot));
};

const createdRepoDirs: string[] = [];

afterAll(async () => {
  await Promise.all(
    createdRepoDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

// ユーザーのGit設定に左右されないよう、HOMEを一時リポジトリに向けて実行する
const runGit = (repoDir: string, args: readonly string[]): void => {
  const result = Bun.spawnSync(['git', ...args], {
    cwd: repoDir,
    env: { PATH: process.env.PATH, HOME: repoDir },
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(' ')}が失敗した: ${result.stderr.toString()}`,
    );
  }
};

const createRepoWithStagedFiles = async (
  relativePaths: readonly string[],
): Promise<string> => {
  const repoDir = await mkdtemp(join(tmpdir(), UNUSUAL_REPO_DIR_PREFIX));
  createdRepoDirs.push(repoDir);
  runGit(repoDir, ['init', '--quiet']);
  for (const path of absolutePathsOf(repoDir, relativePaths)) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'export {};\n');
  }
  runGit(repoDir, ['add', '--', ...relativePaths]);
  return repoDir;
};

interface LintStagedRun {
  readonly passed: boolean;
  readonly output: string;
}

const runLintStaged = async (
  repoDir: string,
  checks: WorkspaceChecks,
): Promise<LintStagedRun> => {
  const lines: string[] = [];
  const record = (...args: unknown[]): void => {
    lines.push(format(...args));
  };
  const passed = await lintStaged(
    {
      config: { '*': createStagedFilesTask(repoDir, checks) },
      cwd: repoDir,
      quiet: true,
      color: false,
    },
    { log: record, warn: record, error: record, debug: record },
  );
  return { passed, output: lines.join('\n') };
};

describe('createStagedFilesTask', () => {
  test('計画が成功する時は、計画処理が生成したコマンドを順序を変えずにそのまま返す', () => {
    const repoRoot = '/repo';
    const staged = absolutePathsOf(repoRoot, [
      'scripts/tooling/example.ts',
      'apps/backend-lib/utilities/date.ts',
      'README.md',
    ]);

    const commands = createStagedFilesTask(repoRoot, ALL_READY)(staged);

    expect(commands).toHaveLength(3);
    expect(commands).toEqual([
      ...toCommands(planOf(staged, repoRoot, ALL_READY), repoRoot),
    ]);
  });

  test('ステージ済みのファイルが計画の対象外だけなら、コマンドを返さない', () => {
    const repoRoot = '/repo';
    const staged = absolutePathsOf(repoRoot, [
      'mockups/src/routes/client/index.tsx',
      'bun.lock',
    ]);

    expect(createStagedFilesTask(repoRoot, ALL_READY)(staged)).toEqual([]);
  });

  test('計画がエラーなら、計画処理のコマンドの代わりに失敗するコマンドを1つだけ返す', () => {
    const repoRoot = '/repo';
    const staged = absolutePathsOf(repoRoot, [
      'scripts/tooling/example.ts',
      'apps/backend-lib/utilities/date.ts',
    ]);

    const commands = createStagedFilesTask(repoRoot, NOTHING_READY)(staged);

    expect(commands).toHaveLength(1);
    expect(commands[0]).not.toContain('eslint');
    expect(commands[0]).not.toContain('prettier');
  });
});

describe('lint-stagedでの実行', () => {
  test(
    '計画がエラーなら、引用符・バッククォート・日本語を含む案内文を1行として崩さずに表示し、コミット前検査を失敗させる',
    async () => {
      const relativePaths = ['scripts/tooling/example.ts'];
      const repoDir = await createRepoWithStagedFiles(relativePaths);
      const expectedMessages = planErrorMessagesOf(
        absolutePathsOf(repoDir, relativePaths),
        repoDir,
        NOTHING_READY,
      );

      const { passed, output } = await runLintStaged(repoDir, NOTHING_READY);

      expect(passed).toBe(false);
      expect(expectedMessages).toHaveLength(1);
      expect(expectedMessages[0]).toContain(`'"\` 日本語`);
      expect(expectedMessages[0]).toContain('bun install');
      const outputLines = output.split('\n');
      for (const message of expectedMessages) {
        expect(outputLines).toContain(message);
      }
    },
    LINT_STAGED_TIMEOUT_MS,
  );

  test(
    '計画のエラーが複数あれば、すべての案内文を1行ずつ表示する',
    async () => {
      const relativePaths = [
        'apps/backend-lib/utilities/date.ts',
        'scripts/tooling/example.ts',
      ];
      const repoDir = await createRepoWithStagedFiles(relativePaths);
      const expectedMessages = planErrorMessagesOf(
        absolutePathsOf(repoDir, relativePaths),
        repoDir,
        NOTHING_READY,
      );

      const { passed, output } = await runLintStaged(repoDir, NOTHING_READY);

      expect(passed).toBe(false);
      expect(expectedMessages).toHaveLength(2);
      const outputLines = output.split('\n');
      for (const message of expectedMessages) {
        expect(outputLines).toContain(message);
      }
    },
    LINT_STAGED_TIMEOUT_MS,
  );
});

describe('lint-staged.config.ts', () => {
  test('すべてのステージ済みファイルを、本リポジトリのルートと実際の品質ツールの導入状況で計画する', () => {
    const task = config['*'];
    const staged = absolutePathsOf(ROOT, [
      'lint-staged.config.ts',
      'README.md',
    ]);

    expect(task(staged)).toEqual([
      ...toCommands(planOf(staged, ROOT, ALL_READY), ROOT),
    ]);
  });
});
