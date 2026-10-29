import { spawn } from 'node:child_process';
import { join } from 'node:path';

export interface CodegenProcessResult {
  readonly exitCode: number;
  readonly output: string;
}

export interface CheckReport {
  readonly exitCode: 0 | 1;
  readonly stdout: string;
  readonly stderr: string;
}

interface TextSink {
  readonly write: (text: string) => unknown;
}

export interface CommandOutput {
  readonly stdout: TextSink;
  readonly stderr: TextSink;
}

export type CodegenProcessRunner = (
  command: string,
  args: readonly string[],
  cwd: string,
) => Promise<CodegenProcessResult>;

const CODEGEN_CHECK_ARGS = ['--config', 'codegen.config.ts', '--check'];

const GENERATE_COMMAND = 'bun run graphql:generate';

const UP_TO_DATE_MESSAGE =
  'GraphQLの生成物は操作の定義とスキーマから生成した内容と一致しています。';

// graphql-codegenの--checkは生成物の食い違いと操作の検証の失敗をどちらも0以外で終えるため、区別せず同じ案内を出す
const REGENERATE_LINES = [
  '生成物が操作の定義またはスキーマと食い違っています。',
  '次の生成コマンドを再実行し、生成物を更新してください。',
  `  ${GENERATE_COMMAND}`,
];

const SIGNAL_EXIT_CODE = 1;

function linesOf(lines: readonly string[]): string {
  return lines.map((line) => `${line}\n`).join('');
}

function withTrailingNewline(output: string): string {
  return output === '' || output.endsWith('\n') ? output : `${output}\n`;
}

export function reportCodegenCheck(result: CodegenProcessResult): CheckReport {
  if (result.exitCode === 0) {
    return { exitCode: 0, stdout: linesOf([UP_TO_DATE_MESSAGE]), stderr: '' };
  }
  return {
    exitCode: 1,
    stdout: '',
    stderr: `${withTrailingNewline(result.output)}${linesOf(REGENERATE_LINES)}`,
  };
}

export const runCodegenProcess: CodegenProcessRunner = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        exitCode: code ?? SIGNAL_EXIT_CODE,
        output: Buffer.concat(chunks).toString('utf8'),
      });
    });
  });

export async function checkGeneratedCode(
  appDir: string,
  run: CodegenProcessRunner = runCodegenProcess,
): Promise<CheckReport> {
  return reportCodegenCheck(
    await run(
      join(appDir, 'node_modules', '.bin', 'graphql-codegen'),
      CODEGEN_CHECK_ARGS,
      appDir,
    ),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runCodegenCheckCommand(
  appDir: string,
  output: CommandOutput,
  run: CodegenProcessRunner = runCodegenProcess,
): Promise<number> {
  try {
    const report = await checkGeneratedCode(appDir, run);
    output.stdout.write(report.stdout);
    output.stderr.write(report.stderr);
    return report.exitCode;
  } catch (error) {
    output.stderr.write(
      `GraphQLの生成物の検査を完了できませんでした: ${errorMessage(error)}\n`,
    );
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await runCodegenCheckCommand(process.cwd(), process));
}
