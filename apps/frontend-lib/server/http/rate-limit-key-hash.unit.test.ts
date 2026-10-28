import { describe, expect, test } from 'bun:test';

import { createHmac } from 'node:crypto';

import {
  hashRateLimitKey,
  RATE_LIMIT_KEY_PURPOSE,
} from './rate-limit-key-hash.ts';

const PEPPER = 'test-pepper-for-rate-limit-key';
const BASE64URL_86_PATTERN = /^[A-Za-z0-9_-]{86}$/u;

// security/002の「ハッシュ化の方法」と「レート制限のキー」に従う、backend-libのhashRateLimitKeyと同じ計算
const expectedHash = (pepper: string, parts: readonly string[]): string =>
  createHmac('sha512', pepper)
    .update(`rate-limit-key\u0000${JSON.stringify(parts)}`)
    .digest('base64url');

const rejectionOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (rejection: unknown) => rejection,
  );

describe('RATE_LIMIT_KEY_PURPOSE', () => {
  test('backend-libと同じ用途rate-limit-keyである', () => {
    expect(RATE_LIMIT_KEY_PURPOSE).toBe('rate-limit-key');
  });
});

describe('hashRateLimitKey', () => {
  test.each([
    [['ip:203.0.113.5']],
    [['ip:2001:db8::1']],
    [['ip:unknown']],
    [['email-resend-by-address', 'user@example.example']],
    [['']],
  ])(
    '部品%pのキーは、node:cryptoのHMAC-SHA512で用途・NUL文字・部品の配列のJSONを計算した値と一致する',
    async (parts) => {
      const key = await hashRateLimitKey(PEPPER, ...parts);

      expect(key).toBe(expectedHash(PEPPER, parts));
    },
  );

  test('ペッパーと部品をUTF-8として計算する', async () => {
    const pepper = 'ペッパー🌶️';
    const parts = ['ip:203.0.113.5', '日本語の部品'];

    const key = await hashRateLimitKey(pepper, ...parts);

    expect(key).toBe(expectedHash(pepper, parts));
  });

  test('パディング無しのbase64urlの86文字を返す', async () => {
    const key = await hashRateLimitKey(PEPPER, 'ip:203.0.113.5');

    expect(key).toMatch(BASE64URL_86_PATTERN);
  });

  test('同じペッパーと部品からは常に同じキーを返し、元の値を含まない', async () => {
    const first = await hashRateLimitKey(PEPPER, 'ip:203.0.113.5');
    const second = await hashRateLimitKey(PEPPER, 'ip:203.0.113.5');

    expect(second).toBe(first);
    expect(first).not.toContain('203.0.113.5');
  });

  test('ペッパーが違えば別のキーになる', async () => {
    const original = await hashRateLimitKey(PEPPER, 'ip:203.0.113.5');
    const otherPepper = await hashRateLimitKey(
      'another-pepper',
      'ip:203.0.113.5',
    );

    expect(otherPepper).not.toBe(original);
  });

  test('部品の区切り位置が違えば、連結すると同じ文字列でも別のキーになる', async () => {
    const keys = await Promise.all([
      hashRateLimitKey(PEPPER, 'ab', 'c'),
      hashRateLimitKey(PEPPER, 'a', 'bc'),
      hashRateLimitKey(PEPPER, 'abc'),
      hashRateLimitKey(PEPPER, 'a:b'),
      hashRateLimitKey(PEPPER, 'a', 'b'),
      hashRateLimitKey(PEPPER, 'a\u0000b'),
    ]);

    expect(new Set(keys).size).toBe(keys.length);
  });

  test('部品が1つも無ければRangeErrorで拒否し、ペッパーを例外に含めない', async () => {
    const error = await rejectionOf(hashRateLimitKey(PEPPER));

    expect(error).toBeInstanceOf(RangeError);
    expect(Bun.inspect(error)).not.toContain(PEPPER);
  });
});
