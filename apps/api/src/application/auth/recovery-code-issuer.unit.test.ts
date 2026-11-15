import { describe, expect, test } from 'bun:test';

import {
  createKeyedHasher,
  hashPurpose,
} from '../../../lib/core/crypto/keyed-hasher.ts';
import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
} from '../../domain/auth/recovery-code-format.ts';
import type { SecretGenerator } from './ports.ts';
import { HashingRecoveryCodeIssuer } from './recovery-code-issuer.ts';

const TEST_PEPPER = 'recovery-code-issuer-unit-test-pepper';

const RECOVERY_PURPOSE = hashPurpose('user-recovery-code');

const OTHER_PURPOSE = hashPurpose('admin-recovery-code');

const RAW_CODES = Array.from({ length: RECOVERY_CODE_COUNT }, (_, index) =>
  RECOVERY_CODE_ALPHABET.slice(index, index + RECOVERY_CODE_LENGTH),
);

interface RandomStringCall {
  readonly length: number;
  readonly alphabet: string;
}

interface FakeGenerator extends SecretGenerator {
  readonly calls: readonly RandomStringCall[];
}

function createSequentialGenerator(raws: readonly string[]): FakeGenerator {
  const calls: RandomStringCall[] = [];
  return {
    calls,
    token() {
      throw new Error('リカバリコードの発行はトークンを使いません。');
    },
    randomString(length, alphabet) {
      const raw = raws[calls.length];
      calls.push({ length, alphabet });
      if (raw === undefined) {
        throw new Error('偽の乱数の文字列を使い切りました。');
      }
      return raw;
    },
    uuid() {
      throw new Error('リカバリコードの発行はUUIDを使いません。');
    },
  };
}

describe('HashingRecoveryCodeIssuer', () => {
  test('リカバリコードの文字と長さで10個の乱数の文字列を作る', async () => {
    const generator = createSequentialGenerator(RAW_CODES);
    const issuer = new HashingRecoveryCodeIssuer(
      generator,
      createKeyedHasher(TEST_PEPPER),
    );

    await issuer.issue(RECOVERY_PURPOSE);

    expect(generator.calls).toEqual(
      Array.from({ length: RECOVERY_CODE_COUNT }, () => ({
        length: RECOVERY_CODE_LENGTH,
        alphabet: RECOVERY_CODE_ALPHABET,
      })),
    );
  });

  test('10個の表示用の平文と、区切りの無い形を用途付きでハッシュ化した値を同じ順に返す', async () => {
    const hasher = createKeyedHasher(TEST_PEPPER);
    const issuer = new HashingRecoveryCodeIssuer(
      createSequentialGenerator(RAW_CODES),
      hasher,
    );

    const issued = await issuer.issue(RECOVERY_PURPOSE);

    expect(issued.plains).toHaveLength(RECOVERY_CODE_COUNT);
    expect(issued.hashes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(issued.plains[0]).toBe('abcd-efgh-jkmn-pqrs');
    expect(issued.hashes).toEqual(
      await Promise.all(
        RAW_CODES.map((raw) => hasher.hash(RECOVERY_PURPOSE, raw)),
      ),
    );
    for (const [index, plain] of issued.plains.entries()) {
      expect(plain.replaceAll('-', '')).toBe(RAW_CODES[index] ?? '');
      expect(issued.hashes.join('')).not.toContain(plain);
    }
  });

  test('表示用の平文を利用者が入力し直したときのハッシュは発行時のハッシュと一致する', async () => {
    const issuer = new HashingRecoveryCodeIssuer(
      createSequentialGenerator(RAW_CODES),
      createKeyedHasher(TEST_PEPPER),
    );

    const issued = await issuer.issue(RECOVERY_PURPOSE);
    const reentered = await Promise.all(
      issued.plains.map((plain) => issuer.hashInput(RECOVERY_PURPOSE, plain)),
    );

    expect(reentered).toEqual([...issued.hashes]);
  });

  test.each([
    ['空白区切り・大文字', ' ABCD EFGH JKMN PQRS '],
    ['区切り無し', 'abcdefghjkmnpqrs'],
    ['全角の英字とハイフン', 'ａｂｃｄ－ｅｆｇｈ－ｊｋｍｎ－ｐｑｒｓ'],
  ])(
    '%sの入力は正規化してから発行時と同じハッシュにする',
    async (_label, input) => {
      const hasher = createKeyedHasher(TEST_PEPPER);
      const issuer = new HashingRecoveryCodeIssuer(
        createSequentialGenerator([]),
        hasher,
      );

      expect(await issuer.hashInput(RECOVERY_PURPOSE, input)).toBe(
        await hasher.hash(RECOVERY_PURPOSE, 'abcdefghjkmnpqrs'),
      );
    },
  );

  test.each([
    ['空文字', ''],
    ['短い', 'abcd-efgh'],
    ['使わない文字を含む', 'abcd-efgh-ijkl-mnop'],
    ['長すぎる', 'a'.repeat(65)],
  ])(
    '%sの入力は正規化できないためハッシュを返さない',
    async (_label, input) => {
      const issuer = new HashingRecoveryCodeIssuer(
        createSequentialGenerator([]),
        createKeyedHasher(TEST_PEPPER),
      );

      expect(await issuer.hashInput(RECOVERY_PURPOSE, input)).toBeUndefined();
    },
  );

  test('用途が異なれば同じ入力でもハッシュが異なる', async () => {
    const issuer = new HashingRecoveryCodeIssuer(
      createSequentialGenerator([]),
      createKeyedHasher(TEST_PEPPER),
    );

    expect(
      await issuer.hashInput(RECOVERY_PURPOSE, 'abcd-efgh-jkmn-pqrs'),
    ).not.toBe(await issuer.hashInput(OTHER_PURPOSE, 'abcd-efgh-jkmn-pqrs'));
  });
});
