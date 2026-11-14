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

const SIGTERM_EXIT_CODE = 143;
const SETTLE_ATTEMPTS = 100;

interface StackControls {
  readonly crash: (line: string, code: number) => void;
  readonly settleUntil: (
    predicate: (timeline: readonly string[]) => boolean,
  ) => Promise<void>;
}

interface StackOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly exitCodeOf?: (spec: CommandSpec) => number;
  readonly runError?: (spec: CommandSpec) => Error | undefined;
  readonly startError?: (spec: StartSpec) => Error | undefined;
  readonly stopError?: (line: string) => Error | undefined;
  readonly reachable?: (url: string) => boolean;
  readonly tailOf?: (line: string) => string | Error;
  readonly duringTests?: (controls: StackControls) => Promise<void>;
}

const countOf = (timeline: readonly string[], entry: string): number =>
  timeline.filter((item) => item === entry).length;

const createStack = ({
  env = { RUNNER_TEMP, MAILPIT_BIN },
  exitCodeOf = () => 0,
  runError = () => undefined,
  startError = () => undefined,
  stopError = () => undefined,
  reachable = () => true,
  tailOf = (line) => `tail of ${line}\n`,
  duringTests = () => Promise.resolve(),
}: StackOptions = {}) => {
  const timeline: string[] = [];
  const runs: CommandSpec[] = [];
  const starts: StartSpec[] = [];
  const waits: { url: string; timeoutMs: number; expectStatus: unknown }[] = [];
  const tailRequests: number[] = [];
  const exitOf = new Map<string, (code: number) => void>();
  const controls: StackControls = {
    crash: (line, code) => {
      timeline.push(`crash:${line}`);
      exitOf.get(line)?.(code);
    },
    settleUntil: async (predicate) => {
      for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
        if (predicate(timeline)) return;
        await Bun.sleep(0);
      }
      throw new Error(`想定の順序になりませんでした: ${timeline.join(' | ')}`);
    },
  };
  const runner: CommandRunner = {
    run: async (spec) => {
      runs.push(spec);
      const line = commandLineOf(spec);
      timeline.push(`run:${line}`);
      const error = runError(spec);
      if (error !== undefined) throw error;
      if (line === TEST_LINE) await duringTests(controls);
      return { code: exitCodeOf(spec), stdout: '', stderr: '' };
    },
    start: (spec) => {
      const line = commandLineOf(spec);
      timeline.push(`start:${line}`);
      const error = startError(spec);
      if (error !== undefined) throw error;
      starts.push(spec);
      const { promise: exited, resolve: exit } =
        Promise.withResolvers<number>();
      exitOf.set(line, exit);
      const running: RunningProcess = {
        name: line,
        exited,
        stop: () => {
          timeline.push(`stop:${line}`);
          const failure = stopError(line);
          exit(SIGTERM_EXIT_CODE);
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
      const reached = reachable(url);
      return Promise.resolve({
        reached,
        lastStatus: reached ? 200 : undefined,
      });
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
  test('準備→Mailpit・api・eventを1つずつ起動して応答を待つ→テストのコマンド→停止の順に実行し、テストの終了コードを返す', async () => {
    const stack = createStack();

    const code = await command.run(ARGS, stack.deps);

    expect(code).toBe(EXIT_SUCCESS);
    expect(stack.timeline()).toEqual([
      `run:${PREPARE_LINE}`,
      `start:${MAILPIT_LINE}`,
      `wait:${MAILPIT_URL}`,
      `start:${API_LINE}`,
      `wait:${API_URL}`,
      `start:${EVENT_LINE}`,
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

  test('起動しないサービスがあれば、その名前とログの末尾50行を表示し、後続を起動せずテストも実行せずに起動済みのサービスを止めて失敗する', async () => {
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
    expect(stack.timeline()).toEqual([
      `run:${PREPARE_LINE}`,
      `start:${MAILPIT_LINE}`,
      `wait:${MAILPIT_URL}`,
      `start:${API_LINE}`,
      `wait:${API_URL}`,
      `stop:${MAILPIT_LINE}`,
      `stop:${API_LINE}`,
    ]);
  });

  // api・eventはローカル状態の保存先を共有し、同時に起動するとworkerdが保存先のSQLiteを同時に開いて「database is locked」で起動に失敗することがある
  test('eventはapiが応答してから起動する', async () => {
    const stack = createStack();

    await command.run(ARGS, stack.deps);

    const timeline = stack.timeline();
    expect(timeline.indexOf(`start:${EVENT_LINE}`)).toBeGreaterThan(
      timeline.indexOf(`wait:${API_URL}`),
    );
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
      `wait:${MAILPIT_URL}`,
      `start:${API_LINE}`,
      `stop:${MAILPIT_LINE}`,
    ]);
  });

  test('応答の待ちが例外を投げても、起動済みのサービスを止めてから失敗する', async () => {
    const stack = createStack({
      reachable: (url) => {
        if (url === API_URL) throw new Error('probe failed');
        return true;
      },
    });

    const message = await rejectionMessageOf(command.run(ARGS, stack.deps));

    expect(message).toBe('probe failed');
    expect(stack.timeline().slice(-2)).toEqual([
      `stop:${MAILPIT_LINE}`,
      `stop:${API_LINE}`,
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

  describe('テストの実行中に止まったサービスの再起動', () => {
    const restartedTimes = (timeline: readonly string[]): number =>
      countOf(timeline, `start:${EVENT_LINE}`) - 1;

    test('止まったサービスは名前・終了コード・ログの末尾を表示し、残ったプロセスを止めてから起動し直して応答を待ち、テストの終了コードを返す', async () => {
      const stack = createStack({
        tailOf: (line) =>
          line === EVENT_LINE ? 'event-log-1\nevent-log-2\n' : '',
        duringTests: async ({ crash, settleUntil }) => {
          crash(EVENT_LINE, 1);
          await settleUntil(
            (timeline) => countOf(timeline, `wait:${EVENT_URL}`) === 2,
          );
        },
      });

      const code = await command.run(ARGS, stack.deps);

      expect(code).toBe(EXIT_SUCCESS);
      expect(
        stack.timeline().slice(stack.timeline().indexOf(`run:${TEST_LINE}`)),
      ).toEqual([
        `run:${TEST_LINE}`,
        `crash:${EVENT_LINE}`,
        `stop:${EVENT_LINE}`,
        `start:${EVENT_LINE}`,
        `wait:${EVENT_URL}`,
        `stop:${MAILPIT_LINE}`,
        `stop:${API_LINE}`,
        `stop:${EVENT_LINE}`,
      ]);
      expect(stack.stderr.text()).toBe(
        [
          'e2e-stack: eventが終了コード1で止まりました。ログ(/runner-temp/e2e-logs/event.log)の末尾50行:',
          'event-log-1',
          'event-log-2',
          'e2e-stack: eventを起動し直します(1/3回目)。',
          'e2e-stack: eventを起動し直しました。',
          '',
        ].join('\n'),
      );
    });

    test('起動し直す時も設計の作業ディレクトリとログで起動する', async () => {
      const stack = createStack({
        duringTests: async ({ crash, settleUntil }) => {
          crash(API_LINE, 1);
          await settleUntil(
            (timeline) => countOf(timeline, `wait:${API_URL}`) === 2,
          );
        },
      });

      await command.run(ARGS, stack.deps);

      const restarted = stack.starts().at(-1);
      expect(restarted?.cwd).toBe('/repo/apps/api');
      expect(restarted?.logFile).toBe('/runner-temp/e2e-logs/api.log');
    });

    test('終了の時に止めたサービスは起動し直さない', async () => {
      const stack = createStack();

      await command.run(ARGS, stack.deps);

      expect(stack.starts()).toHaveLength(3);
      expect(stack.stderr.text()).toBe('');
    });

    test('上限の3回まで起動し直し、それを超えて止まったら起動し直さずにテストの終了を待つ', async () => {
      const stack = createStack({
        exitCodeOf: (spec) => (commandLineOf(spec) === TEST_LINE ? 1 : 0),
        duringTests: async ({ crash, settleUntil }) => {
          for (let restart = 1; restart <= 3; restart += 1) {
            crash(EVENT_LINE, 1);
            await settleUntil(
              (timeline) =>
                countOf(timeline, `wait:${EVENT_URL}`) === restart + 1,
            );
          }
          crash(EVENT_LINE, 1);
          await settleUntil(() => stack.stderr.text().includes('上限'));
        },
      });

      const code = await command.run(ARGS, stack.deps);

      expect(code).toBe(1);
      expect(restartedTimes(stack.timeline())).toBe(3);
      expect(stack.stderr.text()).toContain(
        'e2e-stack: eventは起動し直す上限(3回)に達したため、起動し直しません。\n',
      );
    });

    test('起動し直したサービスが応答しなければ、その名前とログの末尾を表示し、それ以上は起動し直さない', async () => {
      let restarted = false;
      const stack = createStack({
        reachable: (url) => url !== EVENT_URL || !restarted,
        duringTests: async ({ crash, settleUntil }) => {
          restarted = true;
          crash(EVENT_LINE, 1);
          await settleUntil(
            (timeline) => countOf(timeline, `wait:${EVENT_URL}`) === 2,
          );
          await settleUntil(() =>
            stack.stderr.text().includes('起動し直せませんでした'),
          );
          crash(EVENT_LINE, 1);
        },
      });

      const code = await command.run(ARGS, stack.deps);

      expect(code).toBe(EXIT_SUCCESS);
      expect(restartedTimes(stack.timeline())).toBe(1);
      expect(stack.stderr.text()).toContain(
        [
          'e2e-stack: eventを起動し直せませんでした。',
          'eventが起動しませんでした(http://127.0.0.1:48043/healthが3分以内に200を返しませんでした)。ログ(/runner-temp/e2e-logs/event.log)の末尾50行:',
        ].join('\n'),
      );
    });

    test('止まったサービスの残ったプロセスを止められなくても、表示して起動し直す', async () => {
      let crashed = false;
      const stack = createStack({
        stopError: (line) =>
          line === EVENT_LINE && crashed ? new Error('kill failed') : undefined,
        duringTests: async ({ crash, settleUntil }) => {
          crashed = true;
          crash(EVENT_LINE, 1);
          await settleUntil(
            (timeline) => countOf(timeline, `wait:${EVENT_URL}`) === 2,
          );
          crashed = false;
        },
      });

      await command.run(ARGS, stack.deps);

      expect(restartedTimes(stack.timeline())).toBe(1);
      expect(stack.stderr.text()).toContain(
        'e2e-stack: eventを止められませんでした: kill failed\n',
      );
    });

    test('起動し直す途中で例外が出ても、その理由を表示してテストの終了を待ち、すべてのサービスを止める', async () => {
      let restarted = false;
      const stack = createStack({
        reachable: (url) => {
          if (url === EVENT_URL && restarted) throw new Error('probe failed');
          return true;
        },
        duringTests: async ({ crash, settleUntil }) => {
          restarted = true;
          crash(EVENT_LINE, 1);
          await settleUntil(() =>
            stack.stderr.text().includes('起動し直せませんでした'),
          );
        },
      });

      const code = await command.run(ARGS, stack.deps);

      expect(code).toBe(EXIT_SUCCESS);
      expect(stack.stderr.text()).toContain(
        'e2e-stack: eventを起動し直せませんでした: probe failed\n',
      );
      expect(stack.timeline().slice(-3)).toEqual([
        `stop:${MAILPIT_LINE}`,
        `stop:${API_LINE}`,
        `stop:${EVENT_LINE}`,
      ]);
    });

    test('起動し直している途中でテストが終わったら、起動し直し終えてからすべてのサービスを止める', async () => {
      const stack = createStack({
        duringTests: async ({ crash, settleUntil }) => {
          crash(EVENT_LINE, 1);
          await settleUntil((timeline) =>
            timeline.includes(`stop:${EVENT_LINE}`),
          );
        },
      });

      await command.run(ARGS, stack.deps);

      expect(stack.timeline().slice(-5)).toEqual([
        `start:${EVENT_LINE}`,
        `wait:${EVENT_URL}`,
        `stop:${MAILPIT_LINE}`,
        `stop:${API_LINE}`,
        `stop:${EVENT_LINE}`,
      ]);
    });
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
