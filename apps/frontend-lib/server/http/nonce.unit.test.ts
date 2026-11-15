import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import { generateNonce } from './nonce.ts';

const NONCE_BYTE_LENGTH = 16;

// CSPのnonce-sourceのbase64-valueの文法
const BASE64_VALUE_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/u;

afterEach(() => {
  spyOn(crypto, 'getRandomValues').mockRestore();
});

describe('generateNonce', () => {
  test('16バイトをbase64で表した、CSPのnonceに使える文字列を返す', () => {
    const nonce = generateNonce();

    expect(nonce).toMatch(BASE64_VALUE_PATTERN);
    expect(Uint8Array.fromBase64(nonce)).toHaveLength(NONCE_BYTE_LENGTH);
  });

  test('crypto.getRandomValuesで得たバイト列から作る', () => {
    spyOn(crypto, 'getRandomValues').mockImplementation(<T>(array: T): T => {
      if (array instanceof Uint8Array) {
        array.fill(0xfb);
      }
      return array;
    });

    expect(generateNonce()).toBe(new Uint8Array(16).fill(0xfb).toBase64());
  });

  test('呼ぶたびに異なる値を返す', () => {
    const count = 1000;

    const nonces = new Set(Array.from({ length: count }, generateNonce));

    expect(nonces.size).toBe(count);
  });
});
