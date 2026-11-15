import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type CodegenProcessResult,
  checkGeneratedCode,
  reportCodegenCheck,
  runCodegenCheckCommand,
  runCodegenProcess,
} from './codegen-check.ts';

const UP_TO_DATE_MESSAGE =
  'GraphQLの生成物は操作の定義とスキーマから生成した内容と一致しています。';

const REGENERATE_GUIDANCE = [
  '生成物が操作の定義またはスキーマと食い違っています。',
  '次の生成コマンドを再実行し、生成物を更新してください。',
  '  bun run graphql:generate',
  '',
].join('\n');

const CODEGEN_OUTPUT = [
  'The following stale files were detected:',
  '  - src/graphql/generated/graphql.ts',
  '',
].join('\n');

describe('reportCodegenCheck', () => {
  test('graphql-codegenの検査が終了コード0なら、一致を標準出力に示して終了コード0にし、検査の経過は表示しない', () => {
    expect(reportCodegenCheck({ exitCode: 0, output: CODEGEN_OUTPUT })).toEqual(
      {
        exitCode: 0,
        stdout: `${UP_TO_DATE_MESSAGE}\n`,
        stderr: '',
      },
    );
  });

  test.each([1, 2, 127])(
    'graphql-codegenの検査が終了コード%iなら、検査の出力に続けて生成コマンドの再実行の案内を標準エラーに示して終了コード1にする',
    (exitCode) => {
      expect(reportCodegenCheck({ exitCode, output: CODEGEN_OUTPUT })).toEqual({
        exitCode: 1,
        stdout: '',
        stderr: `${CODEGEN_OUTPUT}${REGENERATE_GUIDANCE}`,
      });
    },
  );

  test('検査の出力が改行で終わらなくても、案内を新しい行から始める', () => {
    expect(
      reportCodegenCheck({ exitCode: 1, output: 'Validation failed' }).stderr,
    ).toBe(`Validation failed\n${REGENERATE_GUIDANCE}`);
  });

  test('検査の出力が無ければ、案内だけを示す', () => {
    expect(reportCodegenCheck({ exitCode: 1, output: '' }).stderr).toBe(
      REGENERATE_GUIDANCE,
    );
  });
});

describe('checkGeneratedCode', () => {
  test('作業ディレクトリのgraphql-codegenを、設定ファイルと検査の指定を付けて作業ディレクトリで起動する', async () => {
    const calls: { command: string; args: readonly string[]; cwd: string }[] =
      [];

    const report = await checkGeneratedCode(
      '/apps/sample',
      (command, args, cwd): Promise<CodegenProcessResult> => {
        calls.push({ command, args, cwd });
        return Promise.resolve({ exitCode: 1, output: CODEGEN_OUTPUT });
      },
    );

    expect(calls).toEqual([
      {
        command: '/apps/sample/node_modules/.bin/graphql-codegen',
        args: ['--config', 'codegen.config.ts', '--check'],
        cwd: '/apps/sample',
      },
    ]);
    expect(report).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: `${CODEGEN_OUTPUT}${REGENERATE_GUIDANCE}`,
    });
  });
});

describe('runCodegenProcess', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'codegen-check-test-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  const writeFakeCodegen = async (script: string): Promise<string> => {
    const binDir = join(workDir, 'node_modules', '.bin');
    await mkdir(binDir, { recursive: true });
    const path = join(binDir, 'graphql-codegen');
    await writeFile(path, `#!/bin/sh\n${script}\n`);
    await chmod(path, 0o755);
    return path;
  };

  test('偽の子プロセスの終了コードと、引数と作業ディレクトリを受けた標準出力を返す', async () => {
    const command = await writeFakeCodegen(
      ['echo "args: $*"', 'echo "cwd: $(pwd)"', 'exit 3'].join('\n'),
    );

    const result = await runCodegenProcess(
      command,
      ['--config', 'codegen.config.ts'],
      workDir,
    );

    expect(result).toEqual({
      exitCode: 3,
      output: `args: --config codegen.config.ts\ncwd: ${workDir}\n`,
    });
  });

  test('偽の子プロセスの標準エラー出力も出力に含める', async () => {
    const command = await writeFakeCodegen(
      ['echo "stale" >&2', 'exit 1'].join('\n'),
    );

    expect(await runCodegenProcess(command, [], workDir)).toEqual({
      exitCode: 1,
      output: 'stale\n',
    });
  });

  test('偽の子プロセスが終了コード0で終われば0を返す', async () => {
    const command = await writeFakeCodegen('exit 0');

    expect(await runCodegenProcess(command, [], workDir)).toEqual({
      exitCode: 0,
      output: '',
    });
  });

  test('graphql-codegenが無ければ、起動の失敗を例外にする', async () => {
    const failure: unknown = await runCodegenProcess(
      join(workDir, 'node_modules', '.bin', 'graphql-codegen'),
      [],
      workDir,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({ code: 'ENOENT' });
  });
});

describe('runCodegenCheckCommand', () => {
  const createOutput = (): {
    readonly stdout: { write: (text: string) => void };
    readonly stderr: { write: (text: string) => void };
    readonly written: () => { stdout: string; stderr: string };
  } => {
    const texts = { stdout: '', stderr: '' };
    return {
      stdout: {
        write: (text) => {
          texts.stdout += text;
        },
      },
      stderr: {
        write: (text) => {
          texts.stderr += text;
        },
      },
      written: () => ({ ...texts }),
    };
  };

  test('検査の結果を標準出力と標準エラー出力へ書き、終了コードを返す', async () => {
    const output = createOutput();

    const exitCode = await runCodegenCheckCommand('/apps/sample', output, () =>
      Promise.resolve({ exitCode: 1, output: CODEGEN_OUTPUT }),
    );

    expect(exitCode).toBe(1);
    expect(output.written()).toEqual({
      stdout: '',
      stderr: `${CODEGEN_OUTPUT}${REGENERATE_GUIDANCE}`,
    });
  });

  test('graphql-codegenを起動できなければ、理由を標準エラー出力へ書いて終了コード1を返す', async () => {
    const output = createOutput();

    const exitCode = await runCodegenCheckCommand('/apps/sample', output, () =>
      Promise.reject(new Error('spawn graphql-codegen ENOENT')),
    );

    expect(exitCode).toBe(1);
    expect(output.written()).toEqual({
      stdout: '',
      stderr:
        'GraphQLの生成物の検査を完了できませんでした: spawn graphql-codegen ENOENT\n',
    });
  });
});
