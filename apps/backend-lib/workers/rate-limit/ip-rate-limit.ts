import type { MiddlewareHandler } from 'hono';

import { bindingRateLimit } from './binding-rate-limit.ts';
import type { RateLimitExclusion } from './exclusions.ts';

export const IP_RATE_LIMIT_KEY_PREFIX = 'ip:';
export const UNKNOWN_CLIENT_IP = 'unknown';

const IP_RATE_LIMIT_PERIOD_SECONDS = 10;

export function ipRateLimit<E extends { readonly IP_RATE_LIMITER: RateLimit }>(
  exclusions: readonly RateLimitExclusion<E>[],
): MiddlewareHandler {
  return bindingRateLimit<E>({
    binding: (env) => env.IP_RATE_LIMITER,
    key: (_, clientIp) =>
      `${IP_RATE_LIMIT_KEY_PREFIX}${clientIp ?? UNKNOWN_CLIENT_IP}`,
    periodSeconds: IP_RATE_LIMIT_PERIOD_SECONDS,
    exclusions,
  });
}
