import { describe, expect, test } from 'bun:test';

import { isStackOverflowError } from './stack-overflow.ts';

const recurseForever = (depth: number): number => recurseForever(depth + 1) + 1;

const thrownBy = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
};

const namedError = (name: string): Error =>
  Object.assign(new Error('x'), { name });

describe('isStackOverflowError', () => {
  test('実際の呼び出しの深さの超過をスタックあふれと判定する', () => {
    expect(isStackOverflowError(thrownBy(() => recurseForever(0)))).toBe(true);
  });

  test('Firefoxの再帰の超過の例外をスタックあふれと判定する', () => {
    expect(isStackOverflowError(namedError('InternalError'))).toBe(true);
  });

  test.each([
    ['範囲の誤り以外の例外', new TypeError('x')],
    ['範囲の誤りの名前だけを持つ例外', namedError('RangeError')],
    ['例外ではない値', 'RangeError'],
    ['undefined', undefined],
  ])('%sをスタックあふれと判定しない', (_, error) => {
    expect(isStackOverflowError(error)).toBe(false);
  });
});
