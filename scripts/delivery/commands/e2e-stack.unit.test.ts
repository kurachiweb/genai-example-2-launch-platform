import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  CommandRunner,
  CommandSpec,
  RunningProcess,
} from '../adapters/command-runner.ts';
import type { HttpProbe } from '../adapters/http-probe.ts';
import { commandLineOf } from '../test-fixtures/command-runner.ts';
import { rejectionMessageOf } from '../test-fixtures/rejection.ts';
import {
  createFakeDeps,
  createFakeRepoFiles,
} from '../test-fixtures/repo-files.ts';
import { command } from './e2e-stack.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';

const RUNNER_TEMP = '/runner-temp';
const MAILPIT_BIN = '/opt/mailpit/mailpit';
const TEST_COMMAND = ['bun', 'run', 'test:e2e:dev-and-preview'] as const;

const PREPARE_LINE = 'bun run db:migrate:local';
const MAILPIT_LINE = `${MAILPIT_BIN} --listen 127.0.0.1:48041`;
const API_LINE =
  'bun /repo/scripts/delivery/cli.ts run-with-secrets --scope checks --worker api -- bunx wrangler dev --port 48042 --ip 127.0.0.1 --persist-to /workspace/.wrangler/state --test-scheduled';
const EVENT_LINE =
  'bun /repo/scripts/delivery/cli.ts run-with-secrets --scope checks --worker event -- bunx wrangler dev --port 48043 --ip 127.0.0.1 --persist-to /workspace/.wrangler/state --inspector-port 9230';
const TEST_LINE = TEST_COMMAND.join(' ');

const MAILPIT_URL = 'http://127.0.0.1:48041/';
const API_URL = 'http://127.0.0.1:48042/health';
const EVENT_URL = 'http://127.0.0.1:48043/health';

type StartSpec = CommandSpec & { readonly logFile: string };

interface StackOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly exitCodeOf?: (spec: CommandSpec) => number;
  readonly runError?: (spec: CommandSpec) => Error | undefined;
  readonly startError?: (spec: StartSpec) => Error | undefined;
  readonly stopError?: (line: string) => Error | undefined;
  readonly reachable?: (url: string) => boolean;
  readonly tailOf?: (line: string) => string | Error;
}

const createStack = ({
  env = { RUNNER_TEMP, MAILPIT_BIN },
  exitCodeOf = () => 0,
  runError = () => undefined,
  startError = () => undefined,
  stopError = () => undefined,
  reachable = () => true,
  tailOf = (line) => `tail of ${line}\n`,
}: StackOptions = {}) => {
  const timeline: string[] = [];
  const runs: CommandSpec[] = [];
  const starts: StartSpec[] = [];
  const waits: { url: string; timeoutMs: number; expectStatus: unknown }[] = [];
  const tailRequests: number[] = [];
  const runner: CommandRunner = {
    run: (spec) => {
      runs.push(spec);
      timeline.push(`run:${commandLineOf(spec)}`);
      const error = runError(spec);
      if (error !== undefined) return Promise.reject(error);
      return Promise.resolve({
        code: exitCodeOf(spec),
        stdout: '',
        stderr: '',
      });
    },
    start: (spec) => {
      const line = commandLineOf(spec);
      timeline.push(`start:${line}`);
      const error = startError(spec);
      if (error !== undefined) throw error;
      starts.push(spec);
      const running: RunningProcess = {
        name: line,
        stop: () => {
          timeline.push(`stop:${line}`);
          const failure = stopError(line);
          return failure === undefined
            ? Promise.resolve()
            : Promise.reject(failure);
        },
        tail: (lines) => {
          tailRequests.push(lines);
          const tail = tailOf(line);
          return tail instanceof Error
            ? Promise.reject(tail)
            : Promise.resolve(tail);
        },
      };
      return running;
    },
  };
  const probe: HttpProbe = {
    waitFor: (url, { timeoutMs, expectStatus }) => {
      waits.push({ url, timeoutMs, expectStatus });
      timeline.push(`wait:${url}`);
      return Promise.resolve(reachable(url));
    },
  };
  const fake = createFakeDeps(createFakeRepoFiles({}));
  const deps = { ...fake.deps, env, runner, probe };
  return {
    deps,
    stdout: fake.stdout,
    stderr: fake.stderr,
    timeline: () => [...timeline],
    runs: () => [...runs],
    starts: () => [...starts],
    waits: () => [...waits],
    tailRequests: () => [...tailRequests],
  };
};

const ARGS = ['--', ...TEST_COMMAND] as const;

describe('e2e-stack', () => {
  test('準備→Mailpit・api・eventの起動→待ち合わせ→テストのコマンド→停止の順に実行し、テストの終了コードを返す', async () => {
    const stack = createStack();

    const code = await command.run(ARGS, stack.deps);

    expect(code).toBe(EXIT_SUCCESS);
    expect(stack.timeline()).toEqual([
      `run:${PREPARE_LINE}`,
      `start:${MAILPIT_LINE}`,
      `start:${API_LINE}`,
      `start:${EVENT_LINE}`,
      `wait:${MAILPIT_URL}`,
      `wait:${API_URL}`,
      `wait:${EVENT_URL}`,
      `run:${TEST_LINE}`,
      `stop:${MAILPIT_LINE}`,
      `stop:${API_LINE}`,
      `stop:${EVENT_LINE}`,
    ]);
  });

  test('client・adminは起動しない', async () => {
    const stack = createStack();

    await command.run(ARGS, stack.deps);

    const started = stack.starts().map((spec) => ({
      line: commandLineOf(spec),
      cwd: spec.cwd ?? '',
    }));
    for (const { line, cwd } of started) {
      expect(cwd).not.toMatch(/apps\/(client|admin)/);
      expect(line).not.toMatch(/4804[45]|client|admin/);
    }
    expect(started).toHaveLength(3);
  });

  test('準備はapiのディレクトリで、各サービスは設計の作業ディレクトリとランナーの一時ディレクトリのログで起動する', async () => {
    const stack = createStack();

    await command.run(ARGS, stack.deps);

    const [prepare] = stack.runs();
    expect(prepare?.cwd).toBe('/repo/apps/api');
    expect(prepare?.output).toBe('inherit');
    expect(
      stack.starts().map(({ cwd, logFile, output, env }) => ({
        cwd,
        logFile,
        output,
        env,
      })),
    ).toEqual([
      {
        cwd: '/repo',
        logFile: '/runner-temp/e2e-logs/mailpit.log',
        output: 'inherit',
        env: undefined,
      },
      {
        cwd: '/repo/apps/api',
        logFile: '/runner-temp/e2e-logs/api.log',
        output: 'inherit',
        env: undefined,
      },
      {
        cwd: '/repo/apps/event',
        logFile: '/runner-temp/e2e-logs/event.log',
        output: 'inherit',
        env: undefined,
      },
    ]);
  });

  test('api・eventは注入のコマンドをWorkerの指定付きで通して起動する', async () => {
    const stack = createStack();

    await command.run(ARGS, stack.deps);

    const [, api, event] = stack.starts();
    expect(api?.args.slice(0, 6)).toEqual([
      '/repo/scripts/delivery/cli.ts',
      'run-with-secrets',
      '--scope',
      'checks',
      '--worker',
      'api',
    ]);
    expect(event?.args.slice(0, 6)).toEqual([
      '/repo/scripts/delivery/cli.ts',
      'run-with-secrets',
      '--scope',
      'checks',
      '--worker',
      'event',
    ]);
  });

  test('テストのコマンドはルートで親の環境のまま起動し、Workerごとの値を渡さない', async () => {
    const stack = createStack();

    await command.run(ARGS, stack.deps);

    const testRun = stack.runs().at(-1);
    expect(testRun).toEqual({
      command: 'bun',
      args: ['run', 'test:e2e:dev-and-preview'],
      cwd: '/repo',
      output: 'inherit',
    });
  });

  test('待ち合わせは各3分で、Mailpitは応答があれば、api・eventは200で起動したとみなす', async () => {
    const stack = createStack();

    await command.run(ARGS, stack.deps);

    expect(stack.waits()).toEqual([
      { url: MAILPIT_URL, timeoutMs: 180_000, expectStatus: 'any' },
      { url: API_URL, timeoutMs: 180_000, expectStatus: 200 },
      { url: EVENT_URL, timeoutMs: 180_000, expectStatus: 200 },
    ]);
  });

  test('テストのコマンドが失敗したら、すべてのサービスを止めてからその終了コードを返す', async () => {
    const stack = createStack({
      exitCodeOf: (spec) => (commandLineOf(spec) === TEST_LINE ? 3 : 0),
    });

    const code = await command.run(ARGS, stack.deps);

    expect(code).toBe(3);
    expect(stack.timeline().slice(-3)).toEqual([
      `stop:${MAILPIT_LINE}`,
      `stop:${API_LINE}`,
      `stop:${EVENT_LINE}`,
    ]);
  });

  test('起動しないサービスがあれば、その名前とログの末尾50行を表示し、テストを実行せずにすべてのサービスを止めて失敗する', async () => {
    const stack = createStack({
      reachable: (url) => url !== API_URL,
      tailOf: (line) => (line === API_LINE ? 'api-log-1\napi-log-2\n' : ''),
    });

    const code = await command.run(ARGS, stack.deps);

    expect(code).toBe(EXIT_FAILURE);
    expect(stack.stderr.text()).toBe(
      [
        'e2e-stack: 起動しなかったサービスがあります。',
        'apiが起動しませんでした(http://127.0.0.1:48042/healthが3分以内に200を返しませんでした)。ログ(/runner-temp/e2e-logs/api.log)の末尾50行:',
        'api-log-1',
        'api-log-2',
        '',
      ].join('\n'),
    );
    expect(stack.tailRequests()).toEqual([50]);
    expect(stack.timeline()).not.toContain(`run:${TEST_LINE}`);
    expect(stack.timeline().slice(-3)).toEqual([
      `stop:${MAILPIT_LINE}`,
      `stop:${API_LINE}`,
      `stop:${EVENT_LINE}`,
    ]);
  });

  test('Mailpitが応答しない時は、応答を待った対象を表示する', async () => {
    const stack = createStack({ reachable: (url) => url !== MAILPIT_URL });

    const code = await command.run(ARGS, stack.deps);

    expect(code).toBe(EXIT_FAILURE);
    expect(stack.stderr.text()).toContain(
      'mailpitが起動しませんでした(http://127.0.0.1:48041/が3分以内に応答しませんでした)',
    );
  });

  test('起動できないサービスがあれば、その名前を表示し、後続を起動せず起動済みのサービスを止めて失敗する', async () => {
    const stack = createStack({
      startError: (spec) =>
        spec.cwd === '/repo/apps/api'
          ? new Error('bunを起動できませんでした: spawn failed')
          : undefined,
    });

    const code = await command.run(ARGS, stack.deps);

    expect(code).toBe(EXIT_FAILURE);
    expect(stack.stderr.text()).toContain(
      'apiが起動しませんでした(bunを起動できませんでした: spawn failed)',
    );
    expect(stack.timeline()).toEqual([
      `run:${PREPARE_LINE}`,
      `start:${MAILPIT_LINE}`,
      `start:${API_LINE}`,
      `stop:${MAILPIT_LINE}`,
    ]);
  });

  test('ログの末尾を読めなければ、その理由を表示して続ける', async () => {
    const stack = createStack({
      reachable: (url) => url !== EVENT_URL,
      tailOf: () => new Error('ENOENT: no such file'),
    });

    const code = await command.run(ARGS, stack.deps);

    expect(code).toBe(EXIT_FAILURE);
    expect(stack.stderr.text()).toContain(
      '(ログを読めませんでした: ENOENT: no such file)',
    );
  });

  test('準備が失敗したら、サービスを起動せずに失敗する', async () => {
    const stack = createStack({
      exitCodeOf: (spec) => (commandLineOf(spec) === PREPARE_LINE ? 1 : 0),
    });

    const code = await command.run(ARGS, stack.deps);

    expect(code).toBe(EXIT_FAILURE);
    expect(stack.timeline()).toEqual([`run:${PREPARE_LINE}`]);
    expect(stack.stderr.text()).toBe(
      'e2e-stack: 準備(apps/apiのbun run db:migrate:local)が終了コード1で失敗しました。\n',
    );
  });

  test('テストのコマンドを起動できなくても、すべてのサービスを止めてから失敗する', async () => {
    const stack = createStack({
      runError: (spec) =>
        commandLineOf(spec) === TEST_LINE
          ? new Error('bunを起動できませんでした')
          : undefined,
    });

    const message = await rejectionMessageOf(command.run(ARGS, stack.deps));

    expect(message).toBe('bunを起動できませんでした');
    expect(stack.timeline().slice(-3)).toEqual([
      `stop:${MAILPIT_LINE}`,
      `stop:${API_LINE}`,
      `stop:${EVENT_LINE}`,
    ]);
  });

  test('止められないサービスがあれば表示して失敗し、他のサービスは止める', async () => {
    const stack = createStack({
      stopError: (line) =>
        line === API_LINE ? new Error('kill failed') : undefined,
    });

    const code = await command.run(ARGS, stack.deps);

    expect(code).toBe(EXIT_FAILURE);
    expect(stack.stderr.text()).toBe(
      'e2e-stack: apiを止められませんでした: kill failed\n',
    );
    expect(stack.timeline().slice(-3)).toEqual([
      `stop:${MAILPIT_LINE}`,
      `stop:${API_LINE}`,
      `stop:${EVENT_LINE}`,
    ]);
  });

  test('MAILPIT_BINが無ければPATHのmailpitを、RUNNER_TEMPが無ければOSの一時ディレクトリを使う', async () => {
    const stack = createStack({ env: {} });

    await command.run(ARGS, stack.deps);

    const [mailpit] = stack.starts();
    expect(mailpit?.command).toBe('mailpit');
    expect(mailpit?.logFile).toBe(join(tmpdir(), 'e2e-logs', 'mailpit.log'));
  });

  test('`--`の後にコマンドが無ければ引数の誤りにする', async () => {
    const stack = createStack();

    const message = await rejectionMessageOf(command.run([], stack.deps));
    const separatorOnly = await rejectionMessageOf(
      command.run(['--'], stack.deps),
    );

    expect(message).toContain('`--`の後に');
    expect(separatorOnly).toContain('`--`の後に');
    expect(stack.timeline()).toEqual([]);
  });

  test('オプションは受け取らない', async () => {
    const stack = createStack();

    let thrown: unknown;
    try {
      await command.run(['--env', 'staging', ...ARGS], stack.deps);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UsageError);
    expect(stack.timeline()).toEqual([]);
  });
});
