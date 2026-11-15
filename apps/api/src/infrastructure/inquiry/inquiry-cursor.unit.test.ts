import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { decodeInquiryCursor, encodeInquiryCursor } from './inquiry-cursor.ts';

const INQUIRY_ID = '01JC0MINQ00000000000000001';

const AT = new Date('2026-11-05T01:02:03.456Z');

const base64urlOf = (text: string): string =>
  new TextEncoder()
    .encode(text)
    .toBase64({ alphabet: 'base64url', omitPadding: true });

function rejectionOf(cursor: string): unknown {
  try {
    decodeInquiryCursor(cursor);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('encodeInquiryCursor', () => {
  test('日時のミリ秒とIDを「:」でつないだ文字列を、パディング無しのbase64urlにする', () => {
    expect(encodeInquiryCursor({ at: AT, id: INQUIRY_ID })).toBe(
      base64urlOf(`${String(AT.getTime())}:${INQUIRY_ID}`),
    );
  });
});

describe('decodeInquiryCursor', () => {
  test('符号化したカーソルから日時とIDを戻す', () => {
    const cursor = encodeInquiryCursor({ at: AT, id: INQUIRY_ID });

    expect(decodeInquiryCursor(cursor)).toEqual({ at: AT, id: INQUIRY_ID });
  });

  test('エポックの0ミリ秒の位置も戻す', () => {
    const cursor = encodeInquiryCursor({ at: new Date(0), id: INQUIRY_ID });

    expect(decodeInquiryCursor(cursor)).toEqual({
      at: new Date(0),
      id: INQUIRY_ID,
    });
  });

  test.each([
    ['base64urlでない文字を含む値', '!!!!'],
    ['パディングを付けた値', `${base64urlOf(`1:${INQUIRY_ID}`)}==`],
    ['空白を含む値', ` ${base64urlOf(`1:${INQUIRY_ID}`)}`],
    ['区切りの無い値', base64urlOf(`1${INQUIRY_ID}`)],
    ['ミリ秒が数字でない値', base64urlOf(`x:${INQUIRY_ID}`)],
    ['ミリ秒が16桁の値', base64urlOf(`${'1'.repeat(16)}:${INQUIRY_ID}`)],
    ['IDが小文字の値', base64urlOf(`1:${INQUIRY_ID.toLowerCase()}`)],
    ['IDが25文字の値', base64urlOf(`1:${INQUIRY_ID.slice(1)}`)],
    ['UTF-8として読めない値', new Uint8Array([0xff, 0xfe]).toBase64()],
    ['空の値', ''],
  ])('%sを、ページの位置の指定の誤りとして拒否する', (_label, cursor) => {
    const error = rejectionOf(cursor);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      kind: 'bad_request',
      code: 'invalid_cursor',
    });
  });
});
