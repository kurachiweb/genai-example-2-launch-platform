import { describe, expect, test } from 'bun:test';

import { parseCsv } from '../adapters/csv-source.ts';
import { createRun } from './graphql-latency.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/readiness-command.ts';

const HEADER = 'trace_id,span_id,parent_span_id,side,operation,duration_ms';

const createOutput = () => {
  const chunks: string[] = [];
  return {
    write: (text: string): void => {
      chunks.push(text);
    },
    text: (): string => chunks.join(''),
  };
};

const csvOf = (...lines: readonly string[]): string =>
  [HEADER, ...lines].join('\n');

const execute = async (
  files: Readonly<Record<string, string>>,
  args: readonly string[],
) => {
  const stdout = createOutput();
  const stderr = createOutput();
  const run = createRun({
    readCsv: (path) => {
      const text = files[path];
      if (text === undefined) {
        return Promise.reject(new Error(`ファイルがありません: ${path}`));
      }
      return Promise.resolve(parseCsv(text));
    },
  });
  const result = run(args, { stdout, stderr }).then(
    (exitCode) => ({ exitCode, error: undefined }),
    (error: unknown) => ({ exitCode: undefined, error }),
  );
  const { exitCode, error } = await result;
  return { exitCode, error, stdout: stdout.text(), stderr: stderr.text() };
};

const requestRows = (
  traceId: string,
  operation: string,
  durationMs: number,
): readonly string[] => [
  `${traceId},${traceId}-b,,browser,,${String(durationMs)}`,
  `${traceId},${traceId}-f,${traceId}-b,frontend,,10`,
  `${traceId},${traceId}-a,${traceId}-f,api,${operation},5`,
];

const requests = (
  operation: string,
  count: number,
  durationMs: number,
): readonly string[] =>
  Array.from({ length: count }, (_, index) =>
    requestRows(`${operation}-${String(index)}`, operation, durationMs),
  ).flat();

describe('graphql-latency', () => {
  test('操作ごとの表を標準出力へ出し、全て合格なら成功で終わる', async () => {
    const { exitCode, stdout } = await execute(
      { 'in.csv': csvOf(...requests('HomeQuery', 3, 120)) },
      ['--input', 'in.csv', '--min-samples', '3'],
    );
    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('| HomeQuery | 3 | 120 | 合格 |');
    expect(stdout).toContain('結べなかったブラウザのスパン: 0件');
  });

  test('既定の最小の標本200件に満たなければ失敗で終わる', async () => {
    const { exitCode, stdout } = await execute(
      { 'in.csv': csvOf(...requests('HomeQuery', 3, 120)) },
      ['--input', 'in.csv'],
    );
    expect(exitCode).toBe(EXIT_FAILURE);
    expect(stdout).toContain('| HomeQuery | 3 | 120 | 標本不足 |');
    expect(stdout).toContain('最小の標本200件');
  });

  test('既定の閾値300msを301msが超えたら失敗で終わる', async () => {
    const { exitCode, stdout } = await execute(
      { 'in.csv': csvOf(...requests('Slow', 2, 301)) },
      ['--input', 'in.csv', '--min-samples', '2'],
    );
    expect(exitCode).toBe(EXIT_FAILURE);
    expect(stdout).toContain('| Slow | 2 | 301 | 不合格 |');
  });

  test('閾値を引数で変えられる', async () => {
    const { exitCode } = await execute(
      { 'in.csv': csvOf(...requests('Slow', 2, 301)) },
      ['--input', 'in.csv', '--min-samples', '2', '--threshold-ms', '301'],
    );
    expect(exitCode).toBe(EXIT_SUCCESS);
  });

  test('操作を指定すると、標本の無い操作は標本不足の行になり失敗で終わる', async () => {
    const { exitCode, stdout } = await execute(
      { 'in.csv': csvOf(...requests('HomeQuery', 2, 100)) },
      [
        '--input',
        'in.csv',
        '--min-samples',
        '2',
        '--operation',
        'HomeQuery',
        '--operation',
        'Missing',
      ],
    );
    expect(exitCode).toBe(EXIT_FAILURE);
    expect(stdout).toContain('| HomeQuery | 2 | 100 | 合格 |');
    expect(stdout).toContain('| Missing | 0 | - | 標本不足 |');
  });

  test('操作を指定すると、指定外の操作を表に出さない', async () => {
    const { stdout } = await execute(
      {
        'in.csv': csvOf(
          ...requests('HomeQuery', 2, 100),
          ...requests('Other', 2, 100),
        ),
      },
      ['--input', 'in.csv', '--min-samples', '2', '--operation', 'HomeQuery'],
    );
    expect(stdout).not.toContain('Other');
  });

  test('操作名の無いトレースを結べなかったスパンの数として表に添える', async () => {
    const { stdout } = await execute(
      {
        'in.csv': csvOf(
          ...requests('HomeQuery', 2, 100),
          't-x,t-x-b,,browser,,50',
          't-y,t-y-b,,browser,,60',
        ),
      },
      ['--input', 'in.csv', '--min-samples', '2'],
    );
    expect(stdout).toContain('結べなかったブラウザのスパン: 2件');
  });

  test('標本が1件も無ければ失敗で終わる', async () => {
    const { exitCode, stdout } = await execute(
      { 'in.csv': csvOf('t-x,t-x-b,,browser,,50') },
      ['--input', 'in.csv'],
    );
    expect(exitCode).toBe(EXIT_FAILURE);
    expect(stdout).toContain('判定できる標本がありません');
  });

  test('列名を引数で指定できる', async () => {
    const text = [
      'trace,id,parent,kind,op,ms',
      't1,b,,browser,,100',
      't1,a,b,api,HomeQuery,5',
    ].join('\n');
    const { exitCode, stdout } = await execute({ 'in.csv': text }, [
      '--input',
      'in.csv',
      '--min-samples',
      '1',
      '--trace-id-column',
      'trace',
      '--span-id-column',
      'id',
      '--parent-span-id-column',
      'parent',
      '--side-column',
      'kind',
      '--operation-column',
      'op',
      '--duration-column',
      'ms',
    ]);
    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('| HomeQuery | 1 | 100 | 合格 |');
  });

  test('CSVに必要な列が無ければ欠けた列を挙げて使い方の誤りにする', async () => {
    const { error } = await execute({ 'in.csv': 'trace_id,span_id\nt1,b1\n' }, [
      '--input',
      'in.csv',
    ]);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain('side');
    expect((error as Error).message).toContain('duration_ms');
  });

  test('--inputが無ければ使い方の誤りにする', async () => {
    const { error } = await execute({}, []);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain('--input');
  });

  test('未知の引数を使い方の誤りにする', async () => {
    const { error } = await execute({}, ['--input', 'in.csv', '--unknown']);
    expect(error).toBeInstanceOf(UsageError);
  });

  test.each([
    ['--threshold-ms', 'abc'],
    ['--threshold-ms', '-1'],
    ['--min-samples', '0'],
    ['--min-samples', '1.5'],
  ])('数値の引数%s %sが不正なら使い方の誤りにする', async (name, value) => {
    const { error } = await execute({ 'in.csv': csvOf() }, [
      '--input',
      'in.csv',
      name,
      value,
    ]);
    expect(error).toBeInstanceOf(UsageError);
  });

  test('所要時間が数値でない行を行番号つきで使い方の誤りにする', async () => {
    const { error } = await execute(
      { 'in.csv': csvOf('t1,b1,,browser,,fast') },
      ['--input', 'in.csv'],
    );
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain('2行目');
    expect((error as Error).message).toContain('fast');
  });

  test('行の種類が未知の値の行を使い方の誤りにする', async () => {
    const { error } = await execute({ 'in.csv': csvOf('t1,b1,,mobile,,10') }, [
      '--input',
      'in.csv',
    ]);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain('mobile');
  });

  test('CSVの形の誤りを使い方の誤りにする', async () => {
    const { error } = await execute({ 'in.csv': 'a\n"unclosed\n' }, [
      '--input',
      'in.csv',
    ]);
    expect(error).toBeInstanceOf(UsageError);
  });

  test('ファイルを読めなければ使い方の誤りにする', async () => {
    const { error } = await execute({}, ['--input', 'missing.csv']);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain('missing.csv');
  });

  describe('--help', () => {
    const executeHelp = async (args: readonly string[]) => {
      const stdout = createOutput();
      const stderr = createOutput();
      const reads: string[] = [];
      const run = createRun({
        readCsv: (path) => {
          reads.push(path);
          return Promise.resolve(parseCsv(csvOf()));
        },
      });
      const exitCode = await run(args, { stdout, stderr });
      return { exitCode, reads, stdout: stdout.text(), stderr: stderr.text() };
    };

    test.each(['--help', '-h'])(
      '%sは使い方を標準出力へ出して成功し、CSVを読み込まない',
      async (flag) => {
        const result = await executeHelp([flag]);

        expect(result.exitCode).toBe(EXIT_SUCCESS);
        expect(result.stderr).toBe('');
        expect(result.reads).toEqual([]);
        expect(result.stdout).toContain('使い方: graphql-latency');
      },
    );

    test('他の引数と並べても使い方だけを表示してCSVを読み込まない', async () => {
      const result = await executeHelp(['--input', 'in.csv', '--help']);

      expect(result.exitCode).toBe(EXIT_SUCCESS);
      expect(result.reads).toEqual([]);
      expect(result.stdout).toContain('--input');
    });

    test('全てのオプションと既定値と終了コードの意味を示す', async () => {
      const { stdout } = await executeHelp(['--help']);

      for (const option of [
        '--input',
        '--threshold-ms',
        '--min-samples',
        '--operation',
        '--trace-id-column',
        '--span-id-column',
        '--parent-span-id-column',
        '--side-column',
        '--operation-column',
        '--duration-column',
      ]) {
        expect(stdout).toContain(option);
      }
      for (const defaultValue of [
        '300',
        '200',
        'trace_id',
        'span_id',
        'parent_span_id',
        'side',
        'operation',
        'duration_ms',
      ]) {
        expect(stdout).toContain(defaultValue);
      }
      expect(stdout).toContain('終了コード0');
      expect(stdout).toContain('終了コード1');
      expect(stdout).toContain('終了コード2');
    });
  });
});
