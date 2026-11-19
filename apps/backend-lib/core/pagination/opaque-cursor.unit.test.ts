import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { AppError } from '../errors/app-error.ts';
import { decodeCursor, encodeCursor } from './opaque-cursor.ts';

const positionSchema = z.object({ createdAt: z.number(), id: z.string() });

const VALID_POSITION_JSON = '{"createdAt":1,"id":"???"}';

const textEncoder = new TextEncoder();

function toBase64Url(text: string): string {
  return textEncoder
    .encode(text)
    .toBase64({ alphabet: 'base64url', omitPadding: true });
}

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('例外が投げられませんでした');
}

describe('encodeCursor', () => {
  test('位置をJSONにしてパディング無しのbase64urlで符号化する', () => {
    const position = { createdAt: 1_793_000_000_000, id: '投稿-01?>' };

    const cursor = encodeCursor(position);

    expect(cursor).toBe(toBase64Url(JSON.stringify(position)));
    expect(cursor).toMatch(/^[\w-]+$/u);
  });

  test('同じ位置からは常に同じカーソルを作る', () => {
    expect(encodeCursor({ upvotedAt: 1, upvoteId: 'a' })).toBe(
      encodeCursor({ upvotedAt: 1, upvoteId: 'a' }),
    );
  });
});

describe('decodeCursor', () => {
  test('符号化したカーソルを検証規則に従って元の位置へ戻す', () => {
    const position = { createdAt: 1_793_000_000_000, id: '投稿-01?>' };

    expect(decodeCursor(positionSchema, encodeCursor(position))).toEqual(
      position,
    );
  });

  test('検証規則の変換の結果を返す', () => {
    const schema = z.object({ t: z.number().transform((t) => new Date(t)) });

    expect(decodeCursor(schema, encodeCursor({ t: 0 }))).toEqual({
      t: new Date(0),
    });
  });

  test.each([
    ['空文字列', ''],
    ['base64urlでない文字列', '***'],
    ['パディング付きの文字列', `${toBase64Url(VALID_POSITION_JSON)}=`],
    [
      '標準のbase64の記号を含む文字列',
      toBase64Url(VALID_POSITION_JSON).replace('_', '/'),
    ],
    [
      '途中に空白を含む文字列',
      `${toBase64Url(VALID_POSITION_JSON).slice(0, 4)} ${toBase64Url(VALID_POSITION_JSON).slice(4)}`,
    ],
    [
      'UTF-8として不正な内容',
      new Uint8Array([0xff, 0xfe]).toBase64({
        alphabet: 'base64url',
        omitPadding: true,
      }),
    ],
    ['JSONでない内容', toBase64Url('not json')],
    ['検証規則に合わない内容', toBase64Url('{"createdAt":"1","id":"a"}')],
    ['オブジェクトでない内容', toBase64Url('[1,"a"]')],
  ])('%sを不正なカーソルとしてinvalid_cursorで拒否する', (_label, cursor) => {
    const error = captureError(() => decodeCursor(positionSchema, cursor));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      kind: 'bad_request',
      code: 'invalid_cursor',
      message: 'ページの位置の指定が正しくありません。',
    });
  });
});
