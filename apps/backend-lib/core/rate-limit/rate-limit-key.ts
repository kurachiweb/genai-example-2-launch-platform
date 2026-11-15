import { hashPurpose, type KeyedHasher } from '../crypto/keyed-hasher.ts';

export type HashedRateLimitKey = string & {
  readonly __brand: 'HashedRateLimitKey';
};

const RATE_LIMIT_KEY_PURPOSE = hashPurpose('rate-limit-key');

export async function hashRateLimitKey(
  hasher: KeyedHasher,
  ...parts: readonly string[]
): Promise<HashedRateLimitKey> {
  if (parts.length === 0) {
    throw new RangeError('レート制限のキーには1つ以上の部品が必要です。');
  }
  // 部品の境界を残して連結し、("ab","c")と("a","bc")のような組み合わせが同じキーにならないようにする
  const encodedParts = JSON.stringify(parts);
  const hash = await hasher.hash(RATE_LIMIT_KEY_PURPOSE, encodedParts);
  return hash as HashedRateLimitKey;
}
