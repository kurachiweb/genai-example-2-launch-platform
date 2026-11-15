import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  decodePaymentHistoryCursor,
  encodePaymentHistoryCursor,
} from './payment-history-cursor.ts';

const RECORD_ID = '01JD0000000000000000RECRD1';

const OCCURRED_AT = new Date('2027-04-01T09:30:15.123Z');

const base64urlOf = (text: string): string =>
  new TextEncoder()
    .encode(text)
    .toBase64({ alphabet: 'base64url', omitPadding: true });

function rejectionOf(cursor: string): unknown {
  try {
    decodePaymentHistoryCursor(cursor);
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe('encodePaymentHistoryCursor', () => {
  test('発生時刻のミリ秒とIDを「:」でつないだ文字列を、パディング無しのbase64urlにする', () => {
    expect(
      encodePaymentHistoryCursor({ occurredAt: OCCURRED_AT, id: RECORD_ID }),
    ).toBe(base64urlOf(`${String(OCCURRED_AT.getTime())}:${RECORD_ID}`));
  });
});

describe('decodePaymentHistoryCursor', () => {
  test('符号化したカーソルから発生時刻とIDを戻す', () => {
    const cursor = encodePaymentHistoryCursor({
      occurredAt: OCCURRED_AT,
      id: RECORD_ID,
    });

    expect(decodePaymentHistoryCursor(cursor)).toEqual({
      occurredAt: OCCURRED_AT,
      id: RECORD_ID,
    });
  });

  test.each([
    ['base64urlでない文字を含む値', '!!!!'],
    ['パディングを付けた値', `${base64urlOf(`1:${RECORD_ID}`)}==`],
    ['空白を含む値', ` ${base64urlOf(`1:${RECORD_ID}`)}`],
    ['区切りの無い値', base64urlOf(`1${RECORD_ID}`)],
    ['ミリ秒が数字でない値', base64urlOf(`x:${RECORD_ID}`)],
    ['ミリ秒が16桁の値', base64urlOf(`${'1'.repeat(16)}:${RECORD_ID}`)],
    ['IDが小文字の値', base64urlOf(`1:${RECORD_ID.toLowerCase()}`)],
    ['IDが25文字の値', base64urlOf(`1:${RECORD_ID.slice(1)}`)],
    ['UTF-8として読めない値', new Uint8Array([0xff, 0xfe]).toBase64()],
    ['空の値', ''],
  ])('%sを、ページの位置の指定の誤りとして拒否する', (_label, cursor) => {
    const error = rejectionOf(cursor);

    expect(error).toBeInstanceOf(AppError);
    expect({
      kind: (error as AppError).kind,
      code: (error as AppError).code,
    }).toEqual({ kind: 'bad_request', code: 'invalid_cursor' });
  });
});
