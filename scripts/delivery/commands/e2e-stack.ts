import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { messageOf } from '../catalog/error-message.ts';
import type { RunningProcess } from '../adapters/command-runner.ts';
import {
  E2E_STACK_LOG_TAIL_LINES,
  E2E_STACK_MAX_RESTARTS,
  E2E_STACK_WAIT_TIMEOUT_MS,
  type E2eStackService,
  type E2eStackServiceName,
  type StackStartError,
  e2eLogDirOf,
  planE2eStack,
  serviceExitReport,
  stackStartErrorReport,
  waitFailureReason,
} from '../core/e2e-stack-plan.ts';
import {
  type DeliveryCommand,
  type DeliveryDeps,
  EXIT_FAILURE,
  UsageError,
} from './shared/delivery-command.ts';
import { parseOptions } from './shared/parse-options.ts';

const NAME = 'e2e-stack';
const DEFAULT_MAILPIT_BIN = 'mailpit';
const CLI_PATH = 'scripts/delivery/cli.ts';

interface StartedService {
  readonly service: E2eStackService;
  readonly running: RunningProcess;
}

type StartOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: StackStartError };

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value === '' ? undefined : value;

const tailOf = async (running: RunningProcess): Promise<string> => {
  try {
    return await running.tail(E2E_STACK_LOG_TAIL_LINES);
  } catch (error) {
    return `(ログを読めませんでした: ${messageOf(error)})\n`;
  }
};

const startService = (
  service: E2eStackService,
  { runner, repoRoot }: DeliveryDeps,
): RunningProcess | StackStartError => {
  try {
    return runner.start({
      command: service.command,
      args: service.args,
      cwd: join(repoRoot, service.dir),
      output: 'inherit',
      logFile: service.logFile,
    });
  } catch (error) {
    return {
      service: service.name,
      reason: messageOf(error),
      logFile: service.logFile,
      tail: '',
    };
  }
};

const waitForService = async (
  { service, running }: StartedService,
  { probe }: DeliveryDeps,
): Promise<StackStartError | undefined> => {
  const { reached } = await probe.waitFor(service.wait.url, {
    timeoutMs: E2E_STACK_WAIT_TIMEOUT_MS,
    expectStatus: service.wait.expectStatus,
  });
  if (reached) return undefined;
  return {
    service: service.name,
    reason: waitFailureReason(service.wait),
    logFile: service.logFile,
    tail: await tailOf(running),
  };
};

// 待ちの途中で例外が出ても呼び出し側が起動済みのサービスを止められるよう、起動した時点で呼び出し側へ渡してから応答を待つ
const startAndWait = async (
  service: E2eStackService,
  deps: DeliveryDeps,
  onStarted: (started: StartedService) => void,
): Promise<StackStartError | undefined> => {
  const running = startService(service, deps);
  if (!('stop' in running)) return running;
  const current: StartedService = { service, running };
  onStarted(current);
  return waitForService(current, deps);
};

// api・eventはローカル状態の保存先を共有し、同時に起動するとworkerdが保存先のSQLiteを同時に開いて「database is locked」で起動に失敗することがあるため、1つずつ起動して応答を待ってから次を起動する
const startServicesInOrder = async (
  services: readonly E2eStackService[],
  started: StartedService[],
  deps: DeliveryDeps,
): Promise<StartOutcome> => {
  for (const service of services) {
    const error = await startAndWait(service, deps, (current) => {
      started.push(current);
    });
    if (error !== undefined) return { ok: false, error };
  }
  return { ok: true };
};

const reportStartErrors = (
  errors: readonly StackStartError[],
  { stderr }: DeliveryDeps,
): number => {
  stderr.write(
    `${NAME}: 起動しなかったサービスがあります。\n${stackStartErrorReport(errors)}`,
  );
  return EXIT_FAILURE;
};

const stopServices = async (
  started: readonly StartedService[],
  { stderr }: DeliveryDeps,
): Promise<boolean> => {
  const results = await Promise.allSettled(
    started.map(async ({ service, running }) => {
      try {
        await running.stop();
      } catch (error) {
        stderr.write(
          `${NAME}: ${service.name}を止められませんでした: ${messageOf(error)}\n`,
        );
        throw error;
      }
    }),
  );
  return results.every(({ status }) => status === 'fulfilled');
};

interface ServiceSupervisor {
  readonly close: () => Promise<void>;
}

// api・eventは保存先のSQLiteを別々のworkerdで開くため、テストの実行中にも「database is locked」でWranglerが落ちることがある。
// 保存先の状態は残るため、止まったサービスを起動し直して後続のテストを続けられるようにする。起動し直しても止まり続ける時に繰り返さないよう、回数に上限を設ける
const superviseServices = (
  started: StartedService[],
  deps: DeliveryDeps,
): ServiceSupervisor => {
  const { stderr } = deps;
  let closing = false;
  const pending = new Set<Promise<void>>();
  const restartCounts = new Map<E2eStackServiceName, number>();

  const restart = async (
    index: number,
    crashed: StartedService,
    code: number,
  ): Promise<void> => {
    const { service } = crashed;
    stderr.write(
      `${NAME}: ${serviceExitReport({ service: service.name, code, logFile: service.logFile, tail: await tailOf(crashed.running) })}`,
    );
    const count = (restartCounts.get(service.name) ?? 0) + 1;
    if (count > E2E_STACK_MAX_RESTARTS) {
      stderr.write(
        `${NAME}: ${service.name}は起動し直す上限(${String(E2E_STACK_MAX_RESTARTS)}回)に達したため、起動し直しません。\n`,
      );
      return;
    }
    restartCounts.set(service.name, count);
    stderr.write(
      `${NAME}: ${service.name}を起動し直します(${String(count)}/${String(E2E_STACK_MAX_RESTARTS)}回目)。\n`,
    );
    // Wranglerが落ちても孫のworkerdが残り、待ち受けのポートや保存先を掴んだままになり得るため、プロセスグループごと止めてから起動する
    await stopServices([crashed], deps);
    const error = await startAndWait(service, deps, (current) => {
      started[index] = current;
    });
    if (error !== undefined) {
      stderr.write(
        `${NAME}: ${service.name}を起動し直せませんでした。\n${stackStartErrorReport([error])}`,
      );
      return;
    }
    stderr.write(`${NAME}: ${service.name}を起動し直しました。\n`);
    watch(index);
  };

  const track = (task: Promise<void>): void => {
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };

  function watch(index: number): void {
    const current = started[index];
    if (current === undefined) return;
    void current.running.exited.then((code) => {
      if (closing || started[index] !== current) return;
      track(
        restart(index, current, code).catch((error: unknown) => {
          stderr.write(
            `${NAME}: ${current.service.name}を起動し直せませんでした: ${messageOf(error)}\n`,
          );
        }),
      );
    });
  }

  started.forEach((_, index) => {
    watch(index);
  });
  return {
    close: async () => {
      closing = true;
      await Promise.all([...pending]);
    },
  };
};

const runTests = async (
  testCommand: readonly [string, ...string[]],
  started: StartedService[],
  deps: DeliveryDeps,
): Promise<number> => {
  const [command, ...args] = testCommand;
  const supervisor = superviseServices(started, deps);
  try {
    const result = await deps.runner.run({
      command,
      args,
      cwd: deps.repoRoot,
      output: 'inherit',
    });
    return result.code;
  } finally {
    await supervisor.close();
  }
};

const runWhileUp = async (
  services: readonly E2eStackService[],
  started: StartedService[],
  testCommand: readonly [string, ...string[]],
  deps: DeliveryDeps,
): Promise<number> => {
  const outcome = await startServicesInOrder(services, started, deps);
  if (!outcome.ok) return reportStartErrors([outcome.error], deps);
  deps.stdout.write(
    `${NAME}: ${started.map(({ service }) => service.name).join('・')}が起動しました。実行します: ${testCommand.join(' ')}\n`,
  );
  return runTests(testCommand, started, deps);
};

const runStack = async (
  services: readonly E2eStackService[],
  testCommand: readonly [string, ...string[]],
  deps: DeliveryDeps,
): Promise<number> => {
  const started: StartedService[] = [];
  let code: number;
  try {
    code = await runWhileUp(services, started, testCommand, deps);
  } catch (error) {
    await stopServices(started, deps);
    throw error;
  }
  const stopped = await stopServices(started, deps);
  return stopped ? code : EXIT_FAILURE;
};

export const command: DeliveryCommand = {
  name: NAME,
  description:
    'ローカルのマイグレーションを適用し、Mailpit・api・eventを起動して応答を待ってから`--`の後のコマンドを実行し、最後に止める',
  run: async (args, deps) => {
    const { rest } = parseOptions(args, { names: [], rest: 'allowed' });
    const [executable, ...executableArgs] = rest;
    if (executable === undefined) {
      throw new UsageError('`--`の後に実行するコマンドを指定してください');
    }
    const plan = planE2eStack({
      cliPath: join(deps.repoRoot, CLI_PATH),
      mailpitBin: nonEmpty(deps.env.MAILPIT_BIN) ?? DEFAULT_MAILPIT_BIN,
      logDir: e2eLogDirOf(nonEmpty(deps.env.RUNNER_TEMP) ?? tmpdir()),
    });
    const prepare = plan.prepare;
    const prepareLine = [prepare.command, ...prepare.args].join(' ');
    const prepared = await deps.runner.run({
      command: prepare.command,
      args: prepare.args,
      cwd: join(deps.repoRoot, prepare.dir),
      output: 'inherit',
    });
    if (prepared.code !== 0) {
      deps.stderr.write(
        `${NAME}: 準備(${prepare.dir}の${prepareLine})が終了コード${String(prepared.code)}で失敗しました。\n`,
      );
      return EXIT_FAILURE;
    }
    return runStack(plan.services, [executable, ...executableArgs], deps);
  },
};
