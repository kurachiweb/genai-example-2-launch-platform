import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';

import {
  createKeyedHasher,
  HasherConfigurationError,
  hashPurpose,
} from './keyed-hasher.ts';

const PEPPER = 'test-pepper-0123456789abcdefghijklmnopqrstuvwxyz';
const BASE64URL_86_PATTERN = /^[A-Za-z0-9_-]{86}$/u;

function replaceCharAt(text: string, index: number): string {
  const replacement = text[index] === 'A' ? 'B' : 'A';
  return `${text.slice(0, index)}${replacement}${text.slice(index + 1)}`;
}

describe('hashPurpose', () => {
  test('用途の名前をそのまま用途として返す', () => {
    expect(String(hashPurpose('rate-limit-key'))).toBe('rate-limit-key');
  });

  test('空の名前を拒否する', () => {
    expect(() => hashPurpose('')).toThrow(RangeError);
  });

  test('用途と値の区切りに使うNUL文字を含む名前を拒否する', () => {
    expect(() => hashPurpose('rate\u0000limit')).toThrow(RangeError);
  });
});

describe('createKeyedHasher', () => {
  test('ペッパーが空ならHasherConfigurationErrorになる', () => {
    expect(() => createKeyedHasher('')).toThrow(HasherConfigurationError);
  });

  test('ペッパーが未定義ならHasherConfigurationErrorになる', () => {
    expect(() => createKeyedHasher(undefined)).toThrow(
      HasherConfigurationError,
    );
  });

  test('HasherConfigurationErrorはErrorを継承し名前を持つ', () => {
    const error = new HasherConfigurationError('ペッパーが未設定です');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('HasherConfigurationError');
  });
});

describe('KeyedHasher.hash', () => {
  const hasher = createKeyedHasher(PEPPER);
  const purpose = hashPurpose('session-token');

  test('ペッパーを鍵とした「用途・NUL・値」のHMAC-SHA512をパディング無しのbase64urlで返す', async () => {
    const expected = createHmac('sha512', PEPPER)
      .update('session-token\u0000secret-value')
      .digest('base64url');

    const hash = await hasher.hash(purpose, 'secret-value');

    expect(hash).toBe(expected);
    expect(hash).toMatch(BASE64URL_86_PATTERN);
  });

  test('同じ入力からは常に同じ値を返す', async () => {
    const first = await hasher.hash(purpose, 'secret-value');
    const second = await createKeyedHasher(PEPPER).hash(
      hashPurpose('session-token'),
      'secret-value',
    );

    expect(second).toBe(first);
  });

  test('用途が違えば同じ値でも別のハッシュ値になる', async () => {
    const forSession = await hasher.hash(purpose, 'secret-value');
    const forRateLimit = await hasher.hash(
      hashPurpose('rate-limit-key'),
      'secret-value',
    );

    expect(forRateLimit).not.toBe(forSession);
  });

  test('ペッパーが違えば同じ入力でも別のハッシュ値になる', async () => {
    const original = await hasher.hash(purpose, 'secret-value');
    const otherPepper = await createKeyedHasher(`${PEPPER}x`).hash(
      purpose,
      'secret-value',
    );

    expect(otherPepper).not.toBe(original);
  });

  test('値が1文字違えば別のハッシュ値になる', async () => {
    const original = await hasher.hash(purpose, 'secret-value');
    const changed = await hasher.hash(purpose, 'secret-valuf');

    expect(changed).not.toBe(original);
  });

  test('空の値もハッシュ化できる', async () => {
    const hash = await hasher.hash(purpose, '');

    expect(hash).toMatch(BASE64URL_86_PATTERN);
  });

  test('値の文字列をUTF-8として扱う', async () => {
    const expected = createHmac('sha512', PEPPER)
      .update(
        Buffer.from('session-token\u0000ユーザー@example.example', 'utf8'),
      )
      .digest('base64url');

    const hash = await hasher.hash(purpose, 'ユーザー@example.example');

    expect(hash).toBe(expected);
  });
});

describe('KeyedHasher.verify', () => {
  const hasher = createKeyedHasher(PEPPER);
  const purpose = hashPurpose('session-token');
  const storedHashPromise = hasher.hash(purpose, 'secret-value');

  test('正しい値と保存済みのハッシュ値の照合は真になる', async () => {
    const storedHash = await storedHashPromise;

    expect(await hasher.verify(purpose, 'secret-value', storedHash)).toBe(true);
  });

  test('値が1文字違えば偽になる', async () => {
    const storedHash = await storedHashPromise;

    expect(await hasher.verify(purpose, 'secret-valuf', storedHash)).toBe(
      false,
    );
  });

  test('保存済みのハッシュ値が1文字違えば偽になる', async () => {
    const storedHash = await storedHashPromise;

    for (const index of [0, 42, 84, 85]) {
      expect(
        await hasher.verify(
          purpose,
          'secret-value',
          replaceCharAt(storedHash, index),
        ),
      ).toBe(false);
    }
  });

  test('用途が違えば偽になる', async () => {
    const storedHash = await storedHashPromise;

    expect(
      await hasher.verify(
        hashPurpose('rate-limit-key'),
        'secret-value',
        storedHash,
      ),
    ).toBe(false);
  });

  test('ペッパーが違えば偽になる', async () => {
    const storedHash = await storedHashPromise;

    expect(
      await createKeyedHasher(`${PEPPER}x`).verify(
        purpose,
        'secret-value',
        storedHash,
      ),
    ).toBe(false);
  });

  test('デコードできない形式や正規形でない表記は偽になる', async () => {
    const storedHash = await storedHashPromise;
    const standardBase64 = storedHash.replaceAll('-', '+').replaceAll('_', '/');
    const malformedHashes = [
      '',
      'not-a-hash',
      '!'.repeat(86),
      `${storedHash}==`,
      ` ${storedHash}`,
      `${storedHash.slice(0, 40)}\n${storedHash.slice(40)}`,
      storedHash.slice(0, 85),
      `${storedHash}A`,
      `${storedHash}AAAA`,
    ];
    if (standardBase64 !== storedHash) {
      malformedHashes.push(standardBase64);
    }

    for (const malformed of malformedHashes) {
      expect(await hasher.verify(purpose, 'secret-value', malformed)).toBe(
        false,
      );
    }
  });

  test('末尾の文字の余りのビットだけを変えた表記は偽になる', async () => {
    const storedHash = await storedHashPromise;
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const lastIndex = alphabet.indexOf(storedHash.at(-1) ?? '');
    const sameBytesVariant = `${storedHash.slice(0, 85)}${alphabet.charAt(lastIndex + 1)}`;

    expect(
      Uint8Array.fromBase64(sameBytesVariant, { alphabet: 'base64url' }),
    ).toEqual(Uint8Array.fromBase64(storedHash, { alphabet: 'base64url' }));
    expect(await hasher.verify(purpose, 'secret-value', sameBytesVariant)).toBe(
      false,
    );
  });
});
