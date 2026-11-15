import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  decodeCommentThreadCursor,
  encodeCommentThreadCursor,
} from './comment-thread-cursor.ts';

const COMMENT_ID = '01JD0CMNT00000000000000001';

const POSITION = Object.freeze({
  createdAt: 1_763_600_000_123,
  commentId: COMMENT_ID,
});

const base64urlOf = (text: string): string =>
  new TextEncoder()
    .encode(text)
    .toBase64({ alphabet: 'base64url', omitPadding: true });

const textOf = (cursor: string): string =>
  new TextDecoder().decode(
    Uint8Array.fromBase64(cursor, { alphabet: 'base64url' }),
  );

function rejectionOf(cursor: string): unknown {
  try {
    decodeCommentThreadCursor(cursor);
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe('encodeCommentThreadCursor', () => {
  test('作成日時のミリ秒とコメントのIDのJSONを、パディング無しのbase64urlにする', () => {
    const cursor = encodeCommentThreadCursor(POSITION);

    expect(cursor).toBe(
      base64urlOf(
        JSON.stringify({
          createdAt: POSITION.createdAt,
          commentId: COMMENT_ID,
        }),
      ),
    );
    expect(cursor).not.toContain('=');
  });

  test('作成日時とコメントのID以外の値を含めない', () => {
    const decoded: unknown = JSON.parse(
      textOf(encodeCommentThreadCursor(POSITION)),
    );

    expect(decoded).toEqual({
      createdAt: POSITION.createdAt,
      commentId: COMMENT_ID,
    });
  });
});

describe('decodeCommentThreadCursor', () => {
  test('符号化したカーソルから作成日時とコメントのIDを戻す', () => {
    expect(
      decodeCommentThreadCursor(encodeCommentThreadCursor(POSITION)),
    ).toEqual(POSITION);
  });

  test.each([
    ['base64urlでない文字を含む値', '!!!!'],
    [
      'パディングを付けた値',
      `${base64urlOf(JSON.stringify({ createdAt: 1, commentId: COMMENT_ID }))}==`,
    ],
    ['空の値', ''],
    ['UTF-8として読めない値', new Uint8Array([0xff, 0xfe]).toBase64()],
    ['JSONでない値', base64urlOf(`1:${COMMENT_ID}`)],
    ['配列のJSON', base64urlOf(JSON.stringify([1, COMMENT_ID]))],
    ['nullのJSON', base64urlOf('null')],
    [
      'コメントのIDの無い値',
      base64urlOf(JSON.stringify({ createdAt: POSITION.createdAt })),
    ],
    [
      '作成日時の無い値',
      base64urlOf(JSON.stringify({ commentId: COMMENT_ID })),
    ],
    [
      '作成日時が文字列の値',
      base64urlOf(
        JSON.stringify({ createdAt: '2026-11-20', commentId: COMMENT_ID }),
      ),
    ],
    [
      '作成日時が小数の値',
      base64urlOf(JSON.stringify({ createdAt: 1.5, commentId: COMMENT_ID })),
    ],
    [
      '作成日時が負の値',
      base64urlOf(JSON.stringify({ createdAt: -1, commentId: COMMENT_ID })),
    ],
    [
      '作成日時が安全な整数を超える値',
      base64urlOf(
        JSON.stringify({ createdAt: 2 ** 53, commentId: COMMENT_ID }),
      ),
    ],
    [
      'IDの形式が違う値',
      base64urlOf(JSON.stringify({ createdAt: 1, commentId: 'comment-1' })),
    ],
    [
      '小文字のIDの値',
      base64urlOf(
        JSON.stringify({ createdAt: 1, commentId: COMMENT_ID.toLowerCase() }),
      ),
    ],
    [
      '余分な項目を加えた値',
      base64urlOf(
        JSON.stringify({ createdAt: 1, commentId: COMMENT_ID, depth: 1 }),
      ),
    ],
  ])('%sはinvalid_cursorで拒否する', (_label, cursor) => {
    const error = rejectionOf(cursor);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      kind: 'bad_request',
      code: 'invalid_cursor',
    });
  });
});
