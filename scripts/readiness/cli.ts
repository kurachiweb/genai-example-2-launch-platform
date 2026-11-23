import { notImplemented } from './commands/shared/not-implemented.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  EXIT_USAGE,
  type ReadinessCommandModule,
  type ReadinessIo,
  UsageError,
} from './commands/shared/readiness-command.ts';

export interface CommandEntry {
  readonly description: string;
  readonly load: () => Promise<ReadinessCommandModule>;
}

export type CommandTable = Readonly<Record<string, CommandEntry>>;

// 各行の`load`の1行だけを、`() => import('./commands/<名前>.ts')`へ差し替えてサブコマンドを実装する
export const COMMAND_TABLE: CommandTable = {
  'cron-budget': {
    description: '日次バッチの予算と上限を、定期実行の要約のログから判定する',
    load: notImplemented('cron-budget'),
  },
  'graphql-latency': {
    description: 'GraphQLの応答時間を、操作ごとの95パーセンタイルで集計する',
    load: notImplemented('graphql-latency'),
  },
  'availability-probe': {
    description: 'デプロイ中の各アプリの応答を1秒ごとに監視して集計する',
    load: notImplemented('availability-probe'),
  },
  'degraded-env': {
    description: '外部サービスを止めた縮退の起動の差し替えを表示する',
    load: notImplemented('degraded-env'),
  },
};

export interface CliOptions extends ReadinessIo {
  readonly args: readonly string[];
  readonly table?: CommandTable;
}

const ENTRY = 'bun scripts/readiness/cli.ts';
const HELP_FLAGS: ReadonlySet<string> = new Set(['--help', '-h', 'help']);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const padToWidth = (text: string, width: number): string =>
  `${text}${' '.repeat(width - Bun.stringWidth(text))}`;

const usageOf = (table: CommandTable): string => {
  const entries = Object.entries(table);
  const width = Math.max(0, ...entries.map(([name]) => name.length));
  return [
    `使い方: ${ENTRY} <サブコマンド> [引数...]`,
    '',
    'サブコマンド:',
    ...entries.map(
      ([name, { description }]) =>
        `  ${padToWidth(name, width)}  ${description}`,
    ),
    '',
  ].join('\n');
};

const findEntry = (
  table: CommandTable,
  name: string,
): CommandEntry | undefined =>
  Object.hasOwn(table, name) ? table[name] : undefined;

const runEntry = async (
  name: string,
  entry: CommandEntry,
  args: readonly string[],
  io: ReadinessIo,
): Promise<number> => {
  try {
    const { run } = await entry.load();
    return await run(args, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(
        `${name}: ${error.message}\n一覧は ${ENTRY} --help で確かめてください。\n`,
      );
      return EXIT_USAGE;
    }
    io.stderr.write(`${name}: ${messageOf(error)}\n`);
    return EXIT_FAILURE;
  }
};

export async function runCli({
  args,
  table = COMMAND_TABLE,
  stdout,
  stderr,
}: CliOptions): Promise<number> {
  const [name, ...rest] = args;
  if (name === undefined) {
    stderr.write(`サブコマンドを指定してください。\n${usageOf(table)}`);
    return EXIT_USAGE;
  }
  if (HELP_FLAGS.has(name)) {
    stdout.write(usageOf(table));
    return EXIT_SUCCESS;
  }
  const entry = findEntry(table, name);
  if (entry === undefined) {
    stderr.write(`未知のサブコマンドです: ${name}\n${usageOf(table)}`);
    return EXIT_USAGE;
  }
  return runEntry(name, entry, rest, { stdout, stderr });
}

if (import.meta.main) {
  process.exitCode = await runCli({
    args: process.argv.slice(2),
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
