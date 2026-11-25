import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { PublicApiRateLimitError } from './public-api-rate-limit-error.ts';

const SAMPLE_RATE_LIMIT = {
  limit: 30,
  remaining: 0,
  resetAt: Date.UTC(2026, 10, 19, 12, 1, 0),
};

describe('PublicApiRateLimitError', () => {
  test('共通エラーの回数の超過として429の応答になる', () => {
    const error = new PublicApiRateLimitError({
      rateLimit: SAMPLE_RATE_LIMIT,
      retryAfterSeconds: 42,
    });

    expect(error).toBeInstanceOf(AppError);
    expect(error.kind).toBe('rate_limited');
    expect(error.code).toBe('rate_limit_exceeded');
    expect(error.message).toBe(
      '操作が集中しています。しばらく待ってから再度お試しください。',
    );
    expect(error.retryAfterSeconds).toBe(42);
    expect(error.details).toBeUndefined();
  });

  test('応答のヘッダーに使う上限・残り・リセットの時刻を持つ', () => {
    const error = new PublicApiRateLimitError({
      rateLimit: SAMPLE_RATE_LIMIT,
      retryAfterSeconds: 42,
    });

    expect(error.rateLimit).toEqual(SAMPLE_RATE_LIMIT);
    expect(Object.isFrozen(error.rateLimit)).toBe(true);
  });

  test('渡した回数の値を後から書き換えても例外の値は変わらない', () => {
    const rateLimit = { ...SAMPLE_RATE_LIMIT };
    const error = new PublicApiRateLimitError({
      rateLimit,
      retryAfterSeconds: 42,
    });

    rateLimit.limit = 1;

    expect(error.rateLimit.limit).toBe(SAMPLE_RATE_LIMIT.limit);
  });

  test('再試行までの秒数が0以上の整数でなければ作れない', () => {
    expect(
      () =>
        new PublicApiRateLimitError({
          rateLimit: SAMPLE_RATE_LIMIT,
          retryAfterSeconds: 1.5,
        }),
    ).toThrow(RangeError);
  });
});
