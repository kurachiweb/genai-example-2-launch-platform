import { describe, expect, test } from 'bun:test';

import { normalizeTotpCode, type SecondFactorInput } from './second-factor.ts';

describe('normalizeTotpCode', () => {
  test.each([
    { case: '数字6桁', input: '123456', expected: '123456' },
    { case: '先頭が0の6桁', input: '012345', expected: '012345' },
    { case: '前後と途中の空白', input: ' 123 456\t', expected: '123456' },
    { case: '全角の数字と空白', input: '１２３　４５６', expected: '123456' },
  ])('$caseから空白を除いた数字6桁を返す', ({ input, expected }) => {
    expect(normalizeTotpCode(input)).toBe(expected);
  });

  test.each([
    { case: '空', input: '' },
    { case: '5桁', input: '12345' },
    { case: '7桁', input: '1234567' },
    { case: 'ハイフン区切り', input: '123-456' },
    { case: '英字', input: 'abcdef' },
    { case: 'ASCII以外の数字', input: '١٢٣٤٥٦' },
    { case: 'リカバリコード', input: 'abcd-efgh-jkmn-pqrs' },
    { case: '極端に長い入力', input: `123456${' '.repeat(1000)}` },
  ])('形式に合わない入力($case)はundefinedを返す', ({ input }) => {
    expect(normalizeTotpCode(input)).toBeUndefined();
  });
});

describe('SecondFactorInput', () => {
  test('認証コードとリカバリコードを種類で区別する', () => {
    const inputs: readonly SecondFactorInput[] = [
      { kind: 'totp', code: '123456' },
      { kind: 'recovery', code: 'abcd-efgh-jkmn-pqrs' },
    ];
    expect(inputs.map((input) => input.kind)).toEqual(['totp', 'recovery']);
  });
});
