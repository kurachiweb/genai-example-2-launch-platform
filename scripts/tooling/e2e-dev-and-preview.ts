import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';

import { assertE2ETargetReachable } from '../../e2e/support/reachability.ts';
import {
  type E2ETarget,
  type E2ETargetName,
  resolveE2ETargets,
} from '../../e2e/support/targets.ts';
import { type CommandRunner, createSpawnRunner } from './run-all.ts';

export type DualModeStageName = 'dev' | 'preview';

export interface DualModeTarget {
  readonly name: E2ETargetName;
  readonly baseURL: string;
  readonly port: number;
  readonly appDir: string;
}

export interface DualModeTargetStep {
  readonly target: DualModeTarget;
  readonly prepareCommands: readonly (readonly string[])[];
  readonly serverCommand: readonly string[];
}

export interface DualModeStage {
  readonly name: DualModeStageName;
  readonly steps: readonly DualModeTargetStep[];
  readonly testCommand: readonly string[];
}

export interface DualModePlan {
  readonly targets: readonly DualModeTarget[];
  readonly skippedTargets: readonly E2ETargetName[];
  readonly stages: readonly DualModeStage[];
}

export type DualModePlanResult =
  | { readonly ok: true; readonly plan: DualModePlan }
  | { readonly ok: false; readonly errors: readonly string[] };

export interface StartedServer {
  readonly exited: Promise<number | null>;
  readonly outputTail: () => readonly string[];
  readonly stop: () => Promise<void>;
}

interface TextOutput {
  readonly write: (text: string) => unknown;
}

export interface DualModeDependencies {
  readonly repoRoot: string;
  // 中断を知らせる。中断の後は新しく何も起動・実行せず、起動済みの対象を止めて終える
  readonly signal: AbortSignal;
  readonly isPortInUse: (port: number) => Promise<boolean>;
  readonly startServer: (
    command: readonly string[],
    cwd: string,
  ) => StartedServer;
  readonly waitUntilReachable: (
    baseURL: string,
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly runner: CommandRunner;
  readonly stdout: TextOutput;
  readonly stderr: TextOutput;
}

export interface DualModeEntryDependencies extends DualModeDependencies {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly hasApp: (appDir: string) => boolean;
}

type StageOutcome =
  | { readonly status: 'passed' }
  | { readonly status: 'interrupted' }
  | { readonly status: 'failed'; readonly label: string };

const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
]);

const DEFAULT_PORTS: Readonly<Record<string, number>> = {
  'http:': 80,
  'https:': 443,
};

// 開発サーバーは`--host`を付けないとコンテナの外から届かないため、オンボーディングの起動の手順と同じ待ち受けのアドレスにする
const LISTEN_HOST_ARGS = ['--host', '0.0.0.0'] as const;

const TEST_COMMAND = ['bun', 'run', 'test:e2e'] as const;

const INTERRUPTED_LABEL = '中断';

const STAGE_LABELS: Readonly<Record<DualModeStageName, string>> = {
  dev: '開発サーバーでのE2E',
  preview: 'ビルド後のプレビューでのE2E',
};

export const SERVER_START_TIMEOUT_MS = 180_000;
const REACHABILITY_INTERVAL_MS = 500;
const REACHABILITY_ATTEMPT_TIMEOUT_MS = 10_000;
const PORT_CHECK_TIMEOUT_MS = 1_000;
const DEFAULT_KILL_GRACE_MS = 10_000;
const GROUP_POLL_INTERVAL_MS = 100;
const OUTPUT_TAIL_LINES = 50;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const portOf = (url: URL): number =>
  url.port === '' ? (DEFAULT_PORTS[url.protocol] ?? 0) : Number(url.port);

const resolveTarget = (
  { name, baseURL }: E2ETarget,
  appDir: string,
): DualModeTarget | string => {
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    return `E2Eの対象のURLを解釈できません: ${name}(${baseURL})`;
  }
  if (!LOCAL_HOSTNAMES.has(url.hostname)) {
    return `E2Eの対象のURLがローカル(localhost・127.0.0.1)を指していないため、起動できません: ${name}(${baseURL})`;
  }
  return { name, baseURL, port: portOf(url), appDir };
};

const serverCommandOf = (
  script: 'dev' | 'preview',
  { port }: DualModeTarget,
): readonly string[] => [
  'bun',
  'run',
  script,
  '--port',
  String(port),
  ...LISTEN_HOST_ARGS,
];

export function planDualModeE2E(
  targets: readonly E2ETarget[],
  hasApp: (appDir: string) => boolean,
): DualModePlanResult {
  const planned: DualModeTarget[] = [];
  const skippedTargets: E2ETargetName[] = [];
  const errors: string[] = [];
  for (const target of targets) {
    const appDir = `apps/${target.name}`;
    if (!hasApp(appDir)) {
      skippedTargets.push(target.name);
      continue;
    }
    const resolved = resolveTarget(target, appDir);
    if (typeof resolved === 'string') {
      errors.push(resolved);
    } else {
      planned.push(resolved);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    plan: {
      targets: planned,
      skippedTargets,
      stages: [
        {
          name: 'dev',
          steps: planned.map((target) => ({
            target,
            prepareCommands: [],
            serverCommand: serverCommandOf('dev', target),
          })),
          testCommand: TEST_COMMAND,
        },
        {
          name: 'preview',
          steps: planned.map((target) => ({
            target,
            prepareCommands: [['bun', 'run', 'build']],
            serverCommand: serverCommandOf('preview', target),
          })),
          testCommand: TEST_COMMAND,
        },
      ],
    },
  };
}

class StageFailure extends Error {}

class StageInterrupted extends StageFailure {
  constructor() {
    super(INTERRUPTED_LABEL);
  }
}

const throwIfInterrupted = ({ signal }: DualModeDependencies): void => {
  if (signal.aborted) throw new StageInterrupted();
};

const dirLabelOf = (dir: string): string => (dir === '.' ? 'ルート' : dir);

// 中断で止めたコマンドの終了コードは失敗ではなく中断として扱う
const runOrFail = async (
  command: readonly string[],
  dir: string,
  deps: DualModeDependencies,
): Promise<number> => {
  const { runner, repoRoot, stderr } = deps;
  throwIfInterrupted(deps);
  try {
    const exitCode = await runner.run(command, join(repoRoot, dir));
    throwIfInterrupted(deps);
    return exitCode;
  } catch (error) {
    throwIfInterrupted(deps);
    stderr.write(
      `${dirLabelOf(dir)}で\`${command.join(' ')}\`を実行できませんでした: ${messageOf(error)}\n`,
    );
    throw new StageFailure('コマンドを実行できない');
  }
};

const startServerIn = (
  command: readonly string[],
  dir: string,
  deps: DualModeDependencies,
): StartedServer => {
  const { startServer, repoRoot, stdout } = deps;
  throwIfInterrupted(deps);
  stdout.write(`\n▶ ${dir}: ${command.join(' ')}(サーバーを起動)\n`);
  return startServer(command, join(repoRoot, dir));
};

const minutesOf = (ms: number): string => String(ms / 60_000);

// サーバーが先に終了したら待ち合わせを打ち切り、終了しないまま上限が来たら応答しなかったものとして扱う
const awaitServerStart = async (
  { name, baseURL }: DualModeTarget,
  server: StartedServer,
  deps: DualModeDependencies,
): Promise<void> => {
  const { waitUntilReachable, stderr, signal } = deps;
  const controller = new AbortController();
  const onInterrupt = () => {
    controller.abort();
  };
  signal.addEventListener('abort', onInterrupt);
  const result = await Promise.race([
    waitUntilReachable(baseURL, controller.signal).then((reachable) =>
      reachable ? 'reachable' : ('timeout' as const),
    ),
    server.exited.then((code) => ({ exitCode: code })),
  ]).finally(() => {
    signal.removeEventListener('abort', onInterrupt);
    controller.abort();
  });
  throwIfInterrupted(deps);
  if (result === 'reachable') return;
  const reason =
    result === 'timeout'
      ? `${minutesOf(SERVER_START_TIMEOUT_MS)}分以内に応答しなかった`
      : `応答する前に終了した。終了コード${result.exitCode === null ? 'なし' : String(result.exitCode)}`;
  const tail = server.outputTail();
  stderr.write(
    `${name}が起動しませんでした(${reason})。出力の末尾:\n${tail.length === 0 ? '(出力なし)' : tail.join('\n')}\n`,
  );
  throw new StageFailure(`${name}が起動しない`);
};

const startStageServers = async (
  stage: DualModeStage,
  servers: StartedServer[],
  deps: DualModeDependencies,
): Promise<void> => {
  for (const { target, prepareCommands, serverCommand } of stage.steps) {
    for (const command of prepareCommands) {
      const exitCode = await runOrFail(command, target.appDir, deps);
      if (exitCode !== 0) {
        throw new StageFailure(
          `${target.name}のビルドの終了コード${String(exitCode)}`,
        );
      }
    }
    const server = startServerIn(serverCommand, target.appDir, deps);
    servers.push(server);
    await awaitServerStart(target, server, deps);
  }
};

const runStage = async (
  stage: DualModeStage,
  deps: DualModeDependencies,
): Promise<StageOutcome> => {
  deps.stdout.write(`\n■ ${STAGE_LABELS[stage.name]}\n`);
  const servers: StartedServer[] = [];
  try {
    await startStageServers(stage, servers, deps);
    const exitCode = await runOrFail(stage.testCommand, '.', deps);
    return exitCode === 0
      ? { status: 'passed' }
      : {
          status: 'failed',
          label: `E2Eテストの終了コード${String(exitCode)}`,
        };
  } catch (error) {
    if (error instanceof StageInterrupted) {
      return { status: 'interrupted' };
    }
    if (error instanceof StageFailure) {
      return { status: 'failed', label: error.message };
    }
    throw error;
  } finally {
    // 次の段階が同じポートで起動するため、すべての対象が止まるまで待つ
    await Promise.all(servers.map((server) => server.stop()));
  }
};

const padToWidth = (text: string, width: number): string =>
  `${text}${' '.repeat(width - Bun.stringWidth(text))}`;

const outcomeLabelOf = (outcome: StageOutcome): string => {
  switch (outcome.status) {
    case 'passed':
      return '成功';
    case 'interrupted':
      return INTERRUPTED_LABEL;
    case 'failed':
      return `失敗(${outcome.label})`;
  }
};

const formatStageSummary = (
  results: readonly (readonly [DualModeStageName, StageOutcome])[],
): string => {
  const rows: readonly (readonly [string, string])[] = [
    ['段階', '結果'],
    ...results.map(
      ([name, outcome]) =>
        [STAGE_LABELS[name], outcomeLabelOf(outcome)] as const,
    ),
  ];
  const width = Math.max(...rows.map(([label]) => Bun.stringWidth(label)));
  return rows
    .map(([label, result]) => `${padToWidth(label, width)}  ${result}\n`)
    .join('');
};

// 古いサーバーへE2Eを実行したり、Viteが空いている別のポートで起動したりしないよう、何かを起動する前に確かめる
const findPortsInUse = async (
  targets: readonly DualModeTarget[],
  { isPortInUse }: DualModeDependencies,
): Promise<readonly DualModeTarget[]> => {
  const inUse: DualModeTarget[] = [];
  for (const target of targets) {
    if (await isPortInUse(target.port)) inUse.push(target);
  }
  return inUse;
};

export async function runDualModeE2E(
  plan: DualModePlan,
  deps: DualModeDependencies,
): Promise<number> {
  for (const name of plan.skippedTargets) {
    deps.stdout.write(
      `apps/${name}にアプリ(package.json)が無いため、${name}を飛ばします\n`,
    );
  }
  const portsInUse = await findPortsInUse(plan.targets, deps);
  if (portsInUse.length > 0) {
    deps.stderr.write(
      `ポートが使われています。古いサーバーを止めてから実行してください: ${portsInUse.map(({ port, name }) => `${String(port)}(${name})`).join('・')}\n`,
    );
    return 1;
  }
  const results: (readonly [DualModeStageName, StageOutcome])[] = [];
  for (const stage of plan.stages) {
    if (deps.signal.aborted) {
      deps.stdout.write('\n中断したため、残りの段階を実行しませんでした\n');
      break;
    }
    results.push([stage.name, await runStage(stage, deps)]);
  }
  deps.stdout.write(`\n${formatStageSummary(results)}`);
  return results.every(([, outcome]) => outcome.status === 'passed') ? 0 : 1;
}

export async function runDualModeE2EEntry({
  env,
  hasApp,
  ...deps
}: DualModeEntryDependencies): Promise<number> {
  const result = planDualModeE2E(resolveE2ETargets(env), hasApp);
  if (!result.ok) {
    deps.stderr.write(result.errors.map((error) => `${error}\n`).join(''));
    return 1;
  }
  return runDualModeE2E(result.plan, deps);
}

const canConnect = (host: string, port: number): Promise<boolean> =>
  new Promise((resolveConnected) => {
    const socket = createConnection({ host, port });
    const finish = (connected: boolean) => {
      socket.destroy();
      resolveConnected(connected);
    };
    socket.setTimeout(PORT_CHECK_TIMEOUT_MS, () => {
      finish(false);
    });
    socket.once('connect', () => {
      finish(true);
    });
    socket.once('error', () => {
      finish(false);
    });
  });

// `localhost`はIPv4とIPv6のどちらにも解決され得るため、両方のループバックアドレスで確かめる
export async function isLoopbackPortInUse(port: number): Promise<boolean> {
  const results = await Promise.all([
    canConnect('127.0.0.1', port),
    canConnect('::1', port),
  ]);
  return results.includes(true);
}

export interface WaitOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

// 到達の判定はE2Eの到達確認と同じにし、待ち合わせを通った対象がE2Eの到達確認で落ちないようにする
export async function waitUntilReachable(
  baseURL: string,
  signal: AbortSignal,
  {
    timeoutMs = SERVER_START_TIMEOUT_MS,
    intervalMs = REACHABILITY_INTERVAL_MS,
  }: WaitOptions = {},
): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (!signal.aborted) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return false;
    try {
      await assertE2ETargetReachable(baseURL, {
        timeoutMs: Math.min(REACHABILITY_ATTEMPT_TIMEOUT_MS, remaining),
      });
      return true;
    } catch {
      await Bun.sleep(Math.min(intervalMs, remaining));
    }
  }
  return false;
}

export interface ServerStarterOptions {
  readonly killGraceMs?: number;
}

export interface ServerStarter {
  readonly start: (command: readonly string[], cwd: string) => StartedServer;
  readonly stopAll: () => Promise<void>;
}

const collectTail = (child: ChildProcess, tail: string[]): void => {
  for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream?.setEncoding('utf8');
    stream?.on('data', (chunk: string) => {
      const lines = `${pending}${chunk}`.split('\n');
      pending = lines.pop() ?? '';
      tail.push(...lines);
      tail.splice(0, Math.max(0, tail.length - OUTPUT_TAIL_LINES));
    });
    stream?.on('end', () => {
      if (pending !== '') tail.push(pending);
      tail.splice(0, Math.max(0, tail.length - OUTPUT_TAIL_LINES));
    });
  }
};

const isGroupAlive = (pgid: number): boolean => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
};

const signalGroup = (pgid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-pgid, signal);
  } catch {
    // 既にすべてのプロセスが終了している
  }
};

const waitForGroupExit = async (
  pgid: number,
  timeoutMs: number,
): Promise<boolean> => {
  const deadline = performance.now() + timeoutMs;
  while (isGroupAlive(pgid)) {
    if (performance.now() >= deadline) return false;
    await Bun.sleep(GROUP_POLL_INTERVAL_MS);
  }
  return true;
};

const NOT_STARTED_SERVER: StartedServer = {
  exited: Promise.resolve(null),
  outputTail: () => ['中断したため、サーバーを起動しませんでした'],
  stop: () => Promise.resolve(),
};

// `bun run`の下でViteやworkerdが孫のプロセスとして動くため、新しいプロセスグループで起動し、止める時はグループ全体へシグナルを送る
export function createServerStarter({
  killGraceMs = DEFAULT_KILL_GRACE_MS,
}: ServerStarterOptions = {}): ServerStarter {
  const running = new Set<StartedServer>();
  let closed = false;

  const start = (command: readonly string[], cwd: string): StartedServer => {
    if (closed) return NOT_STARTED_SERVER;
    const [file = '', ...args] = command;
    const tail: string[] = [];
    const child = spawn(file, args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    collectTail(child, tail);
    const exited = new Promise<number | null>((resolveExited) => {
      child.once('error', (error) => {
        tail.push(messageOf(error));
        resolveExited(null);
      });
      child.once('exit', (code) => {
        resolveExited(code);
      });
    });
    const stop = async (): Promise<void> => {
      const { pid } = child;
      if (pid !== undefined) {
        signalGroup(pid, 'SIGTERM');
        if (!(await waitForGroupExit(pid, killGraceMs))) {
          signalGroup(pid, 'SIGKILL');
        }
      }
      await exited;
      running.delete(server);
    };
    const server: StartedServer = {
      exited,
      outputTail: () => [...tail],
      stop,
    };
    running.add(server);
    return server;
  };

  return {
    start,
    stopAll: async () => {
      closed = true;
      await Promise.all([...running].map((server) => server.stop()));
    },
  };
}

const INTERRUPT_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

export type InterruptSignal = (typeof INTERRUPT_SIGNALS)[number];

const INTERRUPTED_EXIT_CODES: Readonly<Record<InterruptSignal, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
};

export const interruptedExitCodeOf = (signal: InterruptSignal): number =>
  INTERRUPTED_EXIT_CODES[signal];

interface SignalSource {
  readonly on: (signal: InterruptSignal, listener: () => void) => unknown;
}

// 受け取り続けることで、停止中の2回目の中断が既定の動作で即時に終了し、別のプロセスグループのサーバーを残すのを防ぐ
export function handleInterruptSignals(
  source: SignalSource,
  onInterrupt: (signal: InterruptSignal) => void,
): () => InterruptSignal | undefined {
  let interruptedBy: InterruptSignal | undefined;
  for (const signal of INTERRUPT_SIGNALS) {
    source.on(signal, () => {
      if (interruptedBy !== undefined) return;
      interruptedBy = signal;
      onInterrupt(signal);
    });
  }
  return () => interruptedBy;
}

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dirname, '..', '..');
  const starter = createServerStarter();
  const interruption = new AbortController();
  // 起動したサーバーは別のプロセスグループのため端末の中断が届かない。先に中断を知らせて新しい起動と実行を止めてから、サーバーを止める
  const interruptedBy = handleInterruptSignals(process, () => {
    interruption.abort();
    void starter.stopAll();
  });
  const exitCode = await runDualModeE2EEntry({
    env: process.env,
    hasApp: (appDir) => existsSync(join(repoRoot, appDir, 'package.json')),
    repoRoot,
    signal: interruption.signal,
    isPortInUse: isLoopbackPortInUse,
    startServer: starter.start,
    waitUntilReachable: (baseURL, signal) =>
      waitUntilReachable(baseURL, signal),
    runner: createSpawnRunner(repoRoot, process.stdout, {
      signal: interruption.signal,
    }),
    stdout: process.stdout,
    stderr: process.stderr,
  });
  await starter.stopAll();
  const signal = interruptedBy();
  process.exitCode =
    signal === undefined ? exitCode : interruptedExitCodeOf(signal);
}
