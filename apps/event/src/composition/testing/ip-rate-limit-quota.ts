import { env } from 'cloudflare:workers';

import { createKeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { hashRateLimitKey } from '../../../lib/core/rate-limit/rate-limit-key.ts';
import { IP_RATE_LIMIT_KEY_PREFIX } from '../../../lib/workers/rate-limit/ip-rate-limit.ts';

// エントリを通した要求で上限の回数を送ると、テストの同時実行の負荷で制限の期間の内に送り切れないため、エントリと同じキーでバインディングを直に呼んで回数を使う
export async function consumeIpRateLimit(
  ip: string,
  count: number,
): Promise<void> {
  const key = await hashRateLimitKey(
    createKeyedHasher(env.HASH_PEPPER),
    `${IP_RATE_LIMIT_KEY_PREFIX}${ip}`,
  );
  for (let consumed = 0; consumed < count; consumed += 1) {
    await env.IP_RATE_LIMITER.limit({ key });
  }
}
