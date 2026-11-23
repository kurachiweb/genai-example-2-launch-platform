import { describe, expect, test } from 'bun:test';

import { COMMAND_TABLE, type CommandTable, runCli } from './cli.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  EXIT_USAGE,
  UsageError,
} from './commands/shared/readiness-command.ts';

const SUBCOMMAND_NAMES = [
  'cron-budget',
  'graphql-latency',
  'availability-probe',
  'degraded-env',
] as const;

const createOutput = () => {
  const chunks: string[] = [];
  return {
    write: (text: string): void => {
      chunks.push(text);
    },
    text: (): string => chunks.join(''),
  };
};

const run = async (args: readonly string[], table?: CommandTable) => {
  const stdout = createOutput();
  const stderr = createOutput();
  const exitCode = await runCli({
    args,
    stdout,
    stderr,
    ...(table === undefined ? {} : { table }),
  });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
};

const tableOf = (
  runner: (args: readonly string[]) => number | Promise<number>,
): CommandTable => ({
  sample: {
    description: '差し替えの確認用のサブコマンド',
    load: () =>
      Promise.resolve({
        run: async (args) => await runner(args),
      }),
  },
});

describe('振り分けの表', () => {
  test('4つのサブコマンドの行を全行そろえて持つ', () => {
    expect(Object.keys(COMMAND_TABLE)).toEqual([...SUBCOMMAND_NAMES]);
  });

  test('各行は説明を持つ', () => {
    expect(
      Object.values(COMMAND_TABLE).filter(
        ({ description }) => description === '',
      ),
    ).toEqual([]);
  });
});

describe('runCli', () => {
  test('--helpで4つのサブコマンドを表示して成功を返す', async () => {
    const { exitCode, stdout } = await run(['--help']);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(SUBCOMMAND_NAMES.filter((name) => !stdout.includes(name))).toEqual(
      [],
    );
  });

  test.each(['-h', 'help'])('%sも使い方を表示する', async (flag) => {
    const { exitCode, stdout } = await run([flag]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain('cron-budget');
  });

  test('サブコマンドが無ければ使い方を標準エラーへ出して入力の誤りを返す', async () => {
    const { exitCode, stdout, stderr } = await run([]);

    expect(exitCode).toBe(EXIT_USAGE);
    expect(stdout).toBe('');
    expect(stderr).toContain('サブコマンドを指定してください');
    expect(stderr).toContain('degraded-env');
  });

  test('未知のサブコマンドを拒否し、名前と一覧を示して入力の誤りを返す', async () => {
    const { exitCode, stderr } = await run(['no-such-command']);

    expect(exitCode).toBe(EXIT_USAGE);
    expect(stderr).toContain('未知のサブコマンドです: no-such-command');
    expect(stderr).toContain('availability-probe');
  });

  test.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'オブジェクトの組み込みの名前%sをサブコマンドとして扱わない',
    async (name) => {
      const { exitCode, stderr } = await run([name]);

      expect(exitCode).toBe(EXIT_USAGE);
      expect(stderr).toContain(`未知のサブコマンドです: ${name}`);
    },
  );

  test.each(SUBCOMMAND_NAMES)(
    '表の%sの行は実行の関数を持つコマンドを読み込む',
    async (name) => {
      const loaded = await COMMAND_TABLE[name]?.load();

      expect(typeof loaded?.run).toBe('function');
    },
  );

  test('表の行が指すコマンドへ残りの引数を渡し、その終了コードを返す', async () => {
    const received: (readonly string[])[] = [];
    const table = tableOf((args) => {
      received.push(args);
      return EXIT_SUCCESS;
    });

    const { exitCode } = await run(['sample', '--a', 'b'], table);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(received).toEqual([['--a', 'b']]);
  });

  test('判定の失敗の終了コードをそのまま返す', async () => {
    const table = tableOf(() => Promise.resolve(EXIT_FAILURE));

    const { exitCode } = await run(['sample'], table);

    expect(exitCode).toBe(EXIT_FAILURE);
  });

  test('入力の形の誤りの例外は、メッセージと使い方の案内を出して入力の誤りを返す', async () => {
    const table = tableOf(() => {
      throw new UsageError('--inputが必要です');
    });

    const { exitCode, stderr } = await run(['sample'], table);

    expect(exitCode).toBe(EXIT_USAGE);
    expect(stderr).toContain('sample: --inputが必要です');
    expect(stderr).toContain('--help');
  });

  test('想定外の例外は、メッセージを出して失敗を返す', async () => {
    const table = tableOf(() => {
      throw new Error('読み込めません');
    });

    const { exitCode, stderr } = await run(['sample'], table);

    expect(exitCode).toBe(EXIT_FAILURE);
    expect(stderr).toContain('sample: 読み込めません');
  });

  test('Errorでない値が投げられても、文字列にして失敗を返す', async () => {
    const table = tableOf(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'broken';
    });

    const { exitCode, stderr } = await run(['sample'], table);

    expect(exitCode).toBe(EXIT_FAILURE);
    expect(stderr).toContain('sample: broken');
  });
});
