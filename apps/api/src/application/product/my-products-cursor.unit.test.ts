import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import {
  decodeMyProductsCursor,
  encodeMyProductsCursor,
} from './my-products-cursor.ts';

const PRODUCT_ID = '01JD0PRODUCT00000000000001';

const POSITION = Object.freeze({
  latestLaunchDate: parseBusinessDate('2026-10-30'),
  id: PRODUCT_ID,
});

const base64urlOf = (text: string): string =>
  new TextEncoder()
    .encode(text)
    .toBase64({ alphabet: 'base64url', omitPadding: true });

function rejectionOf(cursor: string): unknown {
  try {
    decodeMyProductsCursor(cursor);
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe('encodeMyProductsCursor', () => {
  test('最新のローンチ日をd・プロダクトのIDをidに持つJSONを、パディング無しのbase64urlにする', () => {
    expect(encodeMyProductsCursor(POSITION)).toBe(
      base64urlOf(JSON.stringify({ d: '2026-10-30', id: PRODUCT_ID })),
    );
  });
});

describe('decodeMyProductsCursor', () => {
  test('符号化したカーソルから最新のローンチ日とIDを戻す', () => {
    expect(decodeMyProductsCursor(encodeMyProductsCursor(POSITION))).toEqual(
      POSITION,
    );
  });

  test.each([
    ['base64urlでない文字を含む値', '!!!!'],
    [
      'パディングを付けた値',
      `${base64urlOf(JSON.stringify({ d: '2026-10-30', id: PRODUCT_ID }))}==`,
    ],
    ['空の値', ''],
    ['UTF-8として読めない値', new Uint8Array([0xff, 0xfe]).toBase64()],
    ['JSONでない値', base64urlOf(`2026-10-30:${PRODUCT_ID}`)],
    ['配列の値', base64urlOf(JSON.stringify(['2026-10-30', PRODUCT_ID]))],
    ['日の無い値', base64urlOf(JSON.stringify({ id: PRODUCT_ID }))],
    ['IDの無い値', base64urlOf(JSON.stringify({ d: '2026-10-30' }))],
    [
      '日が文字列でない値',
      base64urlOf(JSON.stringify({ d: 20261030, id: PRODUCT_ID })),
    ],
    [
      '日の形式でない値',
      base64urlOf(JSON.stringify({ d: '2026/10/30', id: PRODUCT_ID })),
    ],
    [
      '存在しない日の値',
      base64urlOf(JSON.stringify({ d: '2026-02-30', id: PRODUCT_ID })),
    ],
    [
      'IDが小文字の値',
      base64urlOf(
        JSON.stringify({ d: '2026-10-30', id: PRODUCT_ID.toLowerCase() }),
      ),
    ],
    [
      'IDが25文字の値',
      base64urlOf(JSON.stringify({ d: '2026-10-30', id: PRODUCT_ID.slice(1) })),
    ],
    [
      '余分な項目を持つ値',
      base64urlOf(
        JSON.stringify({ d: '2026-10-30', id: PRODUCT_ID, extra: 1 }),
      ),
    ],
  ])('%sを、ページの位置の指定の誤りとして拒否する', (_label, cursor) => {
    const error = rejectionOf(cursor);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      kind: 'bad_request',
      code: 'invalid_cursor',
    });
  });
});
