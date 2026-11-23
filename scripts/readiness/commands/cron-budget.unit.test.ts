import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { JsonSourceError } from '../adapters/json-lines-source.ts';
import { runCli } from '../cli.ts';
import { rejectionOf } from '../test-fixtures/rejection-of.ts';
import { createCronBudgetCommand, run } from './cron-budget.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/readiness-command.ts';

const FIXTURES = join(import.meta.dirname, '..', 'test-fixtures');
const EXPECTED_ORDER = join(FIXTURES, 'daily-batch-expected-order.txt');
const WITHIN_BUDGET = join(FIXTURES, 'cron-budget-within-budget.jsonl');
const OVER_BUDGET = join(FIXTURES, 'cron-budget-over-budget.json');

const createOutput = () => {
  const chunks: string[] = [];
  return {
    write: (text: string): void => {
      chunks.push(text);
    },
    text: (): string => chunks.join(''),
  };
};

const execute = async (
  args: readonly string[],
  command: { run: typeof run } = { run },
) => {
  const stdout = createOutput();
  const stderr = createOutput();
  const exitCode = await command.run(args, { stdout, stderr });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
};

const summaryLine = (
  time: string,
  cron: string,
  jobs: readonly { name: string; durationMs: number }[],
): string =>
  JSON.stringify({
    time,
    level: 'info',
    message: '定期実行を終えました',
    kind: 'scheduled',
    cron,
    result: 'succeeded',
    jobs: jobs.map((entry) => ({ ...entry, result: 'succeeded' })),
    totalDurationMs: jobs.reduce((sum, { durationMs }) => sum + durationMs, 0),
  });

const fakeCommand = (files: Readonly<Record<string, string>>) =>
  createCronBudgetCommand({
    readText: (path) => {
      const text = files[path];
      return text === undefined
        ? Promise.reject(new JsonSourceError(`${path}を読み込めませんでした`))
        : Promise.resolve(text);
    },
  });

describe('cron-budgetのサブコマンド(実際の例のログ)', () => {
  test('予算内のログの例を渡すと判定の表を標準出力へ出して成功する', async () => {
    const result = await execute([
      '--expected-order',
      EXPECTED_ORDER,
      WITHIN_BUDGET,
    ]);

    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('## 日次バッチの予算の判定');
    expect(result.stdout).toContain('2026-11-24T12:21:41.000Z');
    expect(result.stdout).toContain('予算内');
    expect(result.stdout).toContain('他の起動(参考の値)');
    expect(result.stdout).toContain('payments.checkout-reconciliation');
  });

  test('予算を超えて失敗・目安超過・順序の食い違いのあるログの例は失敗の終了コードと理由を返す', async () => {
    const result = await execute([
      '--expected-order',
      EXPECTED_ORDER,
      OVER_BUDGET,
    ]);

    expect(result.exitCode).toBe(EXIT_FAILURE);
    expect(result.stdout).toContain('上限超過');
    expect(result.stdout).toContain('順序の食い違い');
    expect(result.stderr).toContain('上限600,000msを超えました');
    expect(result.stderr).toContain('inquiry-chat.guest-inquiry-retention');
    expect(result.stderr).toContain('目安30,000ms');
    expect(result.stderr).toContain('順序の食い違い');
  });

  test('ジョブの失敗の行と予算の超過の行は要約として数えず、起動は1つだけ並ぶ', async () => {
    const result = await execute([
      '--expected-order',
      EXPECTED_ORDER,
      OVER_BUDGET,
    ]);

    expect(result.stdout.match(/2026-11-25T12:/g)).not.toBeNull();
    expect(result.stdout).not.toContain('2026-11-25T12:22:10.000Z');
    expect(result.stdout).not.toContain('2026-11-25T12:26:40.000Z');
  });

  test('複数のログのファイルを合わせて読み、4:21の起動を1つにまとめて判定する', async () => {
    const result = await execute([
      '--expected-order',
      EXPECTED_ORDER,
      WITHIN_BUDGET,
      WITHIN_BUDGET,
    ]);

    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect(result.stdout.match(/2026-11-24T12:21:41\.000Z \|/g)).toHaveLength(
      1,
    );
  });

  test('入口から呼ぶと表の行を通してサブコマンドが動く', async () => {
    const stdout = createOutput();
    const stderr = createOutput();

    const exitCode = await runCli({
      args: ['cron-budget', '--expected-order', EXPECTED_ORDER, WITHIN_BUDGET],
      stdout,
      stderr,
    });

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout.text()).toContain('予算内');
  });
});

describe('cron-budgetのサブコマンド(判定の結果)', () => {
  const ORDER_FILE = 'order.txt';
  const LOG_FILE = 'run.jsonl';
  const command = (log: string) =>
    fakeCommand({ [ORDER_FILE]: 'a.first\na.second\n', [LOG_FILE]: log });
  const args = [`--expected-order`, ORDER_FILE, LOG_FILE];

  test('4:21の起動が予算内で全て成功し順序も合えば成功する', async () => {
    const log = summaryLine('2026-11-24T12:21:00.000Z', '21 12 * * *', [
      { name: 'a.first', durationMs: 10 },
      { name: 'a.second', durationMs: 20 },
    ]);

    const result = await execute(args, command(log));

    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect(result.stderr).toBe('');
  });

  test('4:21の起動が無く参考の起動だけなら判定できず失敗し、表に参考の値を出す', async () => {
    const log = summaryLine('2026-11-24T07:40:00.000Z', '40 7 * * *', [
      { name: 'm.settle', durationMs: 5 },
    ]);

    const result = await execute(args, command(log));

    expect(result.exitCode).toBe(EXIT_FAILURE);
    expect(result.stderr).toContain(
      '4:21の起動の要約の行が見つかりませんでした',
    );
    expect(result.stdout).toContain('m.settle');
  });

  test('要約の行がログに1つも無ければ失敗する', async () => {
    const result = await execute(args, command('{"message":"x"}\n'));

    expect(result.exitCode).toBe(EXIT_FAILURE);
    expect(result.stdout).toContain('4:21の起動の要約の行はありません');
  });

  test('参考の起動の失敗や遅さは終了コードに影響しない', async () => {
    const log = [
      summaryLine('2026-11-24T07:40:00.000Z', '40 7 * * *', [
        { name: 'm.settle', durationMs: 900_000 },
      ]),
      summaryLine('2026-11-24T12:21:00.000Z', '21 12 * * *', [
        { name: 'a.first', durationMs: 1 },
        { name: 'a.second', durationMs: 1 },
      ]),
    ].join('\n');

    expect((await execute(args, command(log))).exitCode).toBe(EXIT_SUCCESS);
  });
});

describe('cron-budgetのサブコマンド(入力の誤り)', () => {
  const files = {
    'order.txt': 'a.first\n',
    'run.jsonl': '{}\n',
    'broken.jsonl': 'JSONではない\n',
    'empty-order.txt': '# 注釈だけ\n',
  };
  const command = fakeCommand(files);

  test.each([
    ['期待の順序のファイルの指定が無い', ['run.jsonl']],
    ['ログのファイルの指定が無い', ['--expected-order', 'order.txt']],
    [
      '未知のオプション',
      ['--unknown', '--expected-order', 'order.txt', 'run.jsonl'],
    ],
    ['期待の順序のファイルの値が無い', ['run.jsonl', '--expected-order']],
    [
      'ログのファイルが存在しない',
      ['--expected-order', 'order.txt', 'missing.jsonl'],
    ],
    [
      '期待の順序のファイルが存在しない',
      ['--expected-order', 'missing.txt', 'run.jsonl'],
    ],
    [
      'ログがJSONとして読めない',
      ['--expected-order', 'order.txt', 'broken.jsonl'],
    ],
    ['期待の順序が空', ['--expected-order', 'empty-order.txt', 'run.jsonl']],
  ])('%sなら入力の形の誤りとして拒否する', async (_label, args) => {
    expect(await rejectionOf(execute(args, command))).toBeInstanceOf(
      UsageError,
    );
  });

  test('ファイルを読み込めないときの誤りにファイルのパスを含める', async () => {
    const error = await rejectionOf(
      execute(['--expected-order', 'order.txt', 'missing.jsonl'], command),
    );

    expect((error as Error).message).toContain('missing.jsonl');
  });

  test('入口から呼ぶと入力の形の誤りは使い方の終了コードで返る', async () => {
    const stderr = createOutput();

    const exitCode = await runCli({
      args: ['cron-budget'],
      stdout: createOutput(),
      stderr,
    });

    expect(exitCode).toBe(2);
    expect(stderr.text()).toContain('cron-budget');
  });

  test('--helpは使い方を標準出力へ出して成功する', async () => {
    const result = await execute(['--help'], command);

    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect(result.stdout).toContain('--expected-order');
  });
});
