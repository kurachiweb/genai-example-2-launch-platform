import { describe, expect, test } from 'bun:test';

import {
  createKeyedHasher,
  hashPurpose,
} from '../../../lib/core/crypto/keyed-hasher.ts';
import type { SecretGenerator } from './ports.ts';
import { HashingSecretIssuer } from './secret-issuer.ts';

const TEST_PEPPER = 'secret-issuer-unit-test-pepper';

const TOKEN_PURPOSE = hashPurpose('user-auth-token:password-reset');

const OTHER_PURPOSE = hashPurpose('admin-auth-token:password-reset');

function createSequentialGenerator(tokens: readonly string[]): SecretGenerator {
  let index = 0;
  return {
    token() {
      const token = tokens[index];
      index += 1;
      if (token === undefined) {
        throw new Error('偽の乱数の秘密を使い切りました。');
      }
      return token;
    },
    randomString() {
      throw new Error('秘密の発行は文字列の乱数を使いません。');
    },
    uuid() {
      throw new Error('秘密の発行はUUIDを使いません。');
    },
  };
}

const FIRST_TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq';

const SECOND_TOKEN = 'rstuvwxyz0123456789_-ABCDEFGHIJKLMNOPQRSTUV';

describe('HashingSecretIssuer', () => {
  test('乱数の秘密の平文と、用途付きでハッシュ化した値の組を返す', async () => {
    const hasher = createKeyedHasher(TEST_PEPPER);
    const issuer = new HashingSecretIssuer(
      createSequentialGenerator([FIRST_TOKEN]),
      hasher,
    );

    const issued = await issuer.issue(TOKEN_PURPOSE);

    expect(issued).toEqual({
      plain: FIRST_TOKEN,
      hash: await hasher.hash(TOKEN_PURPOSE, FIRST_TOKEN),
    });
    expect(issued.hash).not.toContain(FIRST_TOKEN);
  });

  test('発行のたびに新しい乱数の秘密を使う', async () => {
    const issuer = new HashingSecretIssuer(
      createSequentialGenerator([FIRST_TOKEN, SECOND_TOKEN]),
      createKeyedHasher(TEST_PEPPER),
    );

    const first = await issuer.issue(TOKEN_PURPOSE);
    const second = await issuer.issue(TOKEN_PURPOSE);

    expect(first.plain).toBe(FIRST_TOKEN);
    expect(second.plain).toBe(SECOND_TOKEN);
    expect(first.hash).not.toBe(second.hash);
  });

  test('受け取った平文のハッシュは発行時のハッシュと一致し、照合に使える', async () => {
    const issuer = new HashingSecretIssuer(
      createSequentialGenerator([FIRST_TOKEN]),
      createKeyedHasher(TEST_PEPPER),
    );

    const issued = await issuer.issue(TOKEN_PURPOSE);

    expect(await issuer.hashOf(TOKEN_PURPOSE, issued.plain)).toBe(issued.hash);
  });

  test('用途が異なれば同じ平文でもハッシュが異なる', async () => {
    const issuer = new HashingSecretIssuer(
      createSequentialGenerator([]),
      createKeyedHasher(TEST_PEPPER),
    );

    expect(await issuer.hashOf(TOKEN_PURPOSE, FIRST_TOKEN)).not.toBe(
      await issuer.hashOf(OTHER_PURPOSE, FIRST_TOKEN),
    );
  });
});
