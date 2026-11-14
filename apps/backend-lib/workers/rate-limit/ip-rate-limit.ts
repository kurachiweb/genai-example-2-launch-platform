import type { MiddlewareHandler } from 'hono';

import {
  createKeyedHasher,
  HasherConfigurationError,
  type KeyedHasher,
} from '../../core/crypto/keyed-hasher.ts';
import { hashRateLimitKey } from '../../core/rate-limit/rate-limit-key.ts';
import { bindingRateLimit } from './binding-rate-limit.ts';
import type { RateLimitExclusion } from './exclusions.ts';

export const IP_RATE_LIMIT_KEY_PREFIX = 'ip:';
export const UNKNOWN_CLIENT_IP = 'unknown';

const IP_RATE_LIMIT_PERIOD_SECONDS = 10;

interface IpRateLimitEnv {
  readonly IP_RATE_LIMITER: RateLimit;
  readonly HASH_PEPPER: string;
}

interface PepperedHasher {
  readonly pepper: string | undefined;
  readonly hasher: KeyedHasher;
}

type HasherForPepper = (pepper: string | undefined) => KeyedHasher | undefined;

function createHasherIfConfigured(
  pepper: string | undefined,
): KeyedHasher | undefined {
  try {
    return createKeyedHasher(pepper);
  } catch (error: unknown) {
    if (error instanceof HasherConfigurationError) {
      return undefined;
    }
    throw error;
  }
}

// 鍵の読み込みを要求ごとに繰り返さないよう、最後に使ったペッパーの部品だけを要求をまたいで使い回す
function reuseHasherWhilePepperUnchanged(): HasherForPepper {
  let latest: PepperedHasher | undefined;
  return (pepper) => {
    if (latest !== undefined && latest.pepper === pepper) {
      return latest.hasher;
    }
    const hasher = createHasherIfConfigured(pepper);
    if (hasher !== undefined) {
      latest = { pepper, hasher };
    }
    return hasher;
  };
}

// 環境の検証より前に動くため、ペッパーの無い環境では数えずに通し、ヘルスチェックの応答と後続の環境の検証に任せる
export function ipRateLimit<E extends IpRateLimitEnv>(
  exclusions: readonly RateLimitExclusion<E>[],
): MiddlewareHandler {
  const hasherFor = reuseHasherWhilePepperUnchanged();
  return bindingRateLimit<E>({
    binding: (env) => env.IP_RATE_LIMITER,
    key: async (_, clientIp, env) => {
      const hasher = hasherFor(env.HASH_PEPPER);
      if (hasher === undefined) {
        return undefined;
      }
      return hashRateLimitKey(
        hasher,
        `${IP_RATE_LIMIT_KEY_PREFIX}${clientIp ?? UNKNOWN_CLIENT_IP}`,
      );
    },
    periodSeconds: IP_RATE_LIMIT_PERIOD_SECONDS,
    exclusions,
  });
}
