import {
  createKeyedHasher,
  type KeyedHasher,
} from '../../../../lib/core/crypto/keyed-hasher.ts';
import { hashRateLimitKey } from '../../../../lib/core/rate-limit/rate-limit-key.ts';
import { bindingRateLimit } from '../../../../lib/workers/rate-limit/binding-rate-limit.ts';
import { UNKNOWN_CLIENT_IP } from '../../../../lib/workers/rate-limit/ip-rate-limit.ts';
import { PUBLIC_API_IP_RATE_LIMIT } from '../../../application/public-api/rate-limit-rules.ts';
import type { PublicRestRoutes } from '../public-api-app.ts';

export const PUBLIC_API_IP_RATE_LIMIT_KEY_PREFIX = 'public-api:';

const PREFLIGHT_METHOD = 'OPTIONS';

type HasherForPepper = (pepper: string) => KeyedHasher;

// 公開APIの全ての要求に掛かるため、鍵の読み込みを要求ごとに繰り返さないよう、最後に使ったペッパーの部品だけを要求をまたいで使い回す
function reuseHasherWhilePepperUnchanged(): HasherForPepper {
  let latest:
    { readonly pepper: string; readonly hasher: KeyedHasher } | undefined;
  return (pepper) => {
    if (latest?.pepper !== pepper) {
      latest = { pepper, hasher: createKeyedHasher(pepper) };
    }
    return latest.hasher;
  };
}

export const publicApiIpRateLimitRoutes: PublicRestRoutes<Env> = (api) => {
  const hasherFor = reuseHasherWhilePepperUnchanged();
  api.use(
    '*',
    bindingRateLimit<Env>({
      binding: (env) => env.PUBLIC_API_RATE_LIMITER,
      key: (_, clientIp, env) =>
        hashRateLimitKey(
          hasherFor(env.HASH_PEPPER),
          `${PUBLIC_API_IP_RATE_LIMIT_KEY_PREFIX}${clientIp ?? UNKNOWN_CLIENT_IP}`,
        ),
      periodSeconds: PUBLIC_API_IP_RATE_LIMIT.periodSeconds,
      exclusions: [(request) => request.method === PREFLIGHT_METHOD],
    }),
  );
};
