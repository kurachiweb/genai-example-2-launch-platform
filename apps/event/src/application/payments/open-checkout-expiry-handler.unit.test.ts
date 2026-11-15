import { describe, expect, test } from 'bun:test';

import type {
  UserLifecycleEvent,
  UserLifecycleEventType,
} from '../../../lib/core/identity/user-lifecycle.ts';
import {
  type OpenCheckoutExpirer,
  StripeUnavailableError,
} from '../../../lib/core/payments/ports.ts';
import {
  OPEN_CHECKOUT_EXPIRY_LIMIT,
  OpenCheckoutExpiryHandler,
} from './open-checkout-expiry-handler.ts';

type ExpireOpenInput = Parameters<OpenCheckoutExpirer['expireOpen']>[0];

type ExpireOpenResult = Awaited<ReturnType<OpenCheckoutExpirer['expireOpen']>>;

const USER_ID = '01JC0USER00000000000000001';

function eventOf(type: UserLifecycleEventType): UserLifecycleEvent {
  return Object.freeze({
    id: '01JC0EVT000000000000000041',
    userId: USER_ID,
    type,
    occurredAt: new Date('2026-11-05T00:00:00.000Z'),
  });
}

function expirerReturning(results: readonly ExpireOpenResult[]): {
  readonly expirer: OpenCheckoutExpirer;
  readonly inputs: readonly ExpireOpenInput[];
} {
  const inputs: ExpireOpenInput[] = [];
  const pending = [...results];
  return {
    expirer: {
      expireOpen: (input) => {
        inputs.push(input);
        const next = pending.shift();
        return next === undefined
          ? Promise.reject(new Error('想定外の呼び出し'))
          : Promise.resolve(next);
      },
    },
    inputs,
  };
}

describe('OpenCheckoutExpiryHandler', () => {
  test('1回の上限の件数は失効の部品の上限と同じ50件である', () => {
    expect(OPEN_CHECKOUT_EXPIRY_LIMIT).toBe(50);
  });

  test.each(['withdrawn', 'suspended'] as const)(
    '%sのイベントで、利用者の全種別の未完了の決済セッションを上限の件数まで失効させ、残りが無ければ完了を返す',
    async (type) => {
      const { expirer, inputs } = expirerReturning([
        { expired: 2, remaining: false },
      ]);

      expect(
        await new OpenCheckoutExpiryHandler(expirer).handle(eventOf(type)),
      ).toStrictEqual({ kind: 'done' });
      expect(inputs).toStrictEqual([
        { userId: USER_ID, kinds: 'all', limit: OPEN_CHECKOUT_EXPIRY_LIMIT },
      ]);
    },
  );

  test('上限の外に未完了の決済セッションが残れば続きありを返す', async () => {
    const { expirer } = expirerReturning([{ expired: 50, remaining: true }]);

    expect(
      await new OpenCheckoutExpiryHandler(expirer).handle(eventOf('withdrawn')),
    ).toStrictEqual({ kind: 'continue' });
  });

  test('失効させる決済セッションが無くても完了を返す', async () => {
    const { expirer } = expirerReturning([{ expired: 0, remaining: false }]);

    expect(
      await new OpenCheckoutExpiryHandler(expirer).handle(eventOf('suspended')),
    ).toStrictEqual({ kind: 'done' });
  });

  test('Stripeの一時的な失敗は捕まえずに投げ、メッセージの再試行に任せる', async () => {
    const failure = new StripeUnavailableError('Stripeの障害');
    const expirer: OpenCheckoutExpirer = {
      expireOpen: () => Promise.reject(failure),
    };

    expect(
      await new OpenCheckoutExpiryHandler(expirer)
        .handle(eventOf('withdrawn'))
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
  });
});
