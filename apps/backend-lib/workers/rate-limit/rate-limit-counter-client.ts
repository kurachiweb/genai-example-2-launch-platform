import { AppError } from '../../core/errors/app-error.ts';
import type {
  CounterDecision,
  CounterRule,
} from '../../core/rate-limit/fixed-window.ts';
import type { HashedRateLimitKey } from '../../core/rate-limit/rate-limit-key.ts';
import type { RateLimitCounter } from './rate-limit-counter.ts';

export interface RateLimitCounterClient {
  hit(rule: CounterRule, key: HashedRateLimitKey): Promise<CounterDecision>;
  reset(
    rule: Pick<CounterRule, 'name'>,
    key: HashedRateLimitKey,
  ): Promise<void>;
  assertWithinLimit(decision: CounterDecision, now: number): void;
}

const RATE_LIMIT_EXCEEDED_CODE = 'rate_limit_exceeded';
const RATE_LIMIT_EXCEEDED_MESSAGE =
  '操作が集中しています。しばらく待ってから再度お試しください。';
const MILLISECONDS_PER_SECOND = 1000;

function secondsUntilReset(resetAt: number, now: number): number {
  return Math.max(0, Math.ceil((resetAt - now) / MILLISECONDS_PER_SECOND));
}

export function createRateLimitCounterClient(
  namespace: DurableObjectNamespace<RateLimitCounter>,
): RateLimitCounterClient {
  const counterFor = (
    ruleName: string,
    key: HashedRateLimitKey,
  ): DurableObjectStub<RateLimitCounter> =>
    namespace.get(namespace.idFromName(`${ruleName}:${key}`));

  return {
    async hit(rule, key) {
      return counterFor(rule.name, key).hit(rule);
    },
    async reset(rule, key) {
      await counterFor(rule.name, key).reset();
    },
    assertWithinLimit(decision, now) {
      if (decision.allowed) {
        return;
      }
      throw new AppError({
        kind: 'rate_limited',
        code: RATE_LIMIT_EXCEEDED_CODE,
        message: RATE_LIMIT_EXCEEDED_MESSAGE,
        retryAfterSeconds: secondsUntilReset(decision.resetAt, now),
      });
    },
  };
}
