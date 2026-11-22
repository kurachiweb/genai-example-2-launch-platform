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
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  createRateLimitCounterClient,
  type RateLimitCounterClient,
} from '../../../lib/workers/rate-limit/rate-limit-counter-client.ts';
import type { DataExportRequestLimits } from '../../application/data-export/data-export-request-ports.ts';
import { DATA_EXPORT_TYPES } from '../../application/data-export/data-export-types.ts';
import {
  CounterDataExportRequestLimits,
  DATA_EXPORT_REQUEST_RULE,
} from './counter-data-export-request-limits.ts';

const NOW = new Date('2026-11-22T10:00:00.000Z');

const SECONDS_PER_DAY = 86_400;

const USER_ID = '01JE0DXUSER000000000000001';

const hasher = createKeyedHasher('test-pepper-for-counter-data-export-limits');

const clockAt = (now: Date): Clock => ({ now: () => now });

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
  const resetAt = NOW.getTime() + SECONDS_PER_DAY * 1000;
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
        Promise.reject(new Error('データエクスポートの回数制限では戻さない')),
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

describe('CounterDataExportRequestLimits', () => {
  test('規則は利用者ごとに24時間に3回である', () => {
    expect(DATA_EXPORT_REQUEST_RULE).toEqual({
      name: 'data-export-request',
      limit: 3,
      windowSeconds: SECONDS_PER_DAY,
    });
    expect(Object.isFrozen(DATA_EXPORT_REQUEST_RULE)).toBe(true);
  });

  test('利用者のIDのハッシュをキーにdata-export-requestの規則で1回数え、元のIDを渡さない', async () => {
    const counters = createFakeCounters();
    const limits = new CounterDataExportRequestLimits(
      counters.client,
      hasher,
      clockAt(NOW),
    );

    await limits.consume(USER_ID);

    expect(counters.hits).toEqual([
      {
        rule: DATA_EXPORT_REQUEST_RULE,
        key: await hashRateLimitKey(hasher, 'data-export', USER_ID),
      },
    ]);
    expect(JSON.stringify(counters.hits)).not.toContain(USER_ID);
  });

  test('3回までは受け付け、4回目を429のrate_limit_exceededと再試行の秒数で拒否する', async () => {
    const counters = createFakeCounters();
    const limits = new CounterDataExportRequestLimits(
      counters.client,
      hasher,
      clockAt(new Date(NOW.getTime() + 3_600_000)),
    );

    for (let requested = 0; requested < 3; requested += 1) {
      await limits.consume(USER_ID);
    }
    const error = await caught(limits.consume(USER_ID));

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('rate_limited');
    expect((error as AppError).retryAfterSeconds).toBe(SECONDS_PER_DAY - 3600);
    const response = toErrorResponse(error as AppError);
    expect(response.status).toBe(429);
    expect(response.headers['Retry-After']).toBe(
      String(SECONDS_PER_DAY - 3600),
    );
    expect(response.body.error.code).toBe('rate_limit_exceeded');
  });

  test('別の利用者の要求は別に数える', async () => {
    const counters = createFakeCounters();
    const limits = new CounterDataExportRequestLimits(
      counters.client,
      hasher,
      clockAt(NOW),
    );

    for (let requested = 0; requested < 3; requested += 1) {
      await limits.consume(USER_ID);
    }

    await expect(
      limits.consume('01JE0DXUSER000000000000002'),
    ).resolves.toBeUndefined();
  });

  test('実物の厳密カウンタで、同じ利用者の4回目の要求を拒否する', async () => {
    const counters = createRateLimitCounterClient(env.RATE_LIMIT_COUNTER);
    const limits = new CounterDataExportRequestLimits(counters, hasher, {
      now: () => new Date(),
    });
    const userId = `01JE${crypto.randomUUID().replaceAll('-', '').slice(0, 22)}`;

    for (let requested = 0; requested < 3; requested += 1) {
      await limits.consume(userId);
    }
    const error = await caught(limits.consume(userId));

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('rate_limited');
    expect((error as AppError).retryAfterSeconds).toBeGreaterThan(0);
    expect((error as AppError).retryAfterSeconds).toBeLessThanOrEqual(
      SECONDS_PER_DAY,
    );
  });

  test('コンテナで厳密カウンタ・ハッシュ化・時計を注入して解決できる', async () => {
    const counters = createFakeCounters();
    const container = new Container();
    container
      .bind<RateLimitCounterClient>(PLATFORM_TYPES.RateLimitCounterClient)
      .toConstantValue(counters.client);
    container
      .bind<KeyedHasher>(PLATFORM_TYPES.KeyedHasher)
      .toConstantValue(hasher);
    container.bind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(clockAt(NOW));
    container
      .bind<DataExportRequestLimits>(DATA_EXPORT_TYPES.DataExportRequestLimits)
      .to(CounterDataExportRequestLimits);

    const limits = container.get<DataExportRequestLimits>(
      DATA_EXPORT_TYPES.DataExportRequestLimits,
    );
    await limits.consume(USER_ID);

    expect(counters.hits).toHaveLength(1);
  });
});
