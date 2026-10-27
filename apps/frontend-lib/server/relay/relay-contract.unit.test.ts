import { describe, expect, test } from 'bun:test';

import {
  FORWARDED_BROWSER_HEADERS,
  GATEWAY_CALLER_HEADERS,
  MAX_SESSION_MAX_AGE_SECONDS,
  RELAY_PATH_PREFIX,
  RELAY_REQUEST_HEADERS,
  RELAY_TRACE_HEADERS,
  SESSION_CLEAR_VALUE,
  SESSION_INSTRUCTION_HEADERS,
  SESSION_TOKEN_PATTERN,
} from './relay-contract.ts';

const VALID_TOKEN = 'A'.repeat(21) + '_-' + 'z9'.repeat(10);

describe('中継の契約の値', () => {
  test('要求の項目名はapi-gatewayのGATEWAY_HEADERSと同じ小文字の名前である', () => {
    expect(RELAY_REQUEST_HEADERS).toEqual({
      clientIp: 'x-original-client-ip',
      sessionToken: 'x-session-token',
      botToken: 'cf-turnstile-response',
    });
  });

  test('フロントエンドサーバーが付けない呼び出し元の項目名はapi-gatewayのGATEWAY_HEADERSと同じである', () => {
    expect(GATEWAY_CALLER_HEADERS).toEqual({
      caller: 'x-internal-caller',
      debugCaller: 'x-debug-caller',
    });
  });

  test('指示の項目名はapi-gatewayのSESSION_RESPONSE_HEADERSと同じである', () => {
    expect(SESSION_INSTRUCTION_HEADERS).toEqual({
      issue: 'x-session-issue',
      maxAge: 'x-session-max-age',
      clear: 'x-session-clear',
    });
  });

  test('削除の指示の値は1である', () => {
    expect(SESSION_CLEAR_VALUE).toBe('1');
  });

  test('ブラウザから引き継ぐ項目は要求の形式とbot判定のトークンだけである', () => {
    expect(FORWARDED_BROWSER_HEADERS).toEqual([
      'content-type',
      'accept',
      'cf-turnstile-response',
    ]);
  });

  test('トレースの項目はsentry-traceとbaggageだけである', () => {
    expect(RELAY_TRACE_HEADERS).toEqual(['sentry-trace', 'baggage']);
  });

  test('中継の経路の接頭辞は/_bff/である', () => {
    expect(RELAY_PATH_PREFIX).toBe('/_bff/');
  });

  test('Cookieの有効期間の上限は400日の秒数である', () => {
    expect(MAX_SESSION_MAX_AGE_SECONDS).toBe(400 * 24 * 60 * 60);
  });

  test.each([
    ['RELAY_REQUEST_HEADERS', RELAY_REQUEST_HEADERS],
    ['GATEWAY_CALLER_HEADERS', GATEWAY_CALLER_HEADERS],
    ['SESSION_INSTRUCTION_HEADERS', SESSION_INSTRUCTION_HEADERS],
    ['FORWARDED_BROWSER_HEADERS', FORWARDED_BROWSER_HEADERS],
    ['RELAY_TRACE_HEADERS', RELAY_TRACE_HEADERS],
  ] as const)('%sは凍結されている', (_name, value) => {
    expect(Object.isFrozen(value)).toBe(true);
  });
});

describe('SESSION_TOKEN_PATTERN', () => {
  test('api-gatewayのSESSION_TOKEN_PATTERNと同じ正規表現である', () => {
    expect(SESSION_TOKEN_PATTERN.source).toBe('^[A-Za-z0-9_-]{43}$');
    expect(SESSION_TOKEN_PATTERN.flags).toBe('');
  });

  test('パディング無しのbase64urlの43文字に一致する', () => {
    expect(VALID_TOKEN).toHaveLength(43);
    expect(SESSION_TOKEN_PATTERN.test(VALID_TOKEN)).toBe(true);
  });

  test.each([
    ['42文字', 'A'.repeat(42)],
    ['44文字', 'A'.repeat(44)],
    ['パディング付き', `${'A'.repeat(42)}=`],
    ['base64の記号', `${'A'.repeat(42)}+`],
    ['空白', `${'A'.repeat(42)} `],
    ['改行', `${'A'.repeat(43)}\n`],
    ['区切り文字', `${'A'.repeat(42)};`],
    ['空', ''],
  ])('%sの値には一致しない', (_label, value) => {
    expect(SESSION_TOKEN_PATTERN.test(value)).toBe(false);
  });
});
