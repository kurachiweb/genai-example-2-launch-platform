import { describe, expect, test } from 'bun:test';

import { createKeyedHasher, hashPurpose } from '../crypto/keyed-hasher.ts';
import { hashRateLimitKey, type HashedRateLimitKey } from './rate-limit-key.ts';

const hasher = createKeyedHasher('test-pepper-for-rate-limit-key');
const BASE64URL_86_PATTERN = /^[A-Za-z0-9_-]{86}$/u;

describe('hashRateLimitKey', () => {
  test('同じ部品からは常に同じキーを返す', async () => {
    const first = await hashRateLimitKey(
      hasher,
      'email-resend-by-address',
      'user@example.example',
    );
    const second = await hashRateLimitKey(
      createKeyedHasher('test-pepper-for-rate-limit-key'),
      'email-resend-by-address',
      'user@example.example',
    );

    expect(second).toBe(first);
    expect(first).toMatch(BASE64URL_86_PATTERN);
  });

  test('元の値を含まない', async () => {
    const key = await hashRateLimitKey(hasher, '203.0.113.7');

    expect(key).not.toContain('203.0.113.7');
  });

  test('部品が違えば別のキーになる', async () => {
    const forAlice = await hashRateLimitKey(
      hasher,
      'login',
      'alice@example.example',
    );
    const forBob = await hashRateLimitKey(
      hasher,
      'login',
      'bob@example.example',
    );

    expect(forBob).not.toBe(forAlice);
  });

  test('部品の区切り位置が違えば、連結すると同じ文字列でも別のキーになる', async () => {
    const keys = await Promise.all([
      hashRateLimitKey(hasher, 'ab', 'c'),
      hashRateLimitKey(hasher, 'a', 'bc'),
      hashRateLimitKey(hasher, 'abc'),
      hashRateLimitKey(hasher, 'a:b'),
      hashRateLimitKey(hasher, 'a', 'b'),
      hashRateLimitKey(hasher, 'a\u0000b'),
    ]);

    expect(new Set(keys).size).toBe(keys.length);
  });

  test('レート制限のキー用途でハッシュ化し、他の用途のハッシュ値と一致しない', async () => {
    const key = await hashRateLimitKey(hasher, 'value');
    const otherPurposeHashes = await Promise.all([
      hasher.hash(hashPurpose('session-token'), 'value'),
      hasher.hash(hashPurpose('session-token'), '["value"]'),
    ]);

    expect(otherPurposeHashes).not.toContain(key);
  });

  test('ペッパーが違えば別のキーになる', async () => {
    const original = await hashRateLimitKey(hasher, 'value');
    const otherPepper = await hashRateLimitKey(
      createKeyedHasher('another-pepper'),
      'value',
    );

    expect(otherPepper).not.toBe(original);
  });

  test('部品が1つも無ければ拒否する', async () => {
    const error: unknown = await hashRateLimitKey(hasher).then(
      () => undefined,
      (rejection: unknown) => rejection,
    );

    expect(error).toBeInstanceOf(RangeError);
  });

  test('ハッシュ化を通さない文字列はキーの型として扱えない', () => {
    // @ts-expect-error -- 生の文字列からHashedRateLimitKeyは作れない
    const key: HashedRateLimitKey = '203.0.113.7';

    expect(String(key)).toBe('203.0.113.7');
  });
});
