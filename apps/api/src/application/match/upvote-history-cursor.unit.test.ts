import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import {
  decodeUpvoteHistoryCursor,
  encodeUpvoteHistoryCursor,
} from './upvote-history-cursor.ts';

const MATCH_ID = '01JF0MATCH0000000000000001';

const POSITION = Object.freeze({
  matchDate: parseBusinessDate('2027-03-02'),
  matchId: MATCH_ID,
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
    decodeUpvoteHistoryCursor(cursor);
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe('encodeUpvoteHistoryCursor', () => {
  test('実施日とマッチのIDだけをコロンでつないだ文字列を、パディング無しのbase64urlにする', () => {
    expect(encodeUpvoteHistoryCursor(POSITION)).toBe(
      base64urlOf(`2027-03-02:${MATCH_ID}`),
    );
  });

  test('Upvoteの日時を推測できる値(日時とUpvoteのID)を含めない', () => {
    const text = textOf(encodeUpvoteHistoryCursor(POSITION));

    expect(text.split(':')).toEqual(['2027-03-02', MATCH_ID]);
  });
});

describe('decodeUpvoteHistoryCursor', () => {
  test('符号化したカーソルから実施日とマッチのIDを戻す', () => {
    expect(
      decodeUpvoteHistoryCursor(encodeUpvoteHistoryCursor(POSITION)),
    ).toEqual(POSITION);
  });

  test.each([
    ['base64urlでない文字を含む値', '!!!!'],
    ['パディングを付けた値', `${base64urlOf(`2027-03-02:${MATCH_ID}`)}==`],
    ['空の値', ''],
    ['UTF-8として読めない値', new Uint8Array([0xff, 0xfe]).toBase64()],
    ['マッチのIDの無い値', base64urlOf('2027-03-02')],
    ['存在しない日付の値', base64urlOf(`2027-02-30:${MATCH_ID}`)],
    ['IDの形式が違う値', base64urlOf('2027-03-02:match-1')],
    ['日時を加えた値', base64urlOf(`2027-03-02:1772454896789:${MATCH_ID}`)],
  ])('%sはinvalid_cursorで拒否する', (_label, cursor) => {
    const error = rejectionOf(cursor);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'invalid_cursor' });
  });
});
