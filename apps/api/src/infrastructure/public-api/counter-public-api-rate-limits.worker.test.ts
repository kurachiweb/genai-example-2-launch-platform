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
import type { PublicApiRateLimits } from '../../application/public-api/ports.ts';
import { PublicApiRateLimitError } from '../../application/public-api/public-api-rate-limit-error.ts';
import { PUBLIC_API_TYPES } from '../../application/public-api/public-api-types.ts';
import {
  API_KEY_ISSUE_RULE,
  PUBLIC_API_READ_RULE,
  PUBLIC_API_WRITE_RULE,
} from '../../application/public-api/rate-limit-rules.ts';
import { CounterPublicApiRateLimits } from './counter-public-api-rate-limits.ts';

const NOW = new Date('2027-04-01T09:00:00.000Z');

const SECONDS_PER_HOUR = 3600;

const USER_ID = '01JD0000000000000000USER01';

const OTHER_USER_ID = '01JD0000000000000000USER02';

const RESET_OFFSET_MILLISECONDS = 45_500;

const hasher = createKeyedHasher(
  'test-pepper-for-counter-public-api-rate-limits',
);

interface Hit {
  readonly rule: CounterRule;
  readonly key: HashedRateLimitKey;
}

// キーごとの回数を数え、規則の上限を超えた回だけ拒否を返す偽の厳密カウンタ。リセットの時刻はNOWから固定の時間の後にする
function createFakeCounters(): {
  readonly client: RateLimitCounterClient;
  readonly hits: Hit[];
  readonly resetAt: number;
} {
  const hits: Hit[] = [];
  const counts = new Map<string, number>();
  const real = createRateLimitCounterClient(env.RATE_LIMIT_COUNTER);
  const resetAt = NOW.getTime() + RESET_OFFSET_MILLISECONDS;
  return {
    hits,
    resetAt,
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
      reset: () => Promise.reject(new Error('公開APIの回数の制限では使わない')),
      assertWithinLimit: (decision, now) => {
        real.assertWithinLimit(decision, now);
      },
    },
  };
}

async function caught(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

describe('CounterPublicApiRateLimits: 発行', () => {
  test('発行を利用者のIDのハッシュをキーにapi-key-issue-by-userの規則で1回数える', async () => {
    const counters = createFakeCounters();
    const limits = new CounterPublicApiRateLimits(counters.client, hasher);

    await limits.consumeIssue(USER_ID, NOW);

    expect(counters.hits).toEqual([
      {
        rule: API_KEY_ISSUE_RULE,
        key: await hashRateLimitKey(hasher, USER_ID),
      },
    ]);
    expect(JSON.stringify(counters.hits)).not.toContain(USER_ID);
  });

  test('3回までは受け付け、4回目を429と待つ秒数で拒否する', async () => {
    const counters = createFakeCounters();
    const limits = new CounterPublicApiRateLimits(counters.client, hasher);

    for (let issued = 0; issued < 3; issued += 1) {
      await expect(limits.consumeIssue(USER_ID, NOW)).resolves.toBeUndefined();
    }
    const error = await caught(
      limits.consumeIssue(USER_ID, new Date(NOW.getTime() + 5000)),
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).retryAfterSeconds).toBe(41);
    const response = toErrorResponse(error as AppError);
    expect(response.status).toBe(429);
    expect(response.headers['Retry-After']).toBe('41');
    expect(response.body.error).toEqual({
      code: 'rate_limit_exceeded',
      message: '操作が集中しています。しばらく待ってから再度お試しください。',
    });
  });

  test('別の利用者の発行は別に数える', async () => {
    const counters = createFakeCounters();
    const limits = new CounterPublicApiRateLimits(counters.client, hasher);

    for (let issued = 0; issued < 3; issued += 1) {
      await limits.consumeIssue(USER_ID, NOW);
    }

    await expect(
      limits.consumeIssue(OTHER_USER_ID, NOW),
    ).resolves.toBeUndefined();
  });

  test('実物の厳密カウンタで、同じ利用者の4回目の発行を拒否する', async () => {
    const counters = createRateLimitCounterClient(env.RATE_LIMIT_COUNTER);
    const limits = new CounterPublicApiRateLimits(counters, hasher);
    const userId = `01JD${crypto.randomUUID().replaceAll('-', '').slice(0, 22)}`;

    // 厳密カウンタの期間はDurable Objectの時計で始まるため、要求のたびにその時点の時刻を渡す
    for (let issued = 0; issued < 3; issued += 1) {
      await limits.consumeIssue(userId, new Date());
    }
    const error = await caught(limits.consumeIssue(userId, new Date()));

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('rate_limited');
    expect((error as AppError).retryAfterSeconds).toBeGreaterThan(0);
    expect((error as AppError).retryAfterSeconds).toBeLessThanOrEqual(
      SECONDS_PER_HOUR,
    );
  });
});

describe('CounterPublicApiRateLimits: 要求', () => {
  test.each([
    { access: 'read', rule: PUBLIC_API_READ_RULE },
    { access: 'write', rule: PUBLIC_API_WRITE_RULE },
  ] as const)(
    '$accessの要求を利用者のIDのハッシュをキーに$rule.nameの規則で1回数える',
    async ({ access, rule }) => {
      const counters = createFakeCounters();
      const limits = new CounterPublicApiRateLimits(counters.client, hasher);

      await limits.consumeRequest(USER_ID, access, NOW);

      expect(counters.hits).toEqual([
        { rule, key: await hashRateLimitKey(hasher, USER_ID) },
      ]);
      expect(JSON.stringify(counters.hits)).not.toContain(USER_ID);
    },
  );

  test('許可なら規則の上限・残り・エポックミリ秒のリセットの時刻を返す', async () => {
    const counters = createFakeCounters();
    const limits = new CounterPublicApiRateLimits(counters.client, hasher);

    await expect(limits.consumeRequest(USER_ID, 'read', NOW)).resolves.toEqual({
      limit: 30,
      remaining: 29,
      resetAt: counters.resetAt,
    });
    await expect(limits.consumeRequest(USER_ID, 'write', NOW)).resolves.toEqual(
      {
        limit: 15,
        remaining: 14,
        resetAt: counters.resetAt,
      },
    );
  });

  test.each([
    { access: 'read', rule: PUBLIC_API_READ_RULE },
    { access: 'write', rule: PUBLIC_API_WRITE_RULE },
  ] as const)(
    '$accessの上限を超えた要求を、同じ上限・残り・リセットの時刻と再試行の秒数を持つPublicApiRateLimitErrorで拒否する',
    async ({ access, rule }) => {
      const counters = createFakeCounters();
      const limits = new CounterPublicApiRateLimits(counters.client, hasher);
      for (let requested = 0; requested < rule.limit; requested += 1) {
        await limits.consumeRequest(USER_ID, access, NOW);
      }
      const now = new Date(NOW.getTime() + 2000);

      const error = await caught(limits.consumeRequest(USER_ID, access, now));

      expect(error).toBeInstanceOf(PublicApiRateLimitError);
      const rejected = error as PublicApiRateLimitError;
      expect(rejected.rateLimit).toEqual({
        limit: rule.limit,
        remaining: 0,
        resetAt: counters.resetAt,
      });
      const fromCounter = await caught(
        Promise.resolve().then(() => {
          counters.client.assertWithinLimit(
            {
              allowed: false,
              count: rule.limit,
              remaining: 0,
              resetAt: counters.resetAt,
            },
            now.getTime(),
          );
        }),
      );
      expect(rejected.retryAfterSeconds).toBe(44);
      expect(rejected.retryAfterSeconds).toBe(
        (fromCounter as AppError).retryAfterSeconds,
      );
      const response = toErrorResponse(rejected);
      expect(response.status).toBe(429);
      expect(response.headers['Retry-After']).toBe('44');
      expect(response.body.error.code).toBe('rate_limit_exceeded');
    },
  );

  test('読み取りと書き込みは別の規則で数え、読み取りの上限に達しても書き込みを受け付ける', async () => {
    const counters = createFakeCounters();
    const limits = new CounterPublicApiRateLimits(counters.client, hasher);
    for (let requested = 0; requested < 30; requested += 1) {
      await limits.consumeRequest(USER_ID, 'read', NOW);
    }

    await expect(
      limits.consumeRequest(USER_ID, 'write', NOW),
    ).resolves.toMatchObject({ limit: 15, remaining: 14 });
  });

  test('別の利用者の要求は別に数える', async () => {
    const counters = createFakeCounters();
    const limits = new CounterPublicApiRateLimits(counters.client, hasher);
    for (let requested = 0; requested < 30; requested += 1) {
      await limits.consumeRequest(USER_ID, 'read', NOW);
    }

    await expect(
      limits.consumeRequest(OTHER_USER_ID, 'read', NOW),
    ).resolves.toMatchObject({ limit: 30, remaining: 29 });
  });

  test('実物の厳密カウンタで、同じ利用者の16回目の書き込みの要求をPublicApiRateLimitErrorで拒否する', async () => {
    const counters = createRateLimitCounterClient(env.RATE_LIMIT_COUNTER);
    const limits = new CounterPublicApiRateLimits(counters, hasher);
    const userId = `01JD${crypto.randomUUID().replaceAll('-', '').slice(0, 22)}`;

    const first = await limits.consumeRequest(userId, 'write', new Date());
    for (let requested = 1; requested < 15; requested += 1) {
      await limits.consumeRequest(userId, 'write', new Date());
    }
    const error = await caught(
      limits.consumeRequest(userId, 'write', new Date()),
    );

    expect(first).toMatchObject({ limit: 15, remaining: 14 });
    expect(error).toBeInstanceOf(PublicApiRateLimitError);
    const rejected = error as PublicApiRateLimitError;
    expect(rejected.rateLimit).toEqual({
      limit: 15,
      remaining: 0,
      resetAt: first.resetAt,
    });
    expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
    expect(rejected.retryAfterSeconds).toBeLessThanOrEqual(60);
  });
});

describe('CounterPublicApiRateLimits: 注入', () => {
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
      .bind<PublicApiRateLimits>(PUBLIC_API_TYPES.PublicApiRateLimits)
      .to(CounterPublicApiRateLimits);

    const limits = container.get<PublicApiRateLimits>(
      PUBLIC_API_TYPES.PublicApiRateLimits,
    );
    await limits.consumeIssue(USER_ID, NOW);
    await limits.consumeRequest(USER_ID, 'read', NOW);

    expect(counters.hits).toHaveLength(2);
  });
});
