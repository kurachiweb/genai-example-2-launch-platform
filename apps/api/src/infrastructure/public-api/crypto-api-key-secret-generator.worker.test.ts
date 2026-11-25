import { Container } from 'inversify';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createKeyedHasher,
  hashPurpose,
  type KeyedHasher,
} from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { ApiKeySecretGenerator } from '../../application/public-api/ports.ts';
import { PUBLIC_API_TYPES } from '../../application/public-api/public-api-types.ts';
import {
  API_KEY_HASH_PURPOSE,
  API_KEY_TOKEN_PATTERN,
  isWellFormedApiKey,
} from '../../domain/public-api/api-key-token.ts';
import { CryptoApiKeySecretGenerator } from './crypto-api-key-secret-generator.ts';

const hasher = createKeyedHasher(
  'test-pepper-for-crypto-api-key-secret-generator',
);

const KEY_BYTE_LENGTH = 32;

// 乱数の供給元を、指定したバイト列を先頭から順に返すものに差し替える
function feedRandomBytes(bytes: readonly number[]): void {
  const queue = [...bytes];
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint8Array) {
        for (let index = 0; index < array.length; index += 1) {
          const next = queue.shift();
          if (next === undefined) {
            throw new Error('用意した乱数のバイト列を使い切りました。');
          }
          array[index] = next;
        }
      }
      return array;
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CryptoApiKeySecretGenerator', () => {
  test('平文はlsk_と32バイトの乱数のパディング無しのbase64url(43文字)の連結で、公開APIの平文の形式に合う', async () => {
    const { plain } = await new CryptoApiKeySecretGenerator(hasher).generate();

    expect(plain).toHaveLength(47);
    expect(plain).toMatch(API_KEY_TOKEN_PATTERN);
    expect(isWellFormedApiKey(plain)).toBe(true);
    expect(
      Uint8Array.fromBase64(plain.slice('lsk_'.length), {
        alphabet: 'base64url',
      }),
    ).toHaveLength(KEY_BYTE_LENGTH);
  });

  test('暗号論的乱数のバイト列をそのまま符号化する', async () => {
    const bytes = Array.from(
      { length: KEY_BYTE_LENGTH },
      (_, index) => (index * 37 + 251) % 256,
    );
    feedRandomBytes(bytes);

    const { plain } = await new CryptoApiKeySecretGenerator(hasher).generate();

    expect(plain).toBe(
      `lsk_${Uint8Array.from(bytes).toBase64({
        alphabet: 'base64url',
        omitPadding: true,
      })}`,
    );
  });

  test('ハッシュは平文をpublic-api-keyの用途でハッシュ化した値で、照合できる', async () => {
    const { plain, hash } = await new CryptoApiKeySecretGenerator(
      hasher,
    ).generate();

    expect(hash).toBe(await hasher.hash(hashPurpose('public-api-key'), plain));
    expect(hash).toBe(await hasher.hash(API_KEY_HASH_PURPOSE, plain));
    await expect(
      hasher.verify(API_KEY_HASH_PURPOSE, plain, hash),
    ).resolves.toBe(true);
    expect(hash).not.toBe(
      await hasher.hash(hashPurpose('user-session'), plain),
    );
    expect(hash).not.toContain(plain);
  });

  test('呼び出すたびに別の平文とハッシュを返す', async () => {
    const generator = new CryptoApiKeySecretGenerator(hasher);

    const secrets = await Promise.all(
      Array.from({ length: 50 }, () => generator.generate()),
    );

    expect(new Set(secrets.map(({ plain }) => plain)).size).toBe(50);
    expect(new Set(secrets.map(({ hash }) => hash)).size).toBe(50);
  });

  test('コンテナでハッシュ化の部品を注入して解決できる', async () => {
    const container = new Container();
    container
      .bind<KeyedHasher>(PLATFORM_TYPES.KeyedHasher)
      .toConstantValue(hasher);
    container
      .bind<ApiKeySecretGenerator>(PUBLIC_API_TYPES.ApiKeySecretGenerator)
      .to(CryptoApiKeySecretGenerator);

    const generator = container.get<ApiKeySecretGenerator>(
      PUBLIC_API_TYPES.ApiKeySecretGenerator,
    );
    const { plain, hash } = await generator.generate();

    expect(hash).toBe(await hasher.hash(API_KEY_HASH_PURPOSE, plain));
  });
});
