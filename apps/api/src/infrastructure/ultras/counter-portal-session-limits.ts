import { inject, injectable } from 'inversify';

import type { KeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { CounterRule } from '../../../lib/core/rate-limit/fixed-window.ts';
import { hashRateLimitKey } from '../../../lib/core/rate-limit/rate-limit-key.ts';
import type { RateLimitCounterClient } from '../../../lib/workers/rate-limit/rate-limit-counter-client.ts';
import type { PortalSessionLimits } from '../../application/ultras/portal-ports.ts';

export const PORTAL_SESSION_RULE = Object.freeze({
  name: 'ultras-portal:user',
  limit: 20,
  windowSeconds: 3600,
} as const satisfies CounterRule);

@injectable()
export class CounterPortalSessionLimits implements PortalSessionLimits {
  constructor(
    @inject(PLATFORM_TYPES.RateLimitCounterClient)
    private readonly counters: RateLimitCounterClient,
    @inject(PLATFORM_TYPES.KeyedHasher)
    private readonly hasher: KeyedHasher,
  ) {}

  async consume(userId: string, now: Date): Promise<void> {
    const key = await hashRateLimitKey(this.hasher, userId);
    const decision = await this.counters.hit(PORTAL_SESSION_RULE, key);
    this.counters.assertWithinLimit(decision, now.getTime());
  }
}
