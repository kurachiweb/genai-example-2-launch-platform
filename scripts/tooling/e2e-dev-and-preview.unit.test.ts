import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { E2ETarget } from '../../e2e/support/targets.ts';
import {
  createFakeDualModeDeps,
  type FakeDualModeOptions,
} from '../../test-support/dual-mode-e2e-fixtures.ts';
import { SPAWN_TIMEOUT_MS } from '../../test-support/run-all-fixtures.ts';
import {
  createServerStarter,
  handleInterruptSignals,
  type InterruptSignal,
  interruptedExitCodeOf,
  type DualModePlan,
  type DualModeTarget,
  isLoopbackPortInUse,
  planDualModeE2E,
  runDualModeE2E,
  runDualModeE2EEntry,
  waitUntilReachable,
} from './e2e-dev-and-preview.ts';

const DEFAULT_TARGETS: readonly E2ETarget[] = [
  { name: 'client', baseURL: 'http://localhost:48044' },
  { name: 'admin', baseURL: 'http://localhost:48045' },
];

const EVERY_APP = () => true;

const CLIENT_TARGET: DualModeTarget = {
  name: 'client',
  baseURL: 'http://localhost:48044',
  port: 48044,
  appDir: 'apps/client',
};

const ADMIN_TARGET: DualModeTarget = {
  name: 'admin',
  baseURL: 'http://localhost:48045',
  port: 48045,
  appDir: 'apps/admin',
};

const DEV_CLIENT = 'apps/client: bun run dev --port 48044 --host 0.0.0.0';
const DEV_ADMIN = 'apps/admin: bun run dev --port 48045 --host 0.0.0.0';
const PREVIEW_CLIENT =
  'apps/client: bun run preview --port 48044 --host 0.0.0.0';
const PREVIEW_ADMIN = 'apps/admin: bun run preview --port 48045 --host 0.0.0.0';
const RUN_E2E = 'run .: bun run test:e2e';

const planOf = (
  targets: readonly E2ETarget[] = DEFAULT_TARGETS,
  hasApp: (appDir: string) => boolean = EVERY_APP,
): DualModePlan => {
  const result = planDualModeE2E(targets, hasApp);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.plan;
};

const runWithFakes = async (
  options: FakeDualModeOptions = {},
  plan: DualModePlan = planOf(),
) => {
  const fake = createFakeDualModeDeps(options);
  const exitCode = await runDualModeE2E(plan, fake.deps);
  return {
    exitCode,
    events: fake.events,
    stdout: fake.stdout.text(),
    stderr: fake.stderr.text(),
  };
};

const linesOf = (count: number): readonly string[] =>
  Array.from({ length: count }, (_, index) => `出力${String(index + 1)}`);

describe('planDualModeE2E', () => {
  test('各対象を開発サーバーで起動してE2Eを実行する段階と、ビルドしてプレビューで起動してE2Eを実行する段階を、この順に計画する', () => {
    const result = planDualModeE2E(DEFAULT_TARGETS, EVERY_APP);

    expect(result).toEqual({
      ok: true,
      plan: {
        targets: [CLIENT_TARGET, ADMIN_TARGET],
        skippedTargets: [],
        stages: [
          {
            name: 'dev',
            steps: [
              {
                target: CLIENT_TARGET,
                prepareCommands: [],
                serverCommand: [
                  'bun',
                  'run',
                  'dev',
                  '--port',
                  '48044',
                  '--host',
                  '0.0.0.0',
                ],
              },
              {
                target: ADMIN_TARGET,
                prepareCommands: [],
                serverCommand: [
                  'bun',
                  'run',
                  'dev',
                  '--port',
                  '48045',
                  '--host',
                  '0.0.0.0',
                ],
              },
            ],
            testCommand: ['bun', 'run', 'test:e2e'],
          },
          {
            name: 'preview',
            steps: [
              {
                target: CLIENT_TARGET,
                prepareCommands: [['bun', 'run', 'build']],
                serverCommand: [
                  'bun',
                  'run',
                  'preview',
                  '--port',
                  '48044',
                  '--host',
                  '0.0.0.0',
                ],
              },
              {
                target: ADMIN_TARGET,
                prepareCommands: [['bun', 'run', 'build']],
                serverCommand: [
                  'bun',
                  'run',
                  'preview',
                  '--port',
                  '48045',
                  '--host',
                  '0.0.0.0',
                ],
              },
            ],
            testCommand: ['bun', 'run', 'test:e2e'],
          },
        ],
      },
    });
  });

  test('127.0.0.1を指すURLを受け付け、ポートの無いURLはスキームの既定のポートを使う', () => {
    const plan = planOf([
      { name: 'client', baseURL: 'http://127.0.0.1:5173' },
      { name: 'admin', baseURL: 'http://localhost' },
    ]);

    expect(plan.targets.map(({ port }) => port)).toEqual([5173, 80]);
  });

  test('apps/<対象名>にアプリ(package.json)が無い対象を飛ばす', () => {
    const checked: string[] = [];

    const plan = planOf(DEFAULT_TARGETS, (appDir) => {
      checked.push(appDir);
      return appDir !== 'apps/admin';
    });

    expect(checked).toEqual(['apps/client', 'apps/admin']);
    expect(plan.skippedTargets).toEqual(['admin']);
    expect(plan.targets.map(({ name }) => name)).toEqual(['client']);
    expect(
      plan.stages.map(({ steps }) => steps.map(({ target }) => target.name)),
    ).toEqual([['client'], ['client']]);
  });

  test('ローカルでないURLや解釈できないURLの対象があれば、対象とURLを示して計画しない', () => {
    const result = planDualModeE2E(
      [
        { name: 'client', baseURL: 'https://staging.example' },
        { name: 'admin', baseURL: 'not a url' },
      ],
      EVERY_APP,
    );

    expect(result).toEqual({
      ok: false,
      errors: [
        'E2Eの対象のURLがローカル(localhost・127.0.0.1)を指していないため、起動できません: client(https://staging.example)',
        'E2Eの対象のURLを解釈できません: admin(not a url)',
      ],
    });
  });

  test('アプリの無い対象のURLがローカルでなくても失敗にしない', () => {
    const result = planDualModeE2E(
      [
        { name: 'client', baseURL: 'http://localhost:48044' },
        { name: 'admin', baseURL: 'https://staging.example' },
      ],
      (appDir) => appDir === 'apps/client',
    );

    expect(result.ok).toBe(true);
  });
});

describe('runDualModeE2E', () => {
  test('ポートの確認→開発サーバーの起動と待ち合わせ→E2E→停止→ビルドとプレビューの起動と待ち合わせ→E2E→停止の順に実行し、0を返す', async () => {
    const { exitCode, events, stdout } = await runWithFakes();

    expect(events).toEqual([
      'port 48044',
      'port 48045',
      `start ${DEV_CLIENT}`,
      'wait http://localhost:48044',
      `start ${DEV_ADMIN}`,
      'wait http://localhost:48045',
      RUN_E2E,
      'stop apps/client dev',
      'stop apps/admin dev',
      'run apps/client: bun run build',
      `start ${PREVIEW_CLIENT}`,
      'wait http://localhost:48044',
      'run apps/admin: bun run build',
      `start ${PREVIEW_ADMIN}`,
      'wait http://localhost:48045',
      RUN_E2E,
      'stop apps/client preview',
      'stop apps/admin preview',
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(
      [
        '段階                         結果',
        '開発サーバーでのE2E          成功',
        'ビルド後のプレビューでのE2E  成功',
        '',
      ].join('\n'),
    );
  });

  test('開発サーバーのE2Eが失敗してもプレビューの段階を実行し、段階ごとの結果を表示して1を返す', async () => {
    const { exitCode, events, stdout } = await runWithFakes({
      exitCodes: { '. test:e2e': [1, 0] },
    });

    expect(events.filter((event) => event === RUN_E2E)).toHaveLength(2);
    expect(events).toContain(`start ${PREVIEW_ADMIN}`);
    expect(exitCode).toBe(1);
    expect(stdout).toContain(
      [
        '段階                         結果',
        '開発サーバーでのE2E          失敗(E2Eテストの終了コード1)',
        'ビルド後のプレビューでのE2E  成功',
        '',
      ].join('\n'),
    );
  });

  test('使われているポートがあれば、何も起動せずにポートと対象を示して1を返す', async () => {
    const { exitCode, events, stderr } = await runWithFakes({
      portsInUse: [48044, 48045],
    });

    expect(events).toEqual(['port 48044', 'port 48045']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      'ポートが使われています。古いサーバーを止めてから実行してください: 48044(client)・48045(admin)',
    );
  });

  test('応答しない対象があれば、名前と出力の末尾を表示してすべての対象を止め、その段階のE2Eを実行せずに失敗にする', async () => {
    const { exitCode, events, stdout, stderr } = await runWithFakes({
      serverFailures: { 'apps/admin dev': 'timeout' },
      outputTail: ['最後から2行目', '最後の行'],
    });

    expect(events.slice(2, 7)).toEqual([
      `start ${DEV_CLIENT}`,
      'wait http://localhost:48044',
      `start ${DEV_ADMIN}`,
      'wait http://localhost:48045',
      'stop apps/client dev',
    ]);
    expect(events[7]).toBe('stop apps/admin dev');
    expect(events.filter((event) => event === RUN_E2E)).toHaveLength(1);
    expect(events).toContain(`start ${PREVIEW_ADMIN}`);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      'adminが起動しませんでした(3分以内に応答しなかった)。出力の末尾:\n最後から2行目\n最後の行\n',
    );
    expect(stdout).toContain(
      '開発サーバーでのE2E          失敗(adminが起動しない)',
    );
  });

  test('応答する前に終了した対象があれば、終了コードと出力の末尾を表示してすべての対象を止める', async () => {
    const { exitCode, events, stderr } = await runWithFakes({
      serverFailures: { 'apps/client preview': 'exit' },
    });

    expect(events.slice(-3)).toEqual([
      `start ${PREVIEW_CLIENT}`,
      'wait http://localhost:48044',
      'stop apps/client preview',
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      'clientが起動しませんでした(応答する前に終了した。終了コード1)。出力の末尾:\n(出力なし)\n',
    );
  });

  test('ビルドが失敗した対象があれば、起動済みの対象を止めてその段階のE2Eを実行せずに失敗にする', async () => {
    const { exitCode, events, stdout } = await runWithFakes({
      exitCodes: { 'apps/admin build': 2 },
    });

    expect(events.slice(-4)).toEqual([
      `start ${PREVIEW_CLIENT}`,
      'wait http://localhost:48044',
      'run apps/admin: bun run build',
      'stop apps/client preview',
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain(
      'ビルド後のプレビューでのE2E  失敗(adminのビルドの終了コード2)',
    );
  });

  test('コマンドを実行できなければ、原因を表示してその段階を失敗にする', async () => {
    const { exitCode, stdout, stderr } = await runWithFakes({
      exitCodes: { '. test:e2e': [new Error('spawn ENOENT'), 0] },
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      'ルートで`bun run test:e2e`を実行できませんでした: spawn ENOENT',
    );
    expect(stdout).toContain(
      '開発サーバーでのE2E          失敗(コマンドを実行できない)',
    );
  });

  test('飛ばした対象を表示する', async () => {
    const { stdout } = await runWithFakes(
      {},
      planOf(DEFAULT_TARGETS, (appDir) => appDir === 'apps/client'),
    );

    expect(stdout).toContain(
      'apps/adminにアプリ(package.json)が無いため、adminを飛ばします',
    );
  });
});

describe('runDualModeE2E(中断)', () => {
  const eventsAfter = (events: readonly string[], marker: string) =>
    events.slice(events.indexOf(marker) + 1);

  test('到達の待ち合わせ中に中断すると、起動済みの対象を止め、それ以降は何も実行・起動せずに1を返す', async () => {
    const { exitCode, events, stdout } = await runWithFakes({
      interruptAt: 'wait http://localhost:48045',
    });

    expect(eventsAfter(events, 'wait http://localhost:48045')).toEqual([
      'stop apps/client dev',
      'stop apps/admin dev',
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('中断したため、残りの段階を実行しませんでした');
    expect(stdout).toContain('開発サーバーでのE2E  中断');
  });

  test('E2Eの実行中に中断すると、対象を止め、プレビューの段階のビルドも起動も行わない', async () => {
    const { exitCode, events, stdout } = await runWithFakes({
      interruptAt: RUN_E2E,
    });

    expect(eventsAfter(events, RUN_E2E)).toEqual([
      'stop apps/client dev',
      'stop apps/admin dev',
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).not.toContain('ビルド後のプレビューでのE2E');
  });

  test('ビルドの実行中に中断すると、起動済みの対象を止め、次の対象のビルドもプレビューの起動も行わない', async () => {
    const { events } = await runWithFakes({
      interruptAt: 'run apps/admin: bun run build',
    });

    expect(eventsAfter(events, 'run apps/admin: bun run build')).toEqual([
      'stop apps/client preview',
    ]);
  });
});

describe('handleInterruptSignals', () => {
  test('最初の中断のシグナルだけを知らせ、2回目以降は無視して既定の動作(即時終了)をさせない', () => {
    const target = new EventEmitter();
    const received: string[] = [];

    const interruptedBy = handleInterruptSignals(target, (signal) => {
      received.push(signal);
    });
    const before = interruptedBy();
    target.emit('SIGTERM');
    target.emit('SIGINT');
    target.emit('SIGTERM');

    expect(before).toBeUndefined();
    expect(received).toEqual(['SIGTERM']);
    expect(interruptedBy()).toBe('SIGTERM');
    expect(target.listenerCount('SIGINT')).toBe(1);
    expect(target.listenerCount('SIGTERM')).toBe(1);
  });

  test.each<[InterruptSignal, number]>([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ])('%sで中断したときの終了コードは%dになる', (signal, exitCode) => {
    expect(interruptedExitCodeOf(signal)).toBe(exitCode);
  });
});

describe('runDualModeE2EEntry', () => {
  test('環境の変数から対象を解決し、ローカルでないURLの対象があれば何も起動せずに1を返す', async () => {
    const fake = createFakeDualModeDeps();

    const exitCode = await runDualModeE2EEntry({
      ...fake.deps,
      env: { E2E_ADMIN_URL: 'https://staging.example' },
      hasApp: EVERY_APP,
    });

    expect(exitCode).toBe(1);
    expect(fake.events).toEqual([]);
    expect(fake.stderr.text()).toContain('admin(https://staging.example)');
  });

  test('環境の変数のURLで計画して実行する', async () => {
    const fake = createFakeDualModeDeps();

    const exitCode = await runDualModeE2EEntry({
      ...fake.deps,
      env: { E2E_CLIENT_URL: 'http://127.0.0.1:5173' },
      hasApp: (appDir) => appDir === 'apps/client',
    });

    expect(exitCode).toBe(0);
    expect(fake.events.slice(0, 2)).toEqual([
      'port 5173',
      'start apps/client: bun run dev --port 5173 --host 0.0.0.0',
    ]);
  });
});

const withServer = async <T>(use: (port: number) => Promise<T>): Promise<T> => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('ok'),
  });
  try {
    return await use(server.port ?? 0);
  } finally {
    await server.stop(true);
  }
};

const closedPort = (): Promise<number> =>
  withServer((port) => Promise.resolve(port));

describe('isLoopbackPortInUse', () => {
  test('待ち受けているポートは真、待ち受けていないポートは偽を返す', async () => {
    const inUse = await withServer((port) => isLoopbackPortInUse(port));
    const free = await isLoopbackPortInUse(await closedPort());

    expect(inUse).toBe(true);
    expect(free).toBe(false);
  });
});

describe('waitUntilReachable', () => {
  test('応答すれば真を返す', async () => {
    const reachable = await withServer((port) =>
      waitUntilReachable(
        `http://127.0.0.1:${String(port)}`,
        new AbortController().signal,
      ),
    );

    expect(reachable).toBe(true);
  });

  test('上限までに応答しなければ偽を返す', async () => {
    const url = `http://127.0.0.1:${String(await closedPort())}`;
    const startedAt = performance.now();

    const reachable = await waitUntilReachable(
      url,
      new AbortController().signal,
      { timeoutMs: 300, intervalMs: 50 },
    );

    expect(reachable).toBe(false);
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(250);
  });

  test('打ち切られたら待たずに偽を返す', async () => {
    const url = `http://127.0.0.1:${String(await closedPort())}`;
    const controller = new AbortController();
    controller.abort();

    const reachable = await waitUntilReachable(url, controller.signal, {
      timeoutMs: 60_000,
    });

    expect(reachable).toBe(false);
  });
});

const waitFor = async (condition: () => boolean): Promise<void> => {
  while (!condition()) {
    await Bun.sleep(20);
  }
};

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('createServerStarter', () => {
  test(
    '出力の末尾50行を保ち、停止すると子孫のプロセスを含めて終了させる',
    async () => {
      const starter = createServerStarter();
      const server = starter.start(
        [
          'sh',
          '-c',
          'sleep 1000 & i=1; while [ $i -le 60 ]; do echo "出力$i"; i=$((i+1)); done; echo "子孫$!"; wait',
        ],
        process.cwd(),
      );
      await waitFor(() =>
        server.outputTail().some((line) => line.startsWith('子孫')),
      );
      const tail = server.outputTail();
      const descendantPid = Number(tail.at(-1)?.replace('子孫', ''));

      await server.stop();

      expect(tail).toEqual([
        ...linesOf(60).slice(11),
        `子孫${String(descendantPid)}`,
      ]);
      expect(await server.exited).toBeNull();
      expect(isAlive(descendantPid)).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    'SIGTERMで終了しないプロセスには、猶予の後にSIGKILLを送る',
    async () => {
      const starter = createServerStarter({ killGraceMs: 300 });
      const server = starter.start(
        [
          'sh',
          '-c',
          'trap "" TERM; echo 準備完了; while true; do sleep 0.1; done',
        ],
        process.cwd(),
      );
      await waitFor(() => server.outputTail().includes('準備完了'));
      const startedAt = performance.now();

      await server.stop();

      expect(performance.now() - startedAt).toBeGreaterThanOrEqual(250);
      expect(await server.exited).toBeNull();
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    '先に終了したプロセスの終了コードと出力を返し、停止しても失敗しない',
    async () => {
      const server = createServerStarter().start(
        ['sh', '-c', 'echo 標準出力; echo 標準エラー >&2; exit 3'],
        process.cwd(),
      );

      expect(await server.exited).toBe(3);
      await server.stop();
      expect([...server.outputTail()].sort()).toEqual(
        ['標準エラー', '標準出力'].sort(),
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    '起動できないコマンドは終了コード無しで終了し、原因を出力に残す',
    async () => {
      const server = createServerStarter().start(
        ['no-such-command-for-dual-mode-e2e'],
        process.cwd(),
      );

      expect(await server.exited).toBeNull();
      expect(server.outputTail().join('\n')).toContain(
        'no-such-command-for-dual-mode-e2e',
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    'stopAllは起動中のすべてのサーバーを止める',
    async () => {
      const starter = createServerStarter();
      const servers = [1, 2].map(() =>
        starter.start(
          ['sh', '-c', 'echo 起動; while true; do sleep 0.1; done'],
          process.cwd(),
        ),
      );
      await waitFor(() =>
        servers.every((server) => server.outputTail().includes('起動')),
      );

      await starter.stopAll();

      expect(await Promise.all(servers.map(({ exited }) => exited))).toEqual([
        null,
        null,
      ]);
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe('createServerStarter(中断の後)', () => {
  test(
    'stopAllの後のstartはプロセスを起動せず、起動しなかった理由を出力に残して終了済みのサーバーを返す',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'dual-mode-closed-'));
      try {
        const starter = createServerStarter();
        await starter.stopAll();

        const server = starter.start(['touch', 'started'], dir);
        await Bun.sleep(200);

        expect(await server.exited).toBeNull();
        expect(server.outputTail()).toEqual([
          '中断したため、サーバーを起動しませんでした',
        ]);
        expect(existsSync(join(dir, 'started'))).toBe(false);
        await server.stop();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT_MS,
  );
});
