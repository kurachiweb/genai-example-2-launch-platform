import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  describeHookInstallResult,
  type HookInstallResult,
  installGitHooks,
  runHookInstallerEntry,
} from './install-git-hooks.ts';

type Env = Readonly<Record<string, string | undefined>>;

const SCRIPT_PATH = join(import.meta.dirname, 'install-git-hooks.ts');

const CI_SKIPPED_MESSAGE = 'CI環境のため、Gitフックの導入を飛ばしました。';
const NOT_A_GIT_REPOSITORY_SKIPPED_MESSAGE =
  'Gitの作業ツリーが無いため、Gitフックの導入を飛ばしました。';
const INSTALLED_MESSAGE = 'Gitフックを導入しました。';

const runInstaller = (env: Env, gitDirExists: boolean) => {
  const runHusky = mock(() => undefined);
  const result = installGitHooks({
    env,
    gitDirExists: () => gitDirExists,
    runHusky,
  });
  return { result, runHusky };
};

describe('installGitHooks', () => {
  test.each(['true', '1'])(
    'CIが%sならciを理由に飛ばし、フックを導入しない',
    (ci) => {
      const { result, runHusky } = runInstaller({ CI: ci }, true);

      expect(result).toEqual({ status: 'skipped', reason: 'ci' });
      expect(runHusky).not.toHaveBeenCalled();
    },
  );

  test('CIが空でなければ.gitが無くてもciを理由に飛ばす', () => {
    const { result, runHusky } = runInstaller({ CI: 'true' }, false);

    expect(result).toEqual({ status: 'skipped', reason: 'ci' });
    expect(runHusky).not.toHaveBeenCalled();
  });

  test.each<[string, Env]>([
    ['未設定', {}],
    ['空文字列', { CI: '' }],
  ])(
    'CIが%sで.gitが無ければnot-a-git-repositoryを理由に飛ばし、フックを導入しない',
    (_label, env) => {
      const { result, runHusky } = runInstaller(env, false);

      expect(result).toEqual({
        status: 'skipped',
        reason: 'not-a-git-repository',
      });
      expect(runHusky).not.toHaveBeenCalled();
    },
  );

  test.each<[string, Env]>([
    ['未設定', {}],
    ['空文字列', { CI: '' }],
  ])(
    'CIが%sで.gitがあればフックを1回導入してinstalledを返す',
    (_label, env) => {
      const { result, runHusky } = runInstaller(env, true);

      expect(result).toEqual({ status: 'installed' });
      expect(runHusky).toHaveBeenCalledTimes(1);
    },
  );

  test('フックの導入に失敗すれば、その例外をそのまま伝える', () => {
    const failure = new Error('導入失敗');

    expect(() =>
      installGitHooks({
        env: {},
        gitDirExists: () => true,
        runHusky: () => {
          throw failure;
        },
      }),
    ).toThrow(failure);
  });
});

describe('describeHookInstallResult', () => {
  test.each<[HookInstallResult, string]>([
    [{ status: 'installed' }, INSTALLED_MESSAGE],
    [{ status: 'skipped', reason: 'ci' }, CI_SKIPPED_MESSAGE],
    [
      { status: 'skipped', reason: 'not-a-git-repository' },
      NOT_A_GIT_REPOSITORY_SKIPPED_MESSAGE,
    ],
  ])('%oを「%s」と表示する', (result, message) => {
    expect(describeHookInstallResult(result)).toBe(message);
  });
});

let fixtureRoot = '';
let emptyBinDir = '';

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'install-git-hooks-test-'));
  emptyBinDir = join(fixtureRoot, 'empty-bin');
  await mkdir(emptyBinDir);
});

afterAll(async () => {
  if (fixtureRoot !== '') {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

const createWorkingDir = async (withGitDir: boolean): Promise<string> => {
  const dir = await mkdtemp(join(fixtureRoot, 'cwd-'));
  if (withGitDir) {
    await mkdir(join(dir, '.git'));
  }
  return dir;
};

const createOutput = () => {
  const written: string[] = [];
  return {
    write: (text: string) => {
      written.push(text);
    },
    text: () => written.join(''),
  };
};

const runEntryInProcess = (
  env: Env,
  cwd: string,
  husky: () => string = () => '',
) => {
  const huskyMock = mock(husky);
  const stdout = createOutput();
  const stderr = createOutput();
  const exitCode = runHookInstallerEntry({
    env,
    cwd,
    husky: huskyMock,
    stdout,
    stderr,
  });
  return {
    exitCode,
    husky: huskyMock,
    stdout: stdout.text(),
    stderr: stderr.text(),
  };
};

describe('runHookInstallerEntry', () => {
  test('CIが空でなければ飛ばした理由を表示し、huskyを呼ばずに0を返す', async () => {
    const cwd = await createWorkingDir(true);

    const { exitCode, husky, stdout, stderr } = runEntryInProcess(
      { CI: 'true' },
      cwd,
    );

    expect(stdout).toBe(`${CI_SKIPPED_MESSAGE}\n`);
    expect(stderr).toBe('');
    expect(husky).not.toHaveBeenCalled();
    expect(exitCode).toBe(0);
  });

  test('cwdに.gitが無ければ飛ばした理由を表示し、huskyを呼ばずに0を返す', async () => {
    const cwd = await createWorkingDir(false);

    const { exitCode, husky, stdout } = runEntryInProcess({}, cwd);

    expect(stdout).toBe(`${NOT_A_GIT_REPOSITORY_SKIPPED_MESSAGE}\n`);
    expect(husky).not.toHaveBeenCalled();
    expect(exitCode).toBe(0);
  });

  test('cwdに.gitがあり、huskyが空文字列を返せば導入した旨を表示して0を返す', async () => {
    const cwd = await createWorkingDir(true);

    const { exitCode, husky, stdout, stderr } = runEntryInProcess({}, cwd);

    expect(stdout).toBe(`${INSTALLED_MESSAGE}\n`);
    expect(stderr).toBe('');
    expect(husky).toHaveBeenCalledTimes(1);
    expect(exitCode).toBe(0);
  });

  test.each(['git command not found', 'fatal: not in a git directory'])(
    'huskyが「%s」を返せば失敗として理由を表示し、1を返す',
    async (reason) => {
      const cwd = await createWorkingDir(true);

      const { exitCode, stdout, stderr } = runEntryInProcess(
        {},
        cwd,
        () => reason,
      );

      expect(stdout).toBe('');
      expect(stderr).toBe(`Gitフックの導入に失敗しました: ${reason}\n`);
      expect(exitCode).toBe(1);
    },
  );
});

describe('直接実行したときの入口', () => {
  // gitを見つけられないPATHで起動し、誤ってhuskyが呼ばれても実在のGit設定を変更しないようにする
  const runEntry = (cwd: string, ci?: string) =>
    Bun.spawnSync([process.execPath, SCRIPT_PATH], {
      cwd,
      env: { PATH: emptyBinDir, ...(ci === undefined ? {} : { CI: ci }) },
      stdout: 'pipe',
      stderr: 'pipe',
    });

  test('CIが空でなければ飛ばした理由を表示して終了コード0で終える', async () => {
    const cwd = await createWorkingDir(true);

    const { exitCode, stdout } = runEntry(cwd, 'true');

    expect(stdout.toString()).toBe(`${CI_SKIPPED_MESSAGE}\n`);
    expect(exitCode).toBe(0);
  });

  test('カレントディレクトリに.gitが無ければ飛ばした理由を表示して終了コード0で終える', async () => {
    const cwd = await createWorkingDir(false);

    const { exitCode, stdout } = runEntry(cwd);

    expect(stdout.toString()).toBe(`${NOT_A_GIT_REPOSITORY_SKIPPED_MESSAGE}\n`);
    expect(exitCode).toBe(0);
  });

  test('huskyが失敗すれば理由を表示して終了コード1で終える', async () => {
    const cwd = await createWorkingDir(true);

    const { exitCode, stdout, stderr } = runEntry(cwd);

    expect(stdout.toString()).toBe('');
    expect(stderr.toString()).toBe(
      'Gitフックの導入に失敗しました: git command not found\n',
    );
    expect(exitCode).toBe(1);
  });
});
