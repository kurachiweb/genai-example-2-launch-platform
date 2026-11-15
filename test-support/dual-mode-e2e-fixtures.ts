import { relative } from 'node:path';

import type { CommandRunner } from '../scripts/tooling/run-all.ts';
import type {
  DualModeDependencies,
  StartedServer,
} from '../scripts/tooling/e2e-dev-and-preview.ts';
import { createOutput } from './run-all-fixtures.ts';

export const FAKE_REPO_ROOT = '/repo';

export type ServerFailure = 'timeout' | 'exit';

export interface FakeDualModeOptions {
  readonly portsInUse?: readonly number[];
  // 「<ディレクトリ> <スクリプト名>」ごとの終了コード(起動できないコマンドは例外)。配列は呼ばれた順に使う
  readonly exitCodes?: Readonly<
    Record<string, number | Error | readonly (number | Error)[]>
  >;
  // 「<ディレクトリ> <スクリプト名>」ごとの、起動しないサーバーの振る舞い
  readonly serverFailures?: Readonly<Record<string, ServerFailure>>;
  readonly outputTail?: readonly string[];
  // この記録が最初に残った時点で中断を知らせる。中断の後の待ち合わせは応答を待ち続け、実行中のコマンドは終了コード130で終わる
  readonly interruptAt?: string;
}

const INTERRUPTED_EXIT_CODE = 130;

const dirOf = (cwd: string): string => relative(FAKE_REPO_ROOT, cwd) || '.';

const scriptKeyOf = (command: readonly string[], cwd: string): string =>
  `${dirOf(cwd)} ${command[2] ?? ''}`;

const untilAborted = (signal: AbortSignal): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    if (signal.aborted) resolve(false);
    signal.addEventListener('abort', () => {
      resolve(false);
    });
  });

// 呼び出しの順を1本の記録に残し、ポートの確認・起動・待ち合わせ・実行・停止の順序をテストで比べる
export const createFakeDualModeDeps = ({
  portsInUse = [],
  exitCodes = {},
  serverFailures = {},
  outputTail = [],
  interruptAt,
}: FakeDualModeOptions = {}) => {
  const events: string[] = [];
  const stdout = createOutput();
  const stderr = createOutput();
  const interruption = new AbortController();
  const record = (event: string): boolean => {
    events.push(event);
    if (event === interruptAt) interruption.abort();
    return interruption.signal.aborted;
  };
  const exitCodeQueues = new Map<string, (number | Error)[]>(
    Object.entries(exitCodes).map(([key, value]) => [
      key,
      typeof value === 'number' || value instanceof Error
        ? [value]
        : [...value],
    ]),
  );
  const failureByURL = new Map<string, ServerFailure>();

  const runner: CommandRunner = {
    run: (command, cwd) => {
      if (record(`run ${dirOf(cwd)}: ${command.join(' ')}`)) {
        return Promise.resolve(INTERRUPTED_EXIT_CODE);
      }
      const queue = exitCodeQueues.get(scriptKeyOf(command, cwd));
      const next = queue && queue.length > 1 ? queue.shift() : queue?.[0];
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next ?? 0);
    },
  };

  const startServer = (
    command: readonly string[],
    cwd: string,
  ): StartedServer => {
    const key = scriptKeyOf(command, cwd);
    record(`start ${dirOf(cwd)}: ${command.join(' ')}`);
    const failure = serverFailures[key];
    const port = command[command.indexOf('--port') + 1] ?? '';
    if (failure === undefined) {
      failureByURL.delete(`http://localhost:${port}`);
    } else {
      failureByURL.set(`http://localhost:${port}`, failure);
    }
    let resolveExited: (code: number | null) => void = () => undefined;
    const exited =
      failure === 'exit'
        ? Promise.resolve<number | null>(1)
        : new Promise<number | null>((resolve) => {
            resolveExited = resolve;
          });
    return {
      exited,
      outputTail: () => outputTail,
      stop: () => {
        events.push(`stop ${key}`);
        resolveExited(null);
        return Promise.resolve();
      },
    };
  };

  const deps: DualModeDependencies = {
    repoRoot: FAKE_REPO_ROOT,
    signal: interruption.signal,
    isPortInUse: (port) => {
      record(`port ${String(port)}`);
      return Promise.resolve(portsInUse.includes(port));
    },
    startServer,
    waitUntilReachable: (baseURL, signal) => {
      if (record(`wait ${baseURL}`)) return untilAborted(signal);
      const failure = failureByURL.get(baseURL);
      if (failure === undefined) return Promise.resolve(true);
      if (failure === 'timeout') return Promise.resolve(false);
      // 先に終了したサーバーの待ち合わせは、打ち切られるまで応答を待ち続ける
      return untilAborted(signal);
    },
    runner,
    stdout,
    stderr,
  };

  return { deps, events, stdout, stderr };
};
