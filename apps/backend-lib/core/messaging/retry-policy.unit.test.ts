import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_RETRY_POLICY,
  decideOnFailure,
  type RetryPolicy,
} from './retry-policy.ts';

describe('DEFAULT_RETRY_POLICY', () => {
  test('5回目の試行で打ち切り、30秒から始めて3600秒で止める既定値を持つ', () => {
    expect(DEFAULT_RETRY_POLICY).toEqual({
      maxAttempts: 5,
      baseDelaySeconds: 30,
      maxDelaySeconds: 3600,
    });
    expect(Object.isFrozen(DEFAULT_RETRY_POLICY)).toBe(true);
  });
});

describe('decideOnFailure', () => {
  test('既定値では30・60・120・240秒の再試行の後にデッドレターになる', () => {
    const decisions = [1, 2, 3, 4, 5].map((attempts) =>
      decideOnFailure(DEFAULT_RETRY_POLICY, attempts),
    );

    expect(decisions).toEqual([
      { kind: 'retry', delaySeconds: 30 },
      { kind: 'retry', delaySeconds: 60 },
      { kind: 'retry', delaySeconds: 120 },
      { kind: 'retry', delaySeconds: 240 },
      { kind: 'dead-letter' },
    ]);
  });

  test('上限の試行回数を超えて配信されてもデッドレターになる', () => {
    expect(decideOnFailure(DEFAULT_RETRY_POLICY, 6)).toEqual({
      kind: 'dead-letter',
    });
  });

  test('倍々で伸ばした間隔は上限の秒数で止まる', () => {
    const policy: RetryPolicy = {
      maxAttempts: 10,
      baseDelaySeconds: 30,
      maxDelaySeconds: 3600,
    };

    expect(decideOnFailure(policy, 7)).toEqual({
      kind: 'retry',
      delaySeconds: 1920,
    });
    expect(decideOnFailure(policy, 8)).toEqual({
      kind: 'retry',
      delaySeconds: 3600,
    });
    expect(decideOnFailure(policy, 9)).toEqual({
      kind: 'retry',
      delaySeconds: 3600,
    });
  });

  test('上書きした方針の試行回数と間隔に従う', () => {
    const policy: RetryPolicy = {
      maxAttempts: 2,
      baseDelaySeconds: 10,
      maxDelaySeconds: 15,
    };

    expect(decideOnFailure(policy, 1)).toEqual({
      kind: 'retry',
      delaySeconds: 10,
    });
    expect(decideOnFailure(policy, 2)).toEqual({ kind: 'dead-letter' });
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    '試行回数が1以上の整数でなければRangeErrorになる(%p)',
    (attempts) => {
      expect(() => decideOnFailure(DEFAULT_RETRY_POLICY, attempts)).toThrow(
        RangeError,
      );
    },
  );
});
