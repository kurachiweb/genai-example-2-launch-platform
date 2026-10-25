import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import { createKeyedHasher } from '../../core/crypto/keyed-hasher.ts';
import { AppError } from '../../core/errors/app-error.ts';
import { toErrorResponse } from '../../core/errors/error-envelope.ts';
import type {
  CounterDecision,
  CounterRule,
} from '../../core/rate-limit/fixed-window.ts';
import {
  type HashedRateLimitKey,
  hashRateLimitKey,
} from '../../core/rate-limit/rate-limit-key.ts';
import type { RateLimitCounter } from './rate-limit-counter.ts';
import { createRateLimitCounterClient } from './rate-limit-counter-client.ts';

const hasher = createKeyedHasher('test-pepper-for-rate-limit-counter-client');

const RESEND_RULE: CounterRule = {
  name: 'email-resend-by-address',
  limit: 2,
  windowSeconds: 60,
};

// eventの実行時の環境の型には厳密カウンタのバインディングが無いため、型を名前で引かず実物を確かめて取り出す
function isCounterNamespace(
  value: unknown,
): value is DurableObjectNamespace<RateLimitCounter> {
  return typeof value === 'object' && value !== null && 'idFromName' in value;
}

function counterNamespace(): DurableObjectNamespace<RateLimitCounter> {
  const source: object = env;
  const binding: unknown = Reflect.get(source, 'RATE_LIMIT_COUNTER');
  if (!isCounterNamespace(binding)) {
    throw new Error('RATE_LIMIT_COUNTERのバインディングがありません。');
  }
  return binding;
}

async function keyOf(...parts: readonly string[]): Promise<HashedRateLimitKey> {
  return hashRateLimitKey(hasher, ...parts);
}

async function storedEntries(
  name: string,
): Promise<readonly (readonly [string, unknown])[]> {
  const namespace = counterNamespace();
  const stub = namespace.get(namespace.idFromName(name));
  return runInDurableObject(stub, (_instance, state) => [
    ...state.storage.kv.list(),
  ]);
}

function catchError(action: () => void): unknown {
  try {
    action();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

function rejectedDecision(resetAt: number): CounterDecision {
  return { allowed: false, count: 2, remaining: 0, resetAt };
}

describe('createRateLimitCounterClient', () => {
  test('ルール名とハッシュ化済みキーを連結した名前のオブジェクトで数え、元の値を保存しない', async () => {
    const client = createRateLimitCounterClient(counterNamespace());
    const key = await keyOf('email', 'user@launch.example');

    const decision = await client.hit(RESEND_RULE, key);
    const entries = await storedEntries(`${RESEND_RULE.name}:${key}`);

    expect(decision).toMatchObject({ allowed: true, count: 1, remaining: 1 });
    expect(entries).toStrictEqual([
      [
        'window',
        {
          count: 1,
          windowStartedAt: decision.resetAt - 60_000,
          windowSeconds: 60,
        },
      ],
    ]);
    expect(JSON.stringify(entries)).not.toContain('user@launch.example');
  });

  test('キーとルール名が違えば別々に数える', async () => {
    const client = createRateLimitCounterClient(counterNamespace());
    const key = await keyOf('ip', '203.0.113.51');
    const otherKey = await keyOf('ip', '203.0.113.52');
    const otherRule: CounterRule = { ...RESEND_RULE, name: 'another-rule' };

    await client.hit(RESEND_RULE, key);
    const second = await client.hit(RESEND_RULE, key);
    const otherKeyDecision = await client.hit(RESEND_RULE, otherKey);
    const otherRuleDecision = await client.hit(otherRule, key);

    expect(second.count).toBe(2);
    expect(otherKeyDecision.count).toBe(1);
    expect(otherRuleDecision.count).toBe(1);
  });

  test('リセットで同じルール名とキーの回数を期間の途中でも0に戻す', async () => {
    const client = createRateLimitCounterClient(counterNamespace());
    const key = await keyOf('ip', '203.0.113.61');
    await client.hit(RESEND_RULE, key);
    await client.hit(RESEND_RULE, key);

    await client.reset({ name: RESEND_RULE.name }, key);
    const entries = await storedEntries(`${RESEND_RULE.name}:${key}`);
    const next = await client.hit(RESEND_RULE, key);

    expect(entries).toStrictEqual([]);
    expect(next).toMatchObject({ allowed: true, count: 1 });
  });

  test('上限内の判定では例外を投げない', () => {
    const client = createRateLimitCounterClient(counterNamespace());
    const decision: CounterDecision = {
      allowed: true,
      count: 1,
      remaining: 1,
      resetAt: 61_000,
    };

    expect(() => {
      client.assertWithinLimit(decision, 1_000);
    }).not.toThrow();
  });

  test('拒否の判定を残り秒数を切り上げた429・rate_limit_exceededの共通エラーに変える', async () => {
    const client = createRateLimitCounterClient(counterNamespace());
    const key = await keyOf('ip', '203.0.113.71');
    await client.hit(RESEND_RULE, key);
    await client.hit(RESEND_RULE, key);
    const rejected = await client.hit(RESEND_RULE, key);

    const error = catchError(() => {
      client.assertWithinLimit(rejected, rejected.resetAt - 12_001);
    });

    expect(rejected.allowed).toBe(false);
    expect(error).toBeInstanceOf(AppError);
    const response = toErrorResponse(error as AppError);
    expect(response.status).toBe(429);
    expect(response.headers['Retry-After']).toBe('13');
    expect(response.body).toStrictEqual({
      error: {
        code: 'rate_limit_exceeded',
        message: '操作が集中しています。しばらく待ってから再度お試しください。',
      },
    });
  });

  test('リセット予定時刻を過ぎた拒否の判定は再試行までの秒数を0にする', () => {
    const client = createRateLimitCounterClient(counterNamespace());

    const error = catchError(() => {
      client.assertWithinLimit(rejectedDecision(10_000), 10_500);
    });

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      kind: 'rate_limited',
      code: 'rate_limit_exceeded',
      retryAfterSeconds: 0,
    });
  });

  test('残り時間がちょうど整数秒なら切り上げずにその秒数にする', () => {
    const client = createRateLimitCounterClient(counterNamespace());

    const error = catchError(() => {
      client.assertWithinLimit(rejectedDecision(10_000), 7_000);
    });

    expect(error).toMatchObject({ retryAfterSeconds: 3 });
  });
});
