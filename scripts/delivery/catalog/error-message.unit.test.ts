import { describe, expect, test } from 'bun:test';

import { messageOf } from './error-message.ts';

describe('messageOf', () => {
  test('Errorはその文言を返す', () => {
    expect(messageOf(new Error('読み込めませんでした'))).toBe(
      '読み込めませんでした',
    );
  });

  test.each([
    ['失敗', '失敗'],
    [42, '42'],
    [undefined, 'undefined'],
  ])('Error以外(%p)は文字列にして返す', (error, expected) => {
    expect(messageOf(error)).toBe(expected);
  });
});
