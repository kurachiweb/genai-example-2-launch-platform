import { describe, expect, test } from 'bun:test';

import { countGraphemes } from '../../../common-lib/text/graphemes.ts';
import { markdownBodyOf, plainTextOf } from './document-text.ts';

describe('markdownBodyOf', () => {
  test.each([1, 50, 5_000, 20_000])(
    '書記素でちょうど%d文字で、末尾は空白にならない',
    (n) => {
      const body = markdownBodyOf(n);

      expect(countGraphemes(body)).toBe(n);
      expect(body).toBe(body.trimEnd());
    },
  );

  test.each([0, -1, 1.5, Number.NaN])('%pは例外にする', (n) => {
    expect(() => markdownBodyOf(n)).toThrow('1以上の整数');
  });
});

describe('plainTextOf', () => {
  test.each([1, 25, 50, 100, 1_000, 2_000])(
    '書記素でちょうど%d文字で、改行を含まない',
    (n) => {
      const text = plainTextOf(n, 'ラベル: ');

      expect(countGraphemes(text)).toBe(n);
      expect(text.includes('\n')).toBe(false);
    },
  );

  test('先頭に見分けるための語を置き、ラベルが文字数を超えるときは切り詰める', () => {
    expect(plainTextOf(100, 'ラベル: ').startsWith('ラベル: ')).toBe(true);
    expect(plainTextOf(2, 'ラベル: ')).toBe('ラベ');
  });

  test('ラベルが空白で終わっても、末尾は空白にならず文字数を保つ', () => {
    const text = plainTextOf(3, 'a  ');

    expect(countGraphemes(text)).toBe(3);
    expect(text).toBe(text.trimEnd());
  });
});
