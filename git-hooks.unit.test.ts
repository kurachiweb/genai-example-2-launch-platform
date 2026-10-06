import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { ALLOWED_COMMIT_TYPES } from './commitlint.config.ts';
import { describeHookInstallResult } from './scripts/tooling/install-git-hooks.ts';

const ROOT = import.meta.dirname;
const PRE_COMMIT_HOOK = join(ROOT, '.husky/pre-commit');
const COMMIT_MSG_HOOK = join(ROOT, '.husky/commit-msg');
const SECRET_SCAN_ALLOWLIST = join(ROOT, '.betterleaksignore');
const SPAWN_TIMEOUT_MS = 30_000;

// Betterleaksは開発コンテナでは/usr/local/binに導入されるため、システムの基本的なコマンドだけを含むPATHでは見つからない
const SYSTEM_PATH = ['/usr/bin', '/bin'];
const BUN_DIR = dirname(process.execPath);
// GitフックはコミットしたシェルのPATHを引き継ぐ。Bun 1.4.2の`bunx --bun`はnodeを指定するshebangをBunへ置き換えないため、開発コンテナのPATHにあるnodeの代替(Bun)が必要になる
const INHERITED_PATH = (process.env.PATH ?? '').split(delimiter);
const SECRET_SCAN_COMMAND =
  'betterleaks git --pre-commit --staged --redact --no-banner --verbose';
const LINT_STAGED_COMMAND = 'bunx --bun lint-staged';

let workDir = '';

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'git-hooks-test-'));
});

afterAll(async () => {
  if (workDir !== '') {
    await rm(workDir, { recursive: true, force: true });
  }
});

interface CommandResult {
  readonly exitCode: number;
  readonly output: string;
}

const collect = async (
  child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>,
): Promise<CommandResult> => {
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, output: `${stdout}\n${stderr}` };
};

// huskyと同じく、node_modules/.binをPATHの先頭に加えてsh -eでフックを実行する
const runHook = (
  hookPath: string,
  args: readonly string[],
  cwd: string,
  pathEntries: readonly string[],
): Promise<CommandResult> =>
  collect(
    Bun.spawn(['/bin/sh', '-e', hookPath, ...args], {
      cwd,
      env: { PATH: ['node_modules/.bin', ...pathEntries].join(delimiter) },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    }),
  );

interface FakeTools {
  readonly binDir: string;
  readonly calls: () => Promise<readonly string[]>;
}

// 呼び出された引数を記録し、指定した終了コードで終わる偽のコマンドを用意する
const createFakeTools = async (
  exitCodes: Readonly<Record<string, number>>,
): Promise<FakeTools> => {
  const dir = await mkdtemp(join(workDir, 'fake-tools-'));
  const binDir = join(dir, 'bin');
  const callLog = join(dir, 'calls.log');
  await mkdir(binDir);
  await writeFile(callLog, '');
  for (const [name, exitCode] of Object.entries(exitCodes)) {
    await writeFile(
      join(binDir, name),
      `#!/bin/sh\necho "${name} $*" >> "${callLog}"\nexit ${String(exitCode)}\n`,
      { mode: 0o755 },
    );
  }
  return {
    binDir,
    calls: async () =>
      (await readFile(callLog, 'utf8'))
        .split('\n')
        .filter((line) => line !== ''),
  };
};

describe('.husky/pre-commit', () => {
  test(
    'Betterleaksが見つからない時、開発コンテナ内でのコミットを案内して中止し、以降の検査を実行しない',
    async () => {
      const fakes = await createFakeTools({ bunx: 0 });
      const pathEntries = [fakes.binDir, ...SYSTEM_PATH];

      expect(
        Bun.which('betterleaks', { PATH: pathEntries.join(delimiter) }),
      ).toBeNull();

      const { exitCode, output } = await runHook(
        PRE_COMMIT_HOOK,
        [],
        workDir,
        pathEntries,
      );

      expect(exitCode).not.toBe(0);
      expect(output).toContain('Betterleaks');
      expect(output).toContain('開発コンテナ内でコミット');
      expect(await fakes.calls()).toEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    'シークレットを検出した時、許可リストへの登録方法を案内して中止し、lint-stagedを実行しない',
    async () => {
      const fakes = await createFakeTools({ betterleaks: 1, bunx: 0 });

      const { exitCode, output } = await runHook(PRE_COMMIT_HOOK, [], workDir, [
        fakes.binDir,
        ...SYSTEM_PATH,
      ]);

      expect(exitCode).not.toBe(0);
      expect(output).toContain('.betterleaksignore');
      expect(output).toContain('Fingerprint');
      expect(await fakes.calls()).toEqual([SECRET_SCAN_COMMAND]);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    'シークレットが無い時、パスを限定せずステージ済みの差分全体を伏せ字付きで検査してから、lint-stagedを実行する',
    async () => {
      const fakes = await createFakeTools({ betterleaks: 0, bunx: 0 });

      const { exitCode } = await runHook(PRE_COMMIT_HOOK, [], workDir, [
        fakes.binDir,
        ...SYSTEM_PATH,
      ]);

      expect(exitCode).toBe(0);
      expect(await fakes.calls()).toEqual([
        SECRET_SCAN_COMMAND,
        LINT_STAGED_COMMAND,
      ]);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    'lint-stagedが失敗した時、コミット前検査も失敗する',
    async () => {
      const fakes = await createFakeTools({ betterleaks: 0, bunx: 1 });

      const { exitCode } = await runHook(PRE_COMMIT_HOOK, [], workDir, [
        fakes.binDir,
        ...SYSTEM_PATH,
      ]);

      expect(exitCode).not.toBe(0);
      expect(await fakes.calls()).toEqual([
        SECRET_SCAN_COMMAND,
        LINT_STAGED_COMMAND,
      ]);
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe('.husky/commit-msg', () => {
  const runCommitMsgHook = async (message: string): Promise<CommandResult> => {
    const messageFile = join(
      await mkdtemp(join(workDir, 'commit-msg-')),
      'COMMIT_EDITMSG',
    );
    await writeFile(messageFile, message);
    return runHook(COMMIT_MSG_HOOK, [messageFile], ROOT, INHERITED_PATH);
  };

  test(
    '型が一覧に無いメッセージを、許可された型の一覧を表示して拒否する',
    async () => {
      const { exitCode, output } =
        await runCommitMsgHook('update: フックの確認\n');

      expect(exitCode).not.toBe(0);
      expect(output).toContain('[type-enum]');
      expect(output).toContain(ALLOWED_COMMIT_TYPES.join(', '));
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    '型が一覧にあるメッセージを受け入れる',
    async () => {
      const { exitCode } = await runCommitMsgHook('feat: フックの確認\n');

      expect(exitCode).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe('Gitフックの有効化', () => {
  test(
    'ルートの依存インストール時に実行されるprepareスクリプトが、Gitフックのインストーラを実行する',
    async () => {
      const { exitCode, output } = await collect(
        Bun.spawn([process.execPath, 'run', 'prepare'], {
          cwd: ROOT,
          env: { PATH: [BUN_DIR, ...SYSTEM_PATH].join(delimiter), CI: 'true' },
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        }),
      );

      expect(exitCode).toBe(0);
      expect(output).toContain(
        describeHookInstallResult({ status: 'skipped', reason: 'ci' }),
      );
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe('.betterleaksignore', () => {
  test('コメント以外の行は、行末コメントを持たない<ファイルのパス>:<検出規則>:<行番号>形式のFingerprintだけである', async () => {
    const lines = (await readFile(SECRET_SCAN_ALLOWLIST, 'utf8')).split('\n');
    const fingerprints = lines.filter(
      (line) => line.trim() !== '' && !line.startsWith('#'),
    );

    expect(lines.some((line) => line.startsWith('#'))).toBe(true);
    for (const fingerprint of fingerprints) {
      expect(fingerprint).toMatch(/^[^\s#][^#]*:[\w-]+:\d+$/);
    }
  });
});
