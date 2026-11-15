import { describe, expect, test } from 'bun:test';

import { OBJECT_KEY_PATTERN } from '../../../common-lib/media/image-variants.ts';
import { generateObjectKey } from './object-key.ts';

const HEX_DIGITS = '0123456789abcdef';

const repeatedBytes =
  (pattern: readonly number[]) =>
  (length: number): Uint8Array =>
    Uint8Array.from(
      { length },
      (_, index) => pattern[index % pattern.length] ?? 0,
    );

const secureRandomBytes = (length: number): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(length));

describe('generateObjectKey', () => {
  test('乱数源に16バイトを求める', () => {
    const requested: number[] = [];

    generateObjectKey((length) => {
      requested.push(length);
      return new Uint8Array(length);
    });

    expect(requested).toEqual([16]);
  });

  test('乱数源のバイト列を32文字の小文字16進にする', () => {
    const generated = generateObjectKey(
      repeatedBytes([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]),
    );

    expect(generated).toBe(HEX_DIGITS.repeat(2));
  });

  test.each([
    ['0', 0x00],
    ['f', 0xff],
    ['0a', 0x0a],
  ])('1桁の値も2桁にそろえる(%s)', (digits, byte) => {
    expect(generateObjectKey(repeatedBytes([byte]))).toBe(
      digits.repeat(32 / digits.length),
    );
  });

  test('オブジェクトキーの形式に一致する', () => {
    expect(OBJECT_KEY_PATTERN.test(generateObjectKey(secureRandomBytes))).toBe(
      true,
    );
  });

  test('暗号論的乱数の源から呼ぶたびに異なる値を作る', () => {
    const generated = new Set(
      Array.from({ length: 100 }, () => generateObjectKey(secureRandomBytes)),
    );

    expect(generated.size).toBe(100);
  });

  test.each([15, 17, 0])('乱数源が%iバイトを返せば例外を投げる', (returned) => {
    expect(() => generateObjectKey(() => new Uint8Array(returned))).toThrow();
  });
});
