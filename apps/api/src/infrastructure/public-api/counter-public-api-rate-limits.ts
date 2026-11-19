import { inject, injectable } from 'inversify';

import type { KeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { hashRateLimitKey } from '../../../lib/core/rate-limit/rate-limit-key.ts';
import type { RateLimitCounterClient } from '../../../lib/workers/rate-limit/rate-limit-counter-client.ts';
import type {
  PublicApiRateLimits,
  PublicApiRateLimitStatus,
} from '../../application/public-api/ports.ts';
import { PublicApiRateLimitError } from '../../application/public-api/public-api-rate-limit-error.ts';
import {
  API_KEY_ISSUE_RULE,
  ruleForAccess,
} from '../../application/public-api/rate-limit-rules.ts';
import type { ApiAccess } from '../../domain/public-api/api-key-scopes.ts';

const MILLISECONDS_PER_SECOND = 1000;

// RateLimitCounterClient.assertWithinLimitと同じ秒数にし、429の応答のRetry-Afterを発行と要求で揃える
function secondsUntilReset(resetAt: number, now: number): number {
  return Math.max(0, Math.ceil((resetAt - now) / MILLISECONDS_PER_SECOND));
}

@injectable()
export class CounterPublicApiRateLimits implements PublicApiRateLimits {
  constructor(
    @inject(PLATFORM_TYPES.RateLimitCounterClient)
    private readonly counters: RateLimitCounterClient,
    @inject(PLATFORM_TYPES.KeyedHasher)
    private readonly hasher: KeyedHasher,
  ) {}

  async consumeIssue(userId: string, now: Date): Promise<void> {
    const key = await hashRateLimitKey(this.hasher, userId);
    const decision = await this.counters.hit(API_KEY_ISSUE_RULE, key);
    this.counters.assertWithinLimit(decision, now.getTime());
  }

  // CounterDecisionは上限を持たないため、上限は規則から取る
  async consumeRequest(
    userId: string,
    access: ApiAccess,
    now: Date,
  ): Promise<PublicApiRateLimitStatus> {
    const rule = ruleForAccess(access);
    const key = await hashRateLimitKey(this.hasher, userId);
    const decision = await this.counters.hit(rule, key);
    const status: PublicApiRateLimitStatus = {
      limit: rule.limit,
      remaining: decision.remaining,
      resetAt: decision.resetAt,
    };
    if (!decision.allowed) {
      throw new PublicApiRateLimitError({
        rateLimit: status,
        retryAfterSeconds: secondsUntilReset(decision.resetAt, now.getTime()),
      });
    }
    return status;
  }
}
