import { describe, expect, test } from 'bun:test';

import { UsageError } from './delivery-command.ts';
import {
  optionalChoice,
  parseOptions,
  requiredChoice,
} from './parse-options.ts';

const usageMessageOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof UsageError) return error.message;
    throw error;
  }
  throw new Error('引数の誤りになるはずが成功しました');
};

describe('parseOptions', () => {
  test('`--名前 値`と`--名前=値`の両方を読み、`--`の後をコマンドとして返す', () => {
    const parsed = parseOptions(
      ['--scope', 'checks', '--worker=api', '--', 'bunx', 'wrangler', '--x'],
      { names: ['scope', 'worker'], rest: 'allowed' },
    );

    expect(Object.fromEntries(parsed.options)).toEqual({
      scope: 'checks',
      worker: 'api',
    });
    expect(parsed.rest).toEqual(['bunx', 'wrangler', '--x']);
  });

  test('`--`が無ければコマンドは無い', () => {
    expect(
      parseOptions(['--scope', 'prod'], { names: ['scope'], rest: 'none' })
        .rest,
    ).toEqual([]);
  });

  test.each([
    [['--env', 'dev'], '未知のオプションです: --env'],
    [['checks'], 'オプションでない引数は受け取りません: checks'],
    [['--scope'], '--scopeに値を指定してください'],
    [['--scope', '--worker'], '--scopeに値を指定してください'],
    [['--scope='], '--scopeに値を指定してください'],
    [['--scope', 'a', '--scope', 'b'], '--scopeが重複しています'],
    [['--scope', 'a', '--', 'echo'], '`--`の後のコマンドは受け取りません'],
  ])('引数の誤り(%p)を示す', (args, message) => {
    expect(
      usageMessageOf(() =>
        parseOptions(args, { names: ['scope', 'worker'], rest: 'none' }),
      ),
    ).toBe(message);
  });
});

describe('requiredChoice・optionalChoice', () => {
  const options = new Map([['scope', 'checks']]);

  test('選択肢の中の値を返し、任意のオプションが無ければundefinedを返す', () => {
    expect(requiredChoice(options, 'scope', ['checks', 'local'])).toBe(
      'checks',
    );
    expect(optionalChoice(options, 'worker', ['api', 'event'])).toBeUndefined();
  });

  test('必須のオプションが無い、または選択肢に無い値なら、選択肢を示して引数の誤りにする', () => {
    expect(
      usageMessageOf(() => requiredChoice(new Map(), 'scope', ['a', 'b'])),
    ).toBe('--scopeを指定してください(a・b)');
    expect(
      usageMessageOf(() => optionalChoice(options, 'scope', ['a', 'b'])),
    ).toBe('--scopeはa・bのいずれかにしてください(実際: checks)');
  });
});
