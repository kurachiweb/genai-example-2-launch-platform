import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { TEST_LIKE_FILE_PATTERN } from '../../config/test-patterns.ts';
import { createDefaultDeps } from './commands/shared/default-deps.ts';
import {
  type DeliveryCommand,
  type DeliveryDeps,
  EXIT_FAILURE,
  EXIT_SUCCESS,
  EXIT_USAGE,
  type TextOutput,
  UsageError,
} from './commands/shared/delivery-command.ts';

export interface CliOptions {
  readonly args: readonly string[];
  readonly commandsDir: string;
  readonly createDeps: () => DeliveryDeps;
  readonly stdout: TextOutput;
  readonly stderr: TextOutput;
}

const ENTRY = 'bun scripts/delivery/cli.ts';
const HELP_FLAGS: ReadonlySet<string> = new Set(['--help', '-h', 'help']);
const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const COMMAND_FILE_SUFFIX = '.ts';

class CommandDefinitionError extends Error {
  override readonly name = 'CommandDefinitionError';
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isDeliveryCommand = (value: unknown): value is DeliveryCommand =>
  typeof value === 'object' &&
  value !== null &&
  'name' in value &&
  typeof value.name === 'string' &&
  'description' in value &&
  typeof value.description === 'string' &&
  value.description !== '' &&
  'run' in value &&
  typeof value.run === 'function';

const commandFileOf = (name: string): string => `${name}${COMMAND_FILE_SUFFIX}`;

const loadCommand = async (
  commandsDir: string,
  name: string,
): Promise<DeliveryCommand> => {
  const file = commandFileOf(name);
  const loaded: unknown = await import(join(commandsDir, file));
  const command =
    typeof loaded === 'object' && loaded !== null && 'command' in loaded
      ? loaded.command
      : undefined;
  if (!isDeliveryCommand(command)) {
    throw new CommandDefinitionError(
      `${file}が、名前・説明・実行を持つcommandを公開していません。`,
    );
  }
  if (command.name !== name) {
    throw new CommandDefinitionError(
      `${file}のcommandの名前(${command.name})がファイル名と一致しません。`,
    );
  }
  return command;
};

// サブコマンドはコマンドのディレクトリの直下のファイル名から解決し、入口を編集せずにコマンドを追加できるようにする。テストファイルとサブディレクトリの共通部品はサブコマンドにしない
const commandNamesIn = (commandsDir: string): readonly string[] =>
  readdirSync(commandsDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(COMMAND_FILE_SUFFIX) &&
        !TEST_LIKE_FILE_PATTERN.test(entry.name),
    )
    .map((entry) => entry.name.slice(0, -COMMAND_FILE_SUFFIX.length))
    .filter((name) => COMMAND_NAME_PATTERN.test(name))
    .toSorted();

export async function loadCommands(
  commandsDir: string,
): Promise<readonly DeliveryCommand[]> {
  return Promise.all(
    commandNamesIn(commandsDir).map((name) => loadCommand(commandsDir, name)),
  );
}

const padToWidth = (text: string, width: number): string =>
  `${text}${' '.repeat(width - Bun.stringWidth(text))}`;

const usageOf = (commands: readonly DeliveryCommand[]): string => {
  const width = Math.max(0, ...commands.map(({ name }) => name.length));
  const lines =
    commands.length === 0
      ? ['  (なし)']
      : commands.map(
          ({ name, description }) =>
            `  ${padToWidth(name, width)}  ${description}`,
        );
  return [
    `使い方: ${ENTRY} <サブコマンド> [引数...]`,
    '',
    'サブコマンド:',
    ...lines,
    '',
  ].join('\n');
};

const isKnownCommand = (commandsDir: string, name: string): boolean =>
  COMMAND_NAME_PATTERN.test(name) &&
  existsSync(join(commandsDir, commandFileOf(name)));

const runCommand = async (
  command: DeliveryCommand,
  args: readonly string[],
  { createDeps, stderr }: CliOptions,
): Promise<number> => {
  try {
    return await command.run(args, createDeps());
  } catch (error) {
    if (error instanceof UsageError) {
      stderr.write(
        `${command.name}: ${error.message}\n一覧は ${ENTRY} --help で確かめてください。\n`,
      );
      return EXIT_USAGE;
    }
    stderr.write(`${command.name}: ${messageOf(error)}\n`);
    return EXIT_FAILURE;
  }
};

const dispatch = async (options: CliOptions): Promise<number> => {
  const { args, commandsDir, stdout, stderr } = options;
  const [name, ...rest] = args;
  if (name === undefined) {
    stderr.write(
      `サブコマンドを指定してください。\n${usageOf(await loadCommands(commandsDir))}`,
    );
    return EXIT_USAGE;
  }
  if (HELP_FLAGS.has(name)) {
    stdout.write(usageOf(await loadCommands(commandsDir)));
    return EXIT_SUCCESS;
  }
  if (!isKnownCommand(commandsDir, name)) {
    stderr.write(
      `未知のサブコマンドです: ${name}\n${usageOf(await loadCommands(commandsDir))}`,
    );
    return EXIT_USAGE;
  }
  return runCommand(await loadCommand(commandsDir, name), rest, options);
};

export async function runCli(options: CliOptions): Promise<number> {
  try {
    return await dispatch(options);
  } catch (error) {
    if (!(error instanceof CommandDefinitionError)) throw error;
    options.stderr.write(`${error.message}\n`);
    return EXIT_FAILURE;
  }
}

if (import.meta.main) {
  // どのディレクトリで実行しても同じリポジトリを対象にするため、カレントディレクトリではなくこのスクリプトの位置からルートを決める
  const repoRoot = resolve(import.meta.dirname, '..', '..');
  process.exitCode = await runCli({
    args: process.argv.slice(2),
    commandsDir: join(import.meta.dirname, 'commands'),
    createDeps: () =>
      createDefaultDeps({
        repoRoot,
        env: process.env,
        stdout: process.stdout,
        stderr: process.stderr,
      }),
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
