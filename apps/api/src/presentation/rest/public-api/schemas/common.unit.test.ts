import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../../../lib/core/errors/app-error.ts';
import {
  CursorQuerySchema,
  PUBLIC_API_CURSOR_MAX,
  publicApiCursorOf,
} from './common.ts';

const INVALID_CURSOR_MESSAGE = 'ページの位置の指定が正しくありません。';

function invalidCursorThrownBy(action: () => unknown): AppError | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof AppError ? error : undefined;
  }
  return undefined;
}

describe('カーソルの問い合わせ', () => {
  test('省略すると最初のページとしてカーソルを持たない', () => {
    expect(CursorQuerySchema.parse({})).toEqual({});
  });

  test.each([
    ['空文字列', ''],
    ['上限を超える長さ', 'a'.repeat(PUBLIC_API_CURSOR_MAX + 1)],
  ])(
    '%sも問い合わせの検証では拒否せず、位置の取り出しで判定する',
    (_label, cursor) => {
      expect(CursorQuerySchema.parse({ cursor })).toEqual({ cursor });
    },
  );
});

describe('問い合わせのカーソルの取り出し', () => {
  test('省略されたカーソルは最初のページを表すundefinedのまま返す', () => {
    expect(publicApiCursorOf(undefined)).toBeUndefined();
  });

  test('上限の長さまでの値をそのまま返す', () => {
    const cursor = 'a'.repeat(PUBLIC_API_CURSOR_MAX);

    expect(publicApiCursorOf(cursor)).toBe(cursor);
  });

  test.each([
    ['空文字列', ''],
    ['上限を超える長さ', 'a'.repeat(PUBLIC_API_CURSOR_MAX + 1)],
  ])(
    '%sは形式に合わないカーソルとして400のinvalid_cursorを投げる',
    (_label, cursor) => {
      const error = invalidCursorThrownBy(() => publicApiCursorOf(cursor));

      expect(error).toMatchObject({
        kind: 'bad_request',
        code: 'invalid_cursor',
        message: INVALID_CURSOR_MESSAGE,
      });
    },
  );
});
