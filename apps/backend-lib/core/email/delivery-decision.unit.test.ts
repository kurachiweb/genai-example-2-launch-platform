import { describe, expect, test } from 'bun:test';

import {
  assertRetryPolicy,
  decideOnFailure,
  QUEUE_MAX_RETRIES,
  type RetryPolicy,
} from '../messaging/retry-policy.ts';
import {
  DAILY_LIMIT_DEFER_SECONDS,
  decideAfterOutcome,
  decideBeforeSend,
  EMAIL_SEND_RETRY_POLICY,
  RATE_LIMIT_DEFER_SECONDS,
} from './delivery-decision.ts';
import type { EmailProviderOutcome } from './provider-outcome.ts';

const DEADLINE = new Date('2026-09-15T07:40:00.000Z');

describe('decideBeforeSend', () => {
  test('送信期限が無ければ送信に進む', () => {
    expect(decideBeforeSend(undefined, DEADLINE)).toEqual({
      kind: 'proceed',
    });
  });

  test('送信期限の1ミリ秒前なら送信に進む', () => {
    const now = new Date(DEADLINE.getTime() - 1);

    expect(decideBeforeSend(DEADLINE, now)).toEqual({ kind: 'proceed' });
  });

  test('送信期限ちょうどは期限切れとして送らない', () => {
    expect(decideBeforeSend(DEADLINE, new Date(DEADLINE))).toEqual({
      kind: 'skip',
      reason: 'expired',
    });
  });

  test('送信期限を過ぎていれば期限切れとして送らない', () => {
    const now = new Date(DEADLINE.getTime() + 1);

    expect(decideBeforeSend(DEADLINE, now)).toEqual({
      kind: 'skip',
      reason: 'expired',
    });
  });
});

describe('EMAIL_SEND_RETRY_POLICY', () => {
  test('5回目の試行で打ち切り、120秒から倍にして3600秒で止める', () => {
    expect(EMAIL_SEND_RETRY_POLICY).toEqual({
      maxAttempts: 5,
      baseDelaySeconds: 120,
      maxDelaySeconds: 3600,
    });
    expect(Object.isFrozen(EMAIL_SEND_RETRY_POLICY)).toBe(true);
  });

  test('Queuesの再試行回数の上限より小さく、メッセージの登録で受け付けられる', () => {
    expect(EMAIL_SEND_RETRY_POLICY.maxAttempts).toBeLessThan(QUEUE_MAX_RETRIES);
    expect(() => {
      assertRetryPolicy(EMAIL_SEND_RETRY_POLICY);
    }).not.toThrow();
  });

  test('受信部の再試行の判定では120・240・480・960秒の間隔の後に打ち切りになる', () => {
    const decisions = [1, 2, 3, 4, 5].map((attempts) =>
      decideOnFailure(EMAIL_SEND_RETRY_POLICY, attempts),
    );

    expect(decisions).toEqual([
      { kind: 'retry', delaySeconds: 120 },
      { kind: 'retry', delaySeconds: 240 },
      { kind: 'retry', delaySeconds: 480 },
      { kind: 'retry', delaySeconds: 960 },
      { kind: 'dead-letter' },
    ]);
  });
});

describe('decideAfterOutcome', () => {
  test('送信済みなら送信プロバイダの識別子付きで完了する', () => {
    expect(
      decideAfterOutcome({ kind: 'sent', providerMessageId: 'msg-1' }, 1),
    ).toEqual({ kind: 'completed', providerMessageId: 'msg-1' });
  });

  test.each([1, 4, 5, 6])(
    '送信レートの上限は試行%p回目でも試行回数に数えず60秒待つ',
    (attempts) => {
      expect(decideAfterOutcome({ kind: 'rate-limited' }, attempts)).toEqual({
        kind: 'defer',
        delaySeconds: RATE_LIMIT_DEFER_SECONDS,
        cause: 'rate-limited',
      });
      expect(RATE_LIMIT_DEFER_SECONDS).toBe(60);
    },
  );

  test.each([1, 4, 5, 6])(
    '日次上限は試行%p回目でも試行回数に数えず3600秒待つ',
    (attempts) => {
      expect(decideAfterOutcome({ kind: 'daily-limit' }, attempts)).toEqual({
        kind: 'defer',
        delaySeconds: DAILY_LIMIT_DEFER_SECONDS,
        cause: 'daily-limit',
      });
      expect(DAILY_LIMIT_DEFER_SECONDS).toBe(3600);
    },
  );

  test('一時的な障害は試行1〜4回目は再試行し、5回目は通知付きの断念になる', () => {
    const outcome: EmailProviderOutcome = {
      kind: 'temporary',
      code: 'E_INTERNAL_SERVER_ERROR',
    };

    const actions = [1, 2, 3, 4, 5].map((attempts) =>
      decideAfterOutcome(outcome, attempts),
    );

    expect(actions).toEqual([
      { kind: 'retry', code: 'E_INTERNAL_SERVER_ERROR' },
      { kind: 'retry', code: 'E_INTERNAL_SERVER_ERROR' },
      { kind: 'retry', code: 'E_INTERNAL_SERVER_ERROR' },
      { kind: 'retry', code: 'E_INTERNAL_SERVER_ERROR' },
      {
        kind: 'give-up',
        result: 'undeliverable',
        code: 'E_INTERNAL_SERVER_ERROR',
        report: true,
      },
    ]);
  });

  test('一時的な障害の断念は、受信部がデッドレターへ移す試行回数と一致する', () => {
    const outcome: EmailProviderOutcome = {
      kind: 'temporary',
      code: 'E_DELIVERY_FAILED',
    };

    for (const attempts of [1, 2, 3, 4, 5, 6]) {
      const action = decideAfterOutcome(outcome, attempts);
      const failure = decideOnFailure(EMAIL_SEND_RETRY_POLICY, attempts);

      expect(action.kind === 'retry').toBe(failure.kind === 'retry');
    }
  });

  test('上限の試行回数を超えて配信された一時的な障害も通知付きの断念になる', () => {
    expect(
      decideAfterOutcome({ kind: 'temporary', code: 'E_DELIVERY_FAILED' }, 6),
    ).toEqual({
      kind: 'give-up',
      result: 'undeliverable',
      code: 'E_DELIVERY_FAILED',
      report: true,
    });
  });

  test('方針を渡せば、その試行回数の上限で断念する', () => {
    const policy: RetryPolicy = {
      maxAttempts: 2,
      baseDelaySeconds: 10,
      maxDelaySeconds: 15,
    };
    const outcome: EmailProviderOutcome = { kind: 'temporary', code: 'X' };

    expect(decideAfterOutcome(outcome, 1, policy)).toEqual({
      kind: 'retry',
      code: 'X',
    });
    expect(decideAfterOutcome(outcome, 2, policy)).toMatchObject({
      kind: 'give-up',
      report: true,
    });
  });

  test.each([1, 5])(
    '恒久的な失敗は試行%p回目でも再試行せず通知付きの断念になる',
    (attempts) => {
      expect(
        decideAfterOutcome(
          { kind: 'permanent', code: 'E_SENDER_NOT_VERIFIED' },
          attempts,
        ),
      ).toEqual({
        kind: 'give-up',
        result: 'undeliverable',
        code: 'E_SENDER_NOT_VERIFIED',
        report: true,
      });
    },
  );

  test('宛先の抑止は再試行せず通知なしの断念になる', () => {
    expect(decideAfterOutcome({ kind: 'recipient-suppressed' }, 1)).toEqual({
      kind: 'give-up',
      result: 'recipient-suppressed',
      code: undefined,
      report: false,
    });
  });

  test('環境の宛先制限は再試行せず通知なしの断念になる', () => {
    expect(decideAfterOutcome({ kind: 'recipient-not-allowed' }, 1)).toEqual({
      kind: 'give-up',
      result: 'recipient-not-allowed',
      code: undefined,
      report: false,
    });
  });

  test.each([0, -1, 1.5, Number.NaN])(
    '試行回数が1以上の整数でなければRangeErrorになる(%p)',
    (attempts) => {
      expect(() =>
        decideAfterOutcome({ kind: 'temporary', code: 'X' }, attempts),
      ).toThrow(RangeError);
    },
  );
});
