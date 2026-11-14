import { resetSync } from '@logtape/logtape';
import { env } from 'cloudflare:workers';
import { Container } from 'inversify';
import { afterEach, describe, expect, test } from 'vitest';

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
import { ensureLoggingConfigured } from '../../../lib/workers/logging/configure-logging.ts';
import {
  createRateLimitCounterClient,
  type RateLimitCounterClient,
} from '../../../lib/workers/rate-limit/rate-limit-counter-client.ts';
import { INQUIRY_TYPES } from '../../application/inquiry/inquiry-types.ts';
import type { GuestInquiryRateLimit } from '../../application/inquiry/ports.ts';
import {
  CounterGuestInquiryRateLimit,
  GUEST_INQUIRY_RATE_RULE,
} from './counter-guest-inquiry-rate-limit.ts';

const NOW = new Date('2027-04-01T09:00:00.000Z');

const SECONDS_PER_HOUR = 3600;

const CLIENT_IP = '192.0.2.10';

const LOG_CATEGORY = 'api.inquiry.guest-rate-limit';

const hasher = createKeyedHasher(
  'test-pepper-for-counter-guest-inquiry-rate-limit',
);

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

interface Hit {
  readonly rule: CounterRule;
  readonly key: HashedRateLimitKey;
}

interface FakeCounters {
  readonly client: RateLimitCounterClient;
  readonly hits: Hit[];
}

// キーごとの回数を数え、規則の上限を超えた回だけ拒否を返す偽の厳密カウンタ
function createFakeCounters(): FakeCounters {
  const hits: Hit[] = [];
  const counts = new Map<string, number>();
  const real = createRateLimitCounterClient(env.RATE_LIMIT_COUNTER);
  const resetAt = NOW.getTime() + GUEST_INQUIRY_RATE_RULE.windowSeconds * 1000;
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
      reset: () => Promise.reject(new Error('送信回数の制限では使わない')),
      assertWithinLimit: (decision, now) => {
        real.assertWithinLimit(decision, now);
      },
    },
  };
}

function configureRecordingLogs(): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (...args: unknown[]) => {
    logs.push(args[0] as LoggedObject);
  };
  const methods: Record<ConsoleMethod, typeof record> = {
    trace: record,
    debug: record,
    info: record,
    warn: record,
    error: record,
  };
  ensureLoggingConfigured({
    appName: 'api',
    level: 'debug',
    console: methods as unknown as Console,
  });
  return logs;
}

const limitLogs = (logs: readonly LoggedObject[]): LoggedObject[] =>
  logs.filter((log) => log.category === LOG_CATEGORY);

async function caught(action: Promise<void>): Promise<unknown> {
  try {
    await action;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

afterEach(() => {
  resetSync();
});

describe('CounterGuestInquiryRateLimit', () => {
  test('規則は送信元IPアドレスごとに1時間に5回である', () => {
    expect(GUEST_INQUIRY_RATE_RULE).toEqual({
      name: 'inquiry-guest:ip',
      limit: 5,
      windowSeconds: SECONDS_PER_HOUR,
    });
    expect(Object.isFrozen(GUEST_INQUIRY_RATE_RULE)).toBe(true);
  });

  test('送信元IPアドレスの送信をinquiry-guest:ipの規則で1回数える', async () => {
    const counters = createFakeCounters();
    const limit = new CounterGuestInquiryRateLimit(counters.client, hasher);

    await limit.consume(CLIENT_IP, NOW);

    expect(counters.hits.map(({ rule }) => rule)).toEqual([
      GUEST_INQUIRY_RATE_RULE,
    ]);
  });

  test('キーは用途と送信元IPアドレスをHMACでハッシュ化した値だけにする', async () => {
    const counters = createFakeCounters();
    const limit = new CounterGuestInquiryRateLimit(counters.client, hasher);

    await limit.consume(CLIENT_IP, NOW);

    expect(counters.hits.map(({ key }) => key)).toEqual([
      await hashRateLimitKey(hasher, 'inquiry-guest', CLIENT_IP),
    ]);
    expect(JSON.stringify(counters.hits)).not.toContain(CLIENT_IP);
  });

  test('5回までは受け付け、6回目を429と再送までの秒数で拒否する', async () => {
    const counters = createFakeCounters();
    const limit = new CounterGuestInquiryRateLimit(counters.client, hasher);

    for (let sent = 0; sent < 5; sent += 1) {
      await limit.consume(CLIENT_IP, NOW);
    }
    const error = await caught(
      limit.consume(CLIENT_IP, new Date(NOW.getTime() + 600_000)),
    );

    expect(error).toBeInstanceOf(AppError);
    const response = toErrorResponse(error as AppError);
    expect(response.status).toBe(429);
    expect(response.headers['Retry-After']).toBe('3000');
    expect(response.body.error).toEqual({
      code: 'rate_limit_exceeded',
      message: '操作が集中しています。しばらく待ってから再度お試しください。',
    });
  });

  test('別の送信元IPアドレスの送信は別に数える', async () => {
    const counters = createFakeCounters();
    const limit = new CounterGuestInquiryRateLimit(counters.client, hasher);

    for (let sent = 0; sent < 5; sent += 1) {
      await limit.consume(CLIENT_IP, NOW);
    }

    await expect(limit.consume('192.0.2.11', NOW)).resolves.toBeUndefined();
  });

  test.each([
    ['不明', undefined],
    ['空文字列', ''],
  ])(
    '送信元IPアドレスが%sなら数えずに、IPアドレスを含まない警告を1件残す',
    async (_label, clientIp) => {
      const logs = configureRecordingLogs();
      const counters = createFakeCounters();
      const limit = new CounterGuestInquiryRateLimit(counters.client, hasher);

      await limit.consume(clientIp, NOW);

      expect(counters.hits).toEqual([]);
      expect(limitLogs(logs)).toMatchObject([
        { level: 'warning', reason: 'guest-inquiry-ip-missing' },
      ]);
    },
  );

  test('数えた送信ではログを残さない', async () => {
    const logs = configureRecordingLogs();
    const counters = createFakeCounters();
    const limit = new CounterGuestInquiryRateLimit(counters.client, hasher);

    await limit.consume(CLIENT_IP, NOW);

    expect(limitLogs(logs)).toEqual([]);
  });

  test('実物の厳密カウンタで、同じ送信元IPアドレスの6回目の送信を拒否する', async () => {
    const counters = createRateLimitCounterClient(env.RATE_LIMIT_COUNTER);
    const limit = new CounterGuestInquiryRateLimit(counters, hasher);
    const clientIp = `2001:db8::${crypto.randomUUID().slice(0, 4)}`;

    // 厳密カウンタの期間はDurable Objectの時計で始まるため、要求のたびにその時点の時刻を渡す
    for (let sent = 0; sent < 5; sent += 1) {
      await limit.consume(clientIp, new Date());
    }
    const error = await caught(limit.consume(clientIp, new Date()));

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
      .bind<GuestInquiryRateLimit>(INQUIRY_TYPES.GuestInquiryRateLimit)
      .to(CounterGuestInquiryRateLimit);

    const limit = container.get<GuestInquiryRateLimit>(
      INQUIRY_TYPES.GuestInquiryRateLimit,
    );
    await limit.consume(CLIENT_IP, NOW);

    expect(counters.hits).toHaveLength(1);
  });
});
