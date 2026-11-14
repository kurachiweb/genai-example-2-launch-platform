import { describe, expect, test } from 'bun:test';

import { AppError } from './app-error.ts';
import { invalidCursorError } from './invalid-cursor.ts';

describe('invalidCursorError', () => {
  test('ページの位置の指定の誤りを400のinvalid_cursorとして表す', () => {
    const error = invalidCursorError();

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      kind: 'bad_request',
      code: 'invalid_cursor',
      message: 'ページの位置の指定が正しくありません。',
    });
  });

  test('呼び出しごとに別の例外を作る', () => {
    expect(invalidCursorError()).not.toBe(invalidCursorError());
  });
});
