import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { rejectionMessageOf } from '../test-fixtures/rejection.ts';
import { createRecordingOutput } from '../test-fixtures/text-output.ts';
import {
  type CommandRunnerOptions,
  createCommandRunner,
} from './command-runner.ts';

const SPAWN_TIMEOUT_MS = 30_000;
const BUN = process.execPath;
const RUNNER_MODULE = join(import.meta.dirname, 'command-runner.ts');

const tempDirs: string[] = [];
const createTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'delivery-command-runner-'));
  tempDirs.push(dir);
  return dir;
};

afterAll(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const createRunner = (overrides: Partial<CommandRunnerOptions> = {}) => {
  const stdout = createRecordingOutput();
  const stderr = createRecordingOutput();
  const runner = createCommandRunner({
    baseEnv: { PATH: process.env.PATH, DELIVERY_BASE: 'base' },
    stdout,
    stderr,
    ...overrides,
  });
  return { runner, stdout, stderr };
};

const script = (source: string) => ['-e', source] as const;

describe('createCommandRunner().run', () => {
  test('captureでは標準出力と標準エラー出力を表示せずに取り込み、終了コードと共に返す', async () => {
    const { runner, stdout, stderr } = createRunner();

    const result = await runner.run({
      command: BUN,
      args: script(
        'process.stdout.write("out-1\\nout-2\\n");process.stderr.write("err-1\\n");process.exit(3)',
      ),
      output: 'capture',
    });

    expect(result).toEqual({
      code: 3,
      stdout: 'out-1\nout-2\n',
      stderr: 'err-1\n',
    });
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toBe('');
  });

  test('標準入力に渡した文字列を子プロセスが読める', async () => {
    const { runner } = createRunner();

    const result = await runner.run({
      command: BUN,
      args: script('process.stdout.write(await Bun.stdin.text())'),
      stdin: 'secret-line-1\nsecret-line-2',
      output: 'capture',
    });

    expect(result.stdout).toBe('secret-line-1\nsecret-line-2');
  });

  test('環境変数は基底の環境に指定の値を重ね、作業ディレクトリを指定できる', async () => {
    const { runner } = createRunner();
    const cwd = await createTempDir();

    const result = await runner.run({
      command: BUN,
      args: script(
        'process.stdout.write(JSON.stringify([process.env.DELIVERY_BASE, process.env.DELIVERY_EXTRA, process.cwd()]))',
      ),
      cwd,
      env: { DELIVERY_EXTRA: 'extra' },
      output: 'capture',
    });

    expect(JSON.parse(result.stdout)).toEqual(['base', 'extra', cwd]);
  });

  test('基底の環境で未定義の値は子プロセスへ渡さない', async () => {
    const { runner } = createRunner({
      baseEnv: { PATH: process.env.PATH, DELIVERY_UNDEFINED: undefined },
    });

    const result = await runner.run({
      command: BUN,
      args: script(
        'process.stdout.write(String(Object.hasOwn(process.env, "DELIVERY_UNDEFINED")))',
      ),
      output: 'capture',
    });

    expect(result.stdout).toBe('false');
  });

  test('filteredでは各行にフィルタを掛け、残した行だけを出力元ごとに表示し、取り込んだ出力は加工せずに返す', async () => {
    const { runner, stdout, stderr } = createRunner();

    const result = await runner.run({
      command: BUN,
      args: script(
        'process.stdout.write("keep: a\\nsecret: x\\n");process.stdout.write("keep: b");process.stderr.write("keep: e\\r\\nsecret: y\\n")',
      ),
      output: 'filtered',
      filter: (line) =>
        line.startsWith('keep: ') ? line.replace('keep: ', '') : undefined,
    });

    expect(stdout.text()).toBe('a\nb\n');
    expect(stderr.text()).toBe('e\n');
    expect(result).toEqual({
      code: 0,
      stdout: 'keep: a\nsecret: x\nkeep: b',
      stderr: 'keep: e\r\nsecret: y\n',
    });
  });

  test('filteredでフィルタが無ければ何も表示しない', async () => {
    const { runner, stdout } = createRunner();

    await runner.run({
      command: BUN,
      args: script('process.stdout.write("line\\n")'),
      output: 'filtered',
    });

    expect(stdout.text()).toBe('');
  });

  test('行の途中で分かれて届いた出力も1行としてフィルタに渡す', async () => {
    const { runner, stdout } = createRunner();
    const seen: string[] = [];

    await runner.run({
      command: BUN,
      args: script(
        'process.stdout.write("par");await Bun.sleep(50);process.stdout.write("tial\\nnext\\n")',
      ),
      output: 'filtered',
      filter: (line) => {
        seen.push(line);
        return line;
      },
    });

    expect(seen).toEqual(['partial', 'next']);
    expect(stdout.text()).toBe('partial\nnext\n');
  });

  test(
    'inheritでは子プロセスの出力をそのまま親の端末へ流し、取り込んだ出力は空で返す',
    () => {
      const source = [
        `const { createCommandRunner } = await import(${JSON.stringify(RUNNER_MODULE)});`,
        'const runner = createCommandRunner({ baseEnv: process.env, stdout: process.stdout, stderr: process.stderr });',
        `const result = await runner.run({ command: process.execPath, args: ['-e', 'process.stdout.write("child-out");process.stderr.write("child-err")'], output: 'inherit' });`,
        'process.stdout.write(JSON.stringify(result));',
      ].join('\n');

      const { stdout, stderr, exitCode } = Bun.spawnSync([BUN, '-e', source], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      expect(exitCode).toBe(0);
      expect(stdout.toString()).toBe(
        'child-out{"code":0,"stdout":"","stderr":""}',
      );
      expect(stderr.toString()).toBe('child-err');
    },
    SPAWN_TIMEOUT_MS,
  );

  test('inheritでも標準入力に渡した文字列を子プロセスが読め、その終了コードを返す', async () => {
    const { runner, stdout } = createRunner();

    const result = await runner.run({
      command: BUN,
      args: script('process.exit((await Bun.stdin.text()) === "go" ? 4 : 5)'),
      stdin: 'go',
      output: 'inherit',
    });

    expect(result).toEqual({ code: 4, stdout: '', stderr: '' });
    expect(stdout.text()).toBe('');
  });

  test('シグナルで終了した子プロセスは128にシグナル番号を足した終了コードを返す', async () => {
    const { runner } = createRunner();

    const result = await runner.run({
      command: 'sh',
      args: ['-c', 'kill -TERM $$'],
      output: 'capture',
    });

    expect(result.code).toBe(143);
  });

  test('起動できないコマンドはコマンド名を含むエラーで失敗する', async () => {
    const { runner } = createRunner();

    const promise = runner.run({
      command: 'delivery-no-such-command',
      args: [],
      output: 'capture',
    });

    expect(await rejectionMessageOf(promise)).toContain(
      'delivery-no-such-commandを起動できませんでした',
    );
  });
});

describe('createCommandRunner().start', () => {
  test('常駐させた子プロセスの出力をログのファイルへ書き、末尾の行を読め、停止を待てる', async () => {
    const { runner } = createRunner();
    const logFile = join(await createTempDir(), 'service.log');

    const source =
      'console.log("line-1");console.error("line-2");console.log("line-3");setInterval(() => {}, 1000)';

    const running = runner.start({
      command: BUN,
      args: script(source),
      output: 'inherit',
      logFile,
    });
    await Bun.sleep(500);

    expect(running.name).toBe(`${BUN} -e ${source}`);
    expect(await running.tail(2)).toBe('line-2\nline-3\n');
    await running.stop();
    expect(await readFile(logFile, 'utf8')).toContain('line-1\n');
  });

  test('SIGTERMで終了しない子プロセスは猶予の後にSIGKILLで止める', async () => {
    const { runner } = createRunner({ stopGraceMs: 100 });
    const logFile = join(await createTempDir(), 'stubborn.log');

    const running = runner.start({
      command: BUN,
      args: script(
        'process.on("SIGTERM", () => {});console.log("ready");setInterval(() => {}, 1000)',
      ),
      output: 'inherit',
      logFile,
    });
    await Bun.sleep(500);
    const startedAt = performance.now();

    await running.stop();

    expect(performance.now() - startedAt).toBeLessThan(5_000);
  });

  test('既に終了した子プロセスの停止は何もせずに終わる', async () => {
    const { runner } = createRunner();
    const logFile = join(await createTempDir(), 'done.log');

    const running = runner.start({
      command: BUN,
      args: script('console.log("done")'),
      stdin: 'unused',
      output: 'inherit',
      logFile,
    });
    await Bun.sleep(500);

    await running.stop();
    expect(await running.tail(50)).toBe('done\n');
  });

  test('ログの行数が指定より少なければすべての行を返し、ログが空なら空を返す', async () => {
    const { runner } = createRunner();
    const logFile = join(await createTempDir(), 'quiet.log');

    const running = runner.start({
      command: BUN,
      args: script('setInterval(() => {}, 1000)'),
      output: 'inherit',
      logFile,
    });

    expect(await running.tail(50)).toBe('');
    await running.stop();
  });
});
