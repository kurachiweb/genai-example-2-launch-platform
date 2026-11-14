import { describe, expect, test } from 'bun:test';

import {
  assertRetryPolicy,
  decideOnFailure,
} from '../messaging/retry-policy.ts';
import {
  ULTRAS_ACTIVATION_RETRY_POLICY,
  ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE,
} from './activation-message.ts';

const ULID = '01JBQ6Z8Y3V4W5X6Y7Z8A9B0C1';

describe('ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE', () => {
  test('種別ultras.run-activation-handlersの凍結済みの契約である', () => {
    expect(ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE.type).toBe(
      'ultras.run-activation-handlers',
    );
    expect(Object.isFrozen(ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE)).toBe(true);
  });

  test('知らせのIDだけの本文を受け付ける', () => {
    expect(
      ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE.schema.safeParse({
        activationId: ULID,
      }),
    ).toEqual({ success: true, data: { activationId: ULID } });
  });

  test('本文に利用者や定期課金の情報を持ち込めず、検証の結果をもう一度検証しても同じ値になる', () => {
    const first = ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE.schema.parse({
      activationId: ULID,
      userId: ULID,
      stripeSubscriptionId: 'sub_test_1',
      email: 'someone@mail.example',
    });

    expect(first).toEqual({ activationId: ULID });
    expect(ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE.schema.parse(first)).toEqual(
      first,
    );
  });

  test.each([
    ['知らせのIDの欠落', {}],
    ['空の知らせのID', { activationId: '' }],
    ['ULIDでない知らせのID', { activationId: 'activation-1' }],
    ['Stripeの定期課金のID', { activationId: 'sub_test_1' }],
    ['数値の知らせのID', { activationId: 1 }],
    ['nullの知らせのID', { activationId: null }],
  ])('%sの本文を拒否する', (_label, body) => {
    expect(
      ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE.schema.safeParse(body).success,
    ).toBe(false);
  });
});

describe('ULTRAS_ACTIVATION_RETRY_POLICY', () => {
  test('5回目の試行で打ち切り、60秒から倍にして3600秒で止める', () => {
    expect(ULTRAS_ACTIVATION_RETRY_POLICY).toEqual({
      maxAttempts: 5,
      baseDelaySeconds: 60,
      maxDelaySeconds: 3600,
    });
    expect(Object.isFrozen(ULTRAS_ACTIVATION_RETRY_POLICY)).toBe(true);
  });

  test('Queueの再配信の回数に収まり、60・120・240・480秒の再試行の後にデッドレターになる', () => {
    expect(() => {
      assertRetryPolicy(ULTRAS_ACTIVATION_RETRY_POLICY);
    }).not.toThrow();
    expect(
      [1, 2, 3, 4, 5].map((attempts) =>
        decideOnFailure(ULTRAS_ACTIVATION_RETRY_POLICY, attempts),
      ),
    ).toEqual([
      { kind: 'retry', delaySeconds: 60 },
      { kind: 'retry', delaySeconds: 120 },
      { kind: 'retry', delaySeconds: 240 },
      { kind: 'retry', delaySeconds: 480 },
      { kind: 'dead-letter' },
    ]);
  });
});
