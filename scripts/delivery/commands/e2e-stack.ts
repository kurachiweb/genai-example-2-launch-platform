import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { messageOf } from '../catalog/error-message.ts';
import type { RunningProcess } from '../adapters/command-runner.ts';
import {
  E2E_STACK_LOG_TAIL_LINES,
  E2E_STACK_WAIT_TIMEOUT_MS,
  type E2eStackService,
  type StackStartError,
  e2eLogDirOf,
  planE2eStack,
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
  | { readonly ok: true; readonly started: readonly StartedService[] }
  | {
      readonly ok: false;
      readonly started: readonly StartedService[];
      readonly error: StackStartError;
    };

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value === '' ? undefined : value;

const startServices = (
  services: readonly E2eStackService[],
  { runner, repoRoot }: DeliveryDeps,
): StartOutcome => {
  const started: StartedService[] = [];
  for (const service of services) {
    try {
      const running = runner.start({
        command: service.command,
        args: service.args,
        cwd: join(repoRoot, service.dir),
        output: 'inherit',
        logFile: service.logFile,
      });
      started.push({ service, running });
    } catch (error) {
      return {
        ok: false,
        started,
        error: {
          service: service.name,
          reason: messageOf(error),
          logFile: service.logFile,
          tail: '',
        },
      };
    }
  }
  return { ok: true, started };
};

const tailOf = async (running: RunningProcess): Promise<string> => {
  try {
    return await running.tail(E2E_STACK_LOG_TAIL_LINES);
  } catch (error) {
    return `(ログを読めませんでした: ${messageOf(error)})\n`;
  }
};

const waitForServices = async (
  started: readonly StartedService[],
  { probe }: DeliveryDeps,
): Promise<readonly StackStartError[]> => {
  const results = await Promise.all(
    started.map(async ({ service, running }) => {
      const { reached } = await probe.waitFor(service.wait.url, {
        timeoutMs: E2E_STACK_WAIT_TIMEOUT_MS,
        expectStatus: service.wait.expectStatus,
      });
      if (reached) return undefined;
      const error: StackStartError = {
        service: service.name,
        reason: waitFailureReason(service.wait),
        logFile: service.logFile,
        tail: await tailOf(running),
      };
      return error;
    }),
  );
  return results.filter((error) => error !== undefined);
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

const runWhileUp = async (
  outcome: StartOutcome,
  testCommand: readonly [string, ...string[]],
  deps: DeliveryDeps,
): Promise<number> => {
  if (!outcome.ok) return reportStartErrors([outcome.error], deps);
  const errors = await waitForServices(outcome.started, deps);
  if (errors.length > 0) return reportStartErrors(errors, deps);
  const [command, ...args] = testCommand;
  deps.stdout.write(
    `${NAME}: ${outcome.started.map(({ service }) => service.name).join('・')}が起動しました。実行します: ${testCommand.join(' ')}\n`,
  );
  const result = await deps.runner.run({
    command,
    args,
    cwd: deps.repoRoot,
    output: 'inherit',
  });
  return result.code;
};

const runStack = async (
  services: readonly E2eStackService[],
  testCommand: readonly [string, ...string[]],
  deps: DeliveryDeps,
): Promise<number> => {
  const outcome = startServices(services, deps);
  let code: number;
  try {
    code = await runWhileUp(outcome, testCommand, deps);
  } catch (error) {
    await stopServices(outcome.started, deps);
    throw error;
  }
  const stopped = await stopServices(outcome.started, deps);
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
