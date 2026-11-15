import { describe, expect, test } from 'bun:test';

import { parseCliArgs } from './cli-args.ts';

describe('parseCliArgs', () => {
  test('引数が無ければ直前のリリースを指定しない', () => {
    expect(parseCliArgs([])).toEqual({ previousRef: undefined });
  });

  test.each([
    ['空白区切り', ['--previous-ref', 'abc1234']],
    ['等号区切り', ['--previous-ref=abc1234']],
  ])(
    '--previous-refの値(%s)を直前のリリースのコミットにする',
    (_label, argv) => {
      expect(parseCliArgs(argv)).toEqual({ previousRef: 'abc1234' });
    },
  );

  test.each([
    ['無い', ['--previous-ref']],
    ['空の', ['--previous-ref=']],
    ['別のオプションの', ['--previous-ref', '--other']],
    ['ハイフンで始まる', ['--previous-ref=-abc']],
  ])('--previous-refの値が%s場合は失敗する', (_label, argv) => {
    expect(() => parseCliArgs(argv)).toThrow(
      '--previous-refにコミットを指定してください。',
    );
  });

  test.each([
    ['未知のオプション', ['--unknown']],
    ['位置引数', ['abc1234']],
  ])('%sは失敗する', (_label, argv) => {
    expect(() => parseCliArgs(argv)).toThrow('引数が正しくありません。');
  });
});
