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
import { IDENTITY_TYPES } from '../../application/identity/identity-types.ts';
import type {
  LimitedMailKind,
  MailSendLimits,
} from '../../application/identity/ports.ts';
import type { RequestMeta } from '../../application/identity/request-meta.ts';
import { CounterMailSendLimits } from './counter-mail-send-limits.ts';

const NOW = new Date('2026-11-02T03:04:05.678Z');

const SECONDS_PER_HOUR = 3600;

const ADDRESS = 'Taro.Yamada@Mail.EXAMPLE';

const CLIENT_IP = '192.0.2.10';

const hasher = createKeyedHasher('test-pepper-for-counter-mail-send-limits');

interface Hit {
  readonly rule: CounterRule;
  readonly key: HashedRateLimitKey;
}

interface FakeCounters {
  readonly client: RateLimitCounterClient;
  readonly hits: Hit[];
}

// 規則の名前ごとに、その回の判定を差し替えられる偽の厳密カウンタ
function createFakeCounters(
  decide: (rule: CounterRule, count: number) => CounterDecision = (
    rule,
    count,
  ) => ({
    allowed: true,
    count,
    remaining: rule.limit - count,
    resetAt: NOW.getTime() + rule.windowSeconds * 1000,
  }),
): FakeCounters {
  const hits: Hit[] = [];
  const counts = new Map<string, number>();
  const real = createRateLimitCounterClient(env.RATE_LIMIT_COUNTER);
  return {
    hits,
    client: {
      hit(rule, key) {
        hits.push({ rule, key });
        const name = `${rule.name}:${key}`;
        const count = (counts.get(name) ?? 0) + 1;
        counts.set(name, count);
        return Promise.resolve(decide(rule, count));
      },
      reset: () => Promise.reject(new Error('送信回数の制限では使わない')),
      assertWithinLimit: (decision, now) => {
        real.assertWithinLimit(decision, now);
      },
    },
  };
}

function rejectedAfter(seconds: number): CounterDecision {
  return {
    allowed: false,
    count: 3,
    remaining: 0,
    resetAt: NOW.getTime() + seconds * 1000,
  };
}

function allowed(rule: CounterRule): CounterDecision {
  return {
    allowed: true,
    count: 1,
    remaining: rule.limit - 1,
    resetAt: NOW.getTime() + rule.windowSeconds * 1000,
  };
}

function metaWith(clientIp: string | undefined): RequestMeta {
  return { clientIp, userAgent: 'Mozilla/5.0', now: NOW };
}

async function keyOf(hashing: KeyedHasher, value: string) {
  return hashRateLimitKey(hashing, value);
}

async function caught(action: Promise<void>): Promise<unknown> {
  try {
    await action;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

describe('CounterMailSendLimits', () => {
  test.each<LimitedMailKind>([
    'email_verification',
    'email_change',
    'password_reset',
  ])(
    '%sの送信を、宛先は1時間に3回・IPアドレスは1時間に5回の2つの規則で数える',
    async (kind) => {
      const counters = createFakeCounters();
      const limits = new CounterMailSendLimits(counters.client, hasher);

      await limits.consume(kind, ADDRESS, metaWith(CLIENT_IP));

      expect(counters.hits.map(({ rule }) => rule)).toEqual([
        {
          name: `auth-mail:${kind}:address`,
          limit: 3,
          windowSeconds: SECONDS_PER_HOUR,
        },
        {
          name: `auth-mail:${kind}:ip`,
          limit: 5,
          windowSeconds: SECONDS_PER_HOUR,
        },
      ]);
    },
  );

  test('キーは前後の空白を除いて小文字にした宛先とIPアドレスをハッシュ化した値だけにする', async () => {
    const counters = createFakeCounters();
    const limits = new CounterMailSendLimits(counters.client, hasher);

    await limits.consume(
      'email_verification',
      `  ${ADDRESS} `,
      metaWith(CLIENT_IP),
    );

    expect(counters.hits.map(({ key }) => key)).toEqual([
      await keyOf(hasher, 'taro.yamada@mail.example'),
      await keyOf(hasher, CLIENT_IP),
    ]);
    const serialized = JSON.stringify(counters.hits);
    expect(serialized.toLowerCase()).not.toContain('taro.yamada');
    expect(serialized).not.toContain(CLIENT_IP);
  });

  test('大文字小文字の違う同じ宛先は同じキーで数える', async () => {
    const counters = createFakeCounters();
    const limits = new CounterMailSendLimits(counters.client, hasher);

    await limits.consume('password_reset', ADDRESS, metaWith(undefined));
    await limits.consume(
      'password_reset',
      ADDRESS.toLowerCase(),
      metaWith(undefined),
    );

    const [first, second] = counters.hits;
    expect(first?.key).toBe(second?.key);
  });

  test.each([
    ['不明', undefined],
    ['空文字列', ''],
  ])(
    'IPアドレスが%sならIPアドレスの規則を省き、宛先だけで数える',
    async (_label, clientIp) => {
      const counters = createFakeCounters();
      const limits = new CounterMailSendLimits(counters.client, hasher);

      await limits.consume('email_change', ADDRESS, metaWith(clientIp));

      expect(counters.hits.map(({ rule }) => rule.name)).toEqual([
        'auth-mail:email_change:address',
      ]);
    },
  );

  test('上限の内なら例外を投げない', async () => {
    const counters = createFakeCounters();
    const limits = new CounterMailSendLimits(counters.client, hasher);

    await expect(
      limits.consume('email_verification', ADDRESS, metaWith(CLIENT_IP)),
    ).resolves.toBeUndefined();
  });

  test.each([
    ['宛先', 'address'],
    ['IPアドレス', 'ip'],
  ])(
    '%sの規則だけが超過しても、両方を数えてから429と待ち時間を返す',
    async (_label, exceeded) => {
      const counters = createFakeCounters((rule) =>
        rule.name.endsWith(`:${exceeded}`)
          ? rejectedAfter(1200)
          : allowed(rule),
      );
      const limits = new CounterMailSendLimits(counters.client, hasher);

      const error = await caught(
        limits.consume('email_verification', ADDRESS, metaWith(CLIENT_IP)),
      );

      expect(counters.hits).toHaveLength(2);
      expect(error).toBeInstanceOf(AppError);
      const response = toErrorResponse(error as AppError);
      expect(response.status).toBe(429);
      expect(response.headers['Retry-After']).toBe('1200');
      expect(response.body.error).toEqual({
        code: 'rate_limit_exceeded',
        message: '操作が集中しています。しばらく待ってから再度お試しください。',
      });
    },
  );

  test('両方の規則が超過したら、待ち時間の長い方を返す', async () => {
    const counters = createFakeCounters((rule) =>
      rule.name.endsWith(':address') ? rejectedAfter(600) : rejectedAfter(3000),
    );
    const limits = new CounterMailSendLimits(counters.client, hasher);

    const error = await caught(
      limits.consume('password_reset', ADDRESS, metaWith(CLIENT_IP)),
    );

    expect(toErrorResponse(error as AppError).headers['Retry-After']).toBe(
      '3000',
    );
  });

  test('実物の厳密カウンタで、同じ宛先への4回目の送信を拒否する', async () => {
    const counters = createRateLimitCounterClient(env.RATE_LIMIT_COUNTER);
    const limits = new CounterMailSendLimits(counters, hasher);
    const address = `user-${crypto.randomUUID()}@mail.example`;
    // 厳密カウンタの期間はDurable Objectの時計で始まるため、要求のたびにその時点の時刻を渡す
    const meta = (): RequestMeta => ({
      clientIp: undefined,
      userAgent: undefined,
      now: new Date(),
    });

    for (let sent = 0; sent < 3; sent += 1) {
      await limits.consume('email_verification', address, meta());
    }
    const error = await caught(
      limits.consume('email_verification', address, meta()),
    );

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
      .bind<MailSendLimits>(IDENTITY_TYPES.MailSendLimits)
      .to(CounterMailSendLimits);

    const limits = container.get<MailSendLimits>(IDENTITY_TYPES.MailSendLimits);
    await limits.consume('email_verification', ADDRESS, metaWith(CLIENT_IP));

    expect(counters.hits).toHaveLength(2);
  });
});
