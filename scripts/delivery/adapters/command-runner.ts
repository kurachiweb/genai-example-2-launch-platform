import { closeSync, openSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

export interface TextOutput {
  readonly write: (text: string) => unknown;
}

export type CommandOutput = 'capture' | 'inherit' | 'filtered';

export interface CommandSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: string;
  readonly output: CommandOutput;
  readonly filter?: (line: string) => string | undefined;
}

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunningProcess {
  readonly name: string;
  stop(): Promise<void>;
  tail(lines: number): Promise<string>;
}

export interface CommandRunner {
  run(spec: CommandSpec): Promise<CommandResult>;
  start(spec: CommandSpec & { readonly logFile: string }): RunningProcess;
}

export interface CommandRunnerOptions {
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
  readonly stdout: TextOutput;
  readonly stderr: TextOutput;
  readonly stopGraceMs?: number;
}

const DEFAULT_STOP_GRACE_MS = 10_000;

type SpawnOptions = NonNullable<Parameters<typeof Bun.spawn>[1]>;

const definedEntriesOf = (
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const spawnOrThrow = (
  { command, args }: CommandSpec,
  options: SpawnOptions,
): Bun.Subprocess => {
  try {
    return Bun.spawn([command, ...args], options);
  } catch (error) {
    throw new Error(`${command}を起動できませんでした: ${messageOf(error)}`, {
      cause: error,
    });
  }
};

const stdinOf = (
  { stdin }: CommandSpec,
  fallback: 'inherit' | 'ignore',
): Blob | 'inherit' | 'ignore' =>
  stdin === undefined ? fallback : new Blob([stdin]);

// 行の途中で分かれて届いた出力も、改行までをまとめて1行としてフィルタに渡す
const readStream = async (
  stream: ReadableStream<Uint8Array>,
  onLine: ((line: string) => void) | undefined,
): Promise<string> => {
  const decoder = new TextDecoder();
  let all = '';
  let pending = '';
  const consume = (text: string) => {
    all += text;
    if (onLine === undefined) return;
    const lines = `${pending}${text}`.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) onLine(line.replace(/\r$/, ''));
  };
  for await (const chunk of stream) {
    consume(decoder.decode(chunk, { stream: true }));
  }
  consume(decoder.decode());
  if (onLine !== undefined && pending !== '')
    onLine(pending.replace(/\r$/, ''));
  return all;
};

const lineWriterOf = (
  filter: CommandSpec['filter'],
  output: TextOutput,
): ((line: string) => void) => {
  return (line) => {
    const shown = filter?.(line);
    if (shown !== undefined) output.write(`${shown}\n`);
  };
};

const lastLinesOf = (text: string, count: number): string => {
  const lines = text.split('\n');
  const hasTrailingNewline = lines.at(-1) === '';
  const body = hasTrailingNewline ? lines.slice(0, -1) : lines;
  const kept = body.slice(-count).join('\n');
  return kept === '' || !hasTrailingNewline ? kept : `${kept}\n`;
};

export function createCommandRunner({
  baseEnv,
  stdout,
  stderr,
  stopGraceMs = DEFAULT_STOP_GRACE_MS,
}: CommandRunnerOptions): CommandRunner {
  const envOf = (spec: CommandSpec): Record<string, string> => ({
    ...definedEntriesOf(baseEnv),
    ...spec.env,
  });

  const runInherited = async (spec: CommandSpec): Promise<CommandResult> => {
    const child = spawnOrThrow(spec, {
      cwd: spec.cwd,
      env: envOf(spec),
      stdio: [stdinOf(spec, 'inherit'), 'inherit', 'inherit'],
    });
    return { code: await child.exited, stdout: '', stderr: '' };
  };

  const runPiped = async (spec: CommandSpec): Promise<CommandResult> => {
    const child = spawnOrThrow(spec, {
      cwd: spec.cwd,
      env: envOf(spec),
      stdin: stdinOf(spec, 'ignore'),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const filtered = spec.output === 'filtered';
    const [childStdout, childStderr, code] = await Promise.all([
      readStream(
        child.stdout as ReadableStream<Uint8Array>,
        filtered ? lineWriterOf(spec.filter, stdout) : undefined,
      ),
      readStream(
        child.stderr as ReadableStream<Uint8Array>,
        filtered ? lineWriterOf(spec.filter, stderr) : undefined,
      ),
      child.exited,
    ]);
    return { code, stdout: childStdout, stderr: childStderr };
  };

  const stopChild = async (child: Bun.Subprocess): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => {
      child.kill('SIGKILL');
    }, stopGraceMs);
    try {
      await child.exited;
    } finally {
      clearTimeout(killTimer);
    }
  };

  return {
    run: (spec) =>
      spec.output === 'inherit' ? runInherited(spec) : runPiped(spec),
    start: (spec) => {
      // 標準出力と標準エラー出力を出た順のまま1つのログに残すため、同じファイル記述子を両方に渡す
      const logFd = openSync(spec.logFile, 'a');
      try {
        const child = spawnOrThrow(spec, {
          cwd: spec.cwd,
          env: envOf(spec),
          stdio: [stdinOf(spec, 'ignore'), logFd, logFd],
        });
        return {
          name: [spec.command, ...spec.args].join(' '),
          stop: () => stopChild(child),
          tail: async (lines) =>
            lastLinesOf(await readFile(spec.logFile, 'utf8'), lines),
        };
      } finally {
        closeSync(logFd);
      }
    },
  };
}
