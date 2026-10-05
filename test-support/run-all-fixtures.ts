import { afterAll, beforeAll } from 'bun:test';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { APPS } from '../config/workspace-layout.ts';
import {
  type AggregateDependencies,
  runAggregateEntry,
  type RunTarget,
  type StepOutcome,
  type StepResult,
} from '../scripts/tooling/run-all.ts';
import { writeFixtureFiles } from './shared-dirs-fixtures.ts';

export const REPO_ROOT = join(import.meta.dirname, '..');
export const SPAWN_TIMEOUT_MS = 30_000;

const FAKE_ROOT = '/repo';
export const ROOT_DIR = '.';
export const ALL_DIRS = [ROOT_DIR, ...APPS.map(({ dir }) => dir)];
const APP_TARGETS: readonly RunTarget[] = APPS.map(({ name }) => name);

export const PASSED: StepOutcome = { status: 'passed' };
export const PROJECT_MISSING: StepOutcome = {
  status: 'skipped',
  reason: 'project-missing',
};
export const SCRIPT_MISSING: StepOutcome = {
  status: 'skipped',
  reason: 'script-missing',
};
export const failedWith = (exitCode: number): StepOutcome => ({
  status: 'failed',
  exitCode,
});

export const ROOT_CHECK_SCRIPTS = [
  'shared-dirs:verify',
  'check:test-names',
  'format:check',
  'lint',
  'typecheck',
];

export type ScriptsByDir = Readonly<
  Record<string, Readonly<Record<string, string>> | Error | undefined>
>;

interface RunCall {
  readonly command: readonly string[];
  readonly cwd: string;
}

export const scriptsOf = (...names: readonly string[]) =>
  Object.fromEntries(names.map((name) => [name, `echo ${name}`]));

const dirKeyOf = (absoluteDir: string): string =>
  relative(FAKE_ROOT, absoluteDir) || ROOT_DIR;

// 偽のワークスペースでは、スクリプトの一覧(読めないpackage.jsonは投げる例外)をディレクトリで、終了コード(起動できないコマンドは投げる例外)を「ディレクトリ スクリプト名」で指定する
export const createFakeWorkspace = (
  scriptsByDir: ScriptsByDir,
  exitCodes: Readonly<Record<string, number | Error>> = {},
) => {
  const calls: RunCall[] = [];
  const deps: AggregateDependencies = {
    repoRoot: FAKE_ROOT,
    readPackageScripts: (dir) => {
      const scripts = scriptsByDir[dirKeyOf(dir)];
      if (scripts instanceof Error) throw scripts;
      return scripts;
    },
    runner: {
      run: (command, cwd) => {
        calls.push({ command, cwd });
        const exitCode = exitCodes[`${dirKeyOf(cwd)} ${command[2] ?? ''}`] ?? 0;
        // Bun.spawnは実行ファイルが見つからないと同期的に例外を投げるため、偽の実行もそれに合わせる
        if (exitCode instanceof Error) throw exitCode;
        return Promise.resolve(exitCode);
      },
    },
  };
  return { deps, calls };
};

export const callOf = (
  dir: string,
  ...command: readonly string[]
): RunCall => ({
  command,
  cwd: join(FAKE_ROOT, dir),
});

export const resultsOf = (
  step: string,
  outcomes: Readonly<Partial<Record<RunTarget, StepOutcome>>>,
  fallback: StepOutcome,
): readonly StepResult[] =>
  (['root', ...APP_TARGETS] as const).map((target) => ({
    step,
    target,
    outcome: outcomes[target] ?? fallback,
  }));

export const everyDirWith = (...names: readonly string[]): ScriptsByDir =>
  Object.fromEntries(ALL_DIRS.map((dir) => [dir, scriptsOf(...names)]));

export const createOutput = () => {
  const written: string[] = [];
  return {
    write: (text: string) => {
      written.push(text);
    },
    text: () => written.join(''),
  };
};

export const runEntryInProcess = async (
  args: readonly string[],
  deps: AggregateDependencies,
) => {
  const stdout = createOutput();
  const stderr = createOutput();
  const exitCode = await runAggregateEntry({ ...deps, args, stdout, stderr });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
};

export const packageJsonOf = (scripts: Readonly<Record<string, string>>) =>
  `${JSON.stringify({ scripts })}\n`;

export interface RunAllFixtures {
  readonly createDir: (prefix: string) => Promise<string>;
  readonly createRepositoryWithScript: (
    files: Readonly<Record<string, string>>,
  ) => Promise<string>;
}

// 一時ディレクトリをテストファイルごとに作って最後に消し、リポジトリ内に残骸を作らない
export const useRunAllFixtures = (): RunAllFixtures => {
  let fixtureRoot = '';

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'run-all-'));
  });

  afterAll(async () => {
    if (fixtureRoot !== '') {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  const createDir = (prefix: string) => mkdtemp(join(fixtureRoot, prefix));

  return {
    createDir,
    createRepositoryWithScript: async (files) => {
      const repoRoot = await createDir('repo-');
      await writeFixtureFiles(repoRoot, files);
      for (const path of [
        'scripts/tooling/run-all.ts',
        'config/workspace-layout.ts',
      ]) {
        await mkdir(dirname(join(repoRoot, path)), { recursive: true });
        await copyFile(join(REPO_ROOT, path), join(repoRoot, path));
      }
      return repoRoot;
    },
  };
};

export const runEntry = (repoRoot: string, args: readonly string[]) => {
  const { exitCode, stdout, stderr } = Bun.spawnSync(
    [process.execPath, join(repoRoot, 'scripts/tooling/run-all.ts'), ...args],
    {
      // カレントディレクトリに依らずスクリプトのあるリポジトリを対象にすることを確かめるため、サブディレクトリから実行する
      cwd: join(repoRoot, 'apps'),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
};
