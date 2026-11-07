import { env } from 'cloudflare:workers';
import { Container } from 'inversify';
import { describe, expect, test } from 'vitest';

import {
  createKeyedHasher,
  type KeyedHasher,
} from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { toErrorResponse } from '../../../lib/core/errors/error-envelope.ts';
import type {
  CounterDecision,
  CounterRule,
} from '../../../lib/core/rate-limit/fixed-window.ts';
import {
  type HashedRateLimitKey,
  hashRateLimitKey,
} from '../../../lib/core/rate-limit/rate-limit-key.ts';
import {
  createRateLimitCounterClient,
  type RateLimitCounterClient,
} from '../../../lib/workers/rate-limit/rate-limit-counter-client.ts';
import type { PortalSessionLimits } from '../../application/ultras/portal-ports.ts';
import { API_ULTRAS_TYPES } from '../../application/ultras/ultras-types.ts';
import {
  CounterPortalSessionLimits,
  PORTAL_SESSION_RULE,
} from './counter-portal-session-limits.ts';

const NOW = new Date('2027-04-01T09:00:00.000Z');

const SECONDS_PER_HOUR = 3600;

const USER_ID = '01JD0000000000000000USER01';

const hasher = createKeyedHasher(
  'test-pepper-for-counter-portal-session-limits',
);

interface Hit {
  readonly rule: CounterRule;
  readonly key: HashedRateLimitKey;
}

// キーごとの回数を数え、規則の上限を超えた回だけ拒否を返す偽の厳密カウンタ
function createFakeCounters(): {
  readonly client: RateLimitCounterClient;
  readonly hits: Hit[];
} {
  const hits: Hit[] = [];
  const counts = new Map<string, number>();
  const real = createRateLimitCounterClient(env.RATE_LIMIT_COUNTER);
  const resetAt = NOW.getTime() + PORTAL_SESSION_RULE.windowSeconds * 1000;
  return {
    hits,
    client: {
      hit(rule, key): Promise<CounterDecision> {
        hits.push({ rule, key });
        const name = `${rule.name}:${key}`;
        const count = (counts.get(name) ?? 0) + 1;
        if (count > rule.limit) {
          return Promise.resolve({
            allowed: false,
            count: rule.limit,
            remaining: 0,
            resetAt,
          });
        }
        counts.set(name, count);
        return Promise.resolve({
          allowed: true,
          count,
          remaining: rule.limit - count,
          resetAt,
        });
      },
      reset: () =>
        Promise.reject(new Error('Customer Portalの回数制限では使わない')),
      assertWithinLimit: (decision, now) => {
        real.assertWithinLimit(decision, now);
      },
    },
  };
}

async function caught(action: Promise<void>): Promise<unknown> {
  try {
    await action;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

describe('CounterPortalSessionLimits', () => {
  test('規則は利用者ごとに1時間に20回である', () => {
    expect(PORTAL_SESSION_RULE).toEqual({
      name: 'ultras-portal:user',
      limit: 20,
      windowSeconds: SECONDS_PER_HOUR,
    });
    expect(Object.isFrozen(PORTAL_SESSION_RULE)).toBe(true);
  });

  test('Customer Portalを開く操作を利用者のIDのハッシュをキーにultras-portal:userの規則で1回数える', async () => {
    const counters = createFakeCounters();
    const limits = new CounterPortalSessionLimits(counters.client, hasher);

    await limits.consume(USER_ID, NOW);

    expect(counters.hits).toEqual([
      {
        rule: PORTAL_SESSION_RULE,
        key: await hashRateLimitKey(hasher, USER_ID),
      },
    ]);
    expect(JSON.stringify(counters.hits)).not.toContain(USER_ID);
  });

  test('20回までは受け付け、21回目を429と待つ秒数で拒否する', async () => {
    const counters = createFakeCounters();
    const limits = new CounterPortalSessionLimits(counters.client, hasher);

    for (let opened = 0; opened < 20; opened += 1) {
      await limits.consume(USER_ID, NOW);
    }
    const error = await caught(
      limits.consume(USER_ID, new Date(NOW.getTime() + 600_000)),
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).retryAfterSeconds).toBe(3000);
    const response = toErrorResponse(error as AppError);
    expect(response.status).toBe(429);
    expect(response.headers['Retry-After']).toBe('3000');
    expect(response.body.error).toEqual({
      code: 'rate_limit_exceeded',
      message: '操作が集中しています。しばらく待ってから再度お試しください。',
    });
  });

  test('別の利用者のCustomer Portalを開く操作は別に数える', async () => {
    const counters = createFakeCounters();
    const limits = new CounterPortalSessionLimits(counters.client, hasher);

    for (let opened = 0; opened < 20; opened += 1) {
      await limits.consume(USER_ID, NOW);
    }

    await expect(
      limits.consume('01JD0000000000000000USER02', NOW),
    ).resolves.toBeUndefined();
  });

  test('実物の厳密カウンタで、同じ利用者の21回目のCustomer Portalを開く操作を拒否する', async () => {
    const counters = createRateLimitCounterClient(env.RATE_LIMIT_COUNTER);
    const limits = new CounterPortalSessionLimits(counters, hasher);
    const userId = `01JD${crypto.randomUUID().replaceAll('-', '').slice(0, 22)}`;

    // 厳密カウンタの期間はDurable Objectの時計で始まるため、要求のたびにその時点の時刻を渡す
    for (let opened = 0; opened < 20; opened += 1) {
      await limits.consume(userId, new Date());
    }
    const error = await caught(limits.consume(userId, new Date()));

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('rate_limited');
    expect((error as AppError).retryAfterSeconds).toBeGreaterThan(0);
    expect((error as AppError).retryAfterSeconds).toBeLessThanOrEqual(
      SECONDS_PER_HOUR,
    );
  });

  test('コンテナで厳密カウンタのクライアントとハッシュ化の部品を注入して解決できる', async () => {
    const counters = createFakeCounters();
    const container = new Container();
    container
      .bind<RateLimitCounterClient>(PLATFORM_TYPES.RateLimitCounterClient)
      .toConstantValue(counters.client);
    container
      .bind<KeyedHasher>(PLATFORM_TYPES.KeyedHasher)
      .toConstantValue(hasher);
    container
      .bind<PortalSessionLimits>(API_ULTRAS_TYPES.PortalSessionLimits)
      .to(CounterPortalSessionLimits);

    const limits = container.get<PortalSessionLimits>(
      API_ULTRAS_TYPES.PortalSessionLimits,
    );
    await limits.consume(USER_ID, NOW);

    expect(counters.hits).toHaveLength(1);
  });
});
