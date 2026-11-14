import { describe, expect, test } from 'bun:test';

import { validateExtraHeaders } from '../email/email-headers.ts';
import {
  isWellFormedUnsubscribeToken,
  listUnsubscribeHeaders,
  oneClickUnsubscribeUrl,
  UNSUBSCRIBE_LOOKUP_PURPOSE,
  UNSUBSCRIBE_SEED_BYTES,
  UNSUBSCRIBE_TOKEN_PURPOSE,
  unsubscribePageUrl,
  unsubscribeTokenSource,
} from './unsubscribe-token.ts';

const USER_ID = '01M7BNN5000000000000000001';
const SEED = new Uint8Array(32)
  .map((_value, index) => index)
  .toBase64({ alphabet: 'base64url', omitPadding: true });
const TOKEN = new Uint8Array(64)
  .map((_value, index) => 255 - index)
  .toBase64({ alphabet: 'base64url', omitPadding: true });
const CLIENT_ORIGIN = 'https://launch.example';
const EVENT_ORIGIN = 'https://event.launch.example';

describe('ハッシュの用途', () => {
  test('トークンの導出と照合で別の用途の名前を使う', () => {
    expect(String(UNSUBSCRIBE_TOKEN_PURPOSE)).toBe(
      'notification-unsubscribe-token',
    );
    expect(String(UNSUBSCRIBE_LOOKUP_PURPOSE)).toBe(
      'notification-unsubscribe-lookup',
    );
    expect(UNSUBSCRIBE_TOKEN_PURPOSE).not.toBe(UNSUBSCRIBE_LOOKUP_PURPOSE);
  });

  test('種は32バイトの乱数である', () => {
    expect(UNSUBSCRIBE_SEED_BYTES).toBe(32);
  });
});

describe('unsubscribeTokenSource', () => {
  test('利用者のID・通知種別・種をコロンでつないだ導出の入力を作る', () => {
    expect(
      unsubscribeTokenSource({
        userId: USER_ID,
        topic: 'match_result',
        seed: SEED,
      }),
    ).toBe(`${USER_ID}:match_result:${SEED}`);
  });

  test('同じ利用者でも通知種別が違えば別の入力になる', () => {
    expect(
      unsubscribeTokenSource({
        userId: USER_ID,
        topic: 'match_preview',
        seed: SEED,
      }),
    ).not.toBe(
      unsubscribeTokenSource({
        userId: USER_ID,
        topic: 'match_result',
        seed: SEED,
      }),
    );
  });

  test.each([
    [
      'ULIDでない利用者のID',
      { userId: 'user-1', topic: 'match_result', seed: SEED },
    ],
    ['未知の通知種別', { userId: USER_ID, topic: 'newsletter', seed: SEED }],
    ['短い種', { userId: USER_ID, topic: 'match_result', seed: SEED.slice(1) }],
    [
      'base64urlでない種',
      { userId: USER_ID, topic: 'match_result', seed: `${SEED.slice(1)}+` },
    ],
  ])('%sでは導出の入力を作らない', (_label, input) => {
    expect(() =>
      unsubscribeTokenSource(
        input as Parameters<typeof unsubscribeTokenSource>[0],
      ),
    ).toThrow(RangeError);
  });
});

describe('isWellFormedUnsubscribeToken', () => {
  test('64バイトをパディングなしのbase64urlで表した86文字を受け付ける', () => {
    expect(TOKEN).toHaveLength(86);
    expect(isWellFormedUnsubscribeToken(TOKEN)).toBe(true);
  });

  test.each([
    ['空の文字列', ''],
    ['85文字', TOKEN.slice(1)],
    ['87文字', `${TOKEN}A`],
    ['パディング付き', `${TOKEN}==`],
    ['base64の記号を含む', `+${TOKEN.slice(1)}`],
    ['末尾の余りのビットが立った表記', `${TOKEN.slice(0, 85)}B`],
    ['空白を含む', ` ${TOKEN.slice(1)}`],
  ])('%sのトークンを形式違反とする', (_label, value) => {
    expect(isWellFormedUnsubscribeToken(value)).toBe(false);
  });
});

describe('unsubscribePageUrl', () => {
  test('画面のオリジンの配信停止ページのフラグメントにトークンを渡す', () => {
    expect(unsubscribePageUrl(CLIENT_ORIGIN, TOKEN)).toBe(
      `${CLIENT_ORIGIN}/unsubscribe#token=${TOKEN}`,
    );
  });

  test('ローカルのオリジンでも本文のリンクを作る', () => {
    expect(unsubscribePageUrl('http://localhost:48041', TOKEN)).toBe(
      `http://localhost:48041/unsubscribe#token=${TOKEN}`,
    );
  });

  test('形式違反のトークンではリンクを作らない', () => {
    expect(() => unsubscribePageUrl(CLIENT_ORIGIN, 'token')).toThrow(
      RangeError,
    );
  });
});

describe('oneClickUnsubscribeUrl', () => {
  test('イベントサーバーのオリジンの経路のクエリにトークンを渡す', () => {
    expect(oneClickUnsubscribeUrl(EVENT_ORIGIN, TOKEN)).toBe(
      `${EVENT_ORIGIN}/unsubscribe?token=${TOKEN}`,
    );
  });

  test('形式違反のトークンではURLを作らない', () => {
    expect(() => oneClickUnsubscribeUrl(EVENT_ORIGIN, `${TOKEN}\r\n`)).toThrow(
      RangeError,
    );
  });
});

describe('listUnsubscribeHeaders', () => {
  test('https:のオリジンではRFC 8058の2つのヘッダーを付け、送信の追加のヘッダーの検証を通る', () => {
    const headers = listUnsubscribeHeaders(EVENT_ORIGIN, TOKEN);

    expect(headers).toEqual({
      'List-Unsubscribe': `<${EVENT_ORIGIN}/unsubscribe?token=${TOKEN}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(validateExtraHeaders(headers)).toEqual({ ok: true });
  });

  test.each([
    ['ローカルのhttp:のオリジン', 'http://localhost:48043'],
    ['localhost以外のhttp:のオリジン', 'http://event.launch.example'],
  ])('%sではヘッダーを付けない', (_label, origin) => {
    expect(listUnsubscribeHeaders(origin, TOKEN)).toEqual({});
  });

  test('形式違反のトークンではヘッダーを作らない', () => {
    expect(() => listUnsubscribeHeaders(EVENT_ORIGIN, 'token')).toThrow(
      RangeError,
    );
  });
});
