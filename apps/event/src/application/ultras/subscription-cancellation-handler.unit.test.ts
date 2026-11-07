import { describe, expect, test } from 'bun:test';

import type {
  UserLifecycleEvent,
  UserLifecycleEventType,
} from '../../../lib/core/identity/user-lifecycle.ts';
import {
  type StripeGateway,
  StripeNotFoundError,
  StripeRejectedError,
  StripeUnavailableError,
} from '../../../lib/core/payments/ports.ts';
import type {
  SubscriptionRow,
  SubscriptionStore,
} from '../../../lib/core/ultras/ports.ts';
import { EMPTY_SUBSCRIPTION_SNAPSHOT } from '../../../lib/core/ultras/subscription-transition.ts';
import { SubscriptionCancellationHandler } from './subscription-cancellation-handler.ts';

type CancelResult = Awaited<ReturnType<StripeGateway['cancelSubscription']>>;

const USER_ID = '01JC0USER00000000000000001';

const T0 = new Date('2026-11-05T00:00:00.000Z');

function eventOf(type: UserLifecycleEventType): UserLifecycleEvent {
  return Object.freeze({
    id: '01JC0EVT000000000000000050',
    userId: USER_ID,
    type,
    occurredAt: T0,
  });
}

function rowOf(
  index: number,
  overrides: Partial<SubscriptionRow> = {},
): SubscriptionRow {
  return {
    ...EMPTY_SUBSCRIPTION_SNAPSHOT,
    id: `01JC0SUBSCRIPTION${String(index).padStart(9, '0')}`,
    stripeSubscriptionId: `sub_test_cancel_${String(index)}`,
    userId: USER_ID,
    purchaseId: null,
    stripeStatus: 'active',
    startedAt: T0,
    ...overrides,
  };
}

// 利用者が自分で、または停止により、課金期間の末日に終わるよう予約済みの加入
const SCHEDULED_ROW = rowOf(2, {
  cancelScheduled: true,
  cancelAt: new Date('2026-12-05T00:00:00.000Z'),
  canceledAt: T0,
  cancellationSource: 'user',
});

const SUSPENSION_SCHEDULED_ROW = rowOf(3, {
  cancelScheduled: true,
  cancelAt: new Date('2026-12-05T00:00:00.000Z'),
  canceledAt: T0,
  cancellationSource: 'suspension',
  pendingCancellationSource: 'suspension',
});

// 使わないメソッドを呼んだら失敗させ、処理が想定外のポートに触れたことを検出する
function partialFake<T extends object>(implemented: Partial<T>): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      return () => {
        throw new Error(`この偽物では使わない: ${String(property)}`);
      };
    },
  }) as T;
}

interface Harness {
  readonly handler: SubscriptionCancellationHandler;
  readonly calls: readonly string[];
}

function harnessWith(
  rows: readonly SubscriptionRow[],
  options: {
    readonly cancel?: (stripeSubscriptionId: string) => Promise<CancelResult>;
  } = {},
): Harness {
  const calls: string[] = [];
  const subscriptions = partialFake<SubscriptionStore>({
    findCancellable: (userId) => {
      calls.push(`subscriptions.findCancellable:${userId}`);
      return Promise.resolve(rows);
    },
    markPendingCancellation: ({ id, source }) => {
      calls.push(`subscriptions.markPendingCancellation:${id}:${source}`);
      return Promise.resolve();
    },
  });
  const gateway = partialFake<StripeGateway>({
    cancelSubscription: (stripeSubscriptionId, { atPeriodEnd }) => {
      calls.push(
        `gateway.cancelSubscription:${stripeSubscriptionId}:${atPeriodEnd ? 'period_end' : 'immediate'}`,
      );
      return (
        options.cancel?.(stripeSubscriptionId) ?? Promise.resolve('canceled')
      );
    },
  });
  return {
    handler: new SubscriptionCancellationHandler(subscriptions, gateway),
    calls,
  };
}

describe('SubscriptionCancellationHandler', () => {
  test('退会では、終了していない加入ごとに出どころ(退会)を記録してから即時に解約し、完了を返す', async () => {
    const active = rowOf(1);
    const { handler, calls } = harnessWith([active, SCHEDULED_ROW]);

    expect(await handler.handle(eventOf('withdrawn'))).toStrictEqual({
      kind: 'done',
    });
    expect(calls).toStrictEqual([
      `subscriptions.findCancellable:${USER_ID}`,
      `subscriptions.markPendingCancellation:${active.id}:withdrawal`,
      `gateway.cancelSubscription:${active.stripeSubscriptionId}:immediate`,
      `subscriptions.markPendingCancellation:${SCHEDULED_ROW.id}:withdrawal`,
      `gateway.cancelSubscription:${SCHEDULED_ROW.stripeSubscriptionId}:immediate`,
    ]);
  });

  test('停止では、予約の無い加入だけ出どころ(停止)を記録して課金期間の末日に解約し、予約済みの加入には触れない', async () => {
    const active = rowOf(1);
    const { handler, calls } = harnessWith([SCHEDULED_ROW, active]);

    expect(await handler.handle(eventOf('suspended'))).toStrictEqual({
      kind: 'done',
    });
    expect(calls).toStrictEqual([
      `subscriptions.findCancellable:${USER_ID}`,
      `subscriptions.markPendingCancellation:${active.id}:suspension`,
      `gateway.cancelSubscription:${active.stripeSubscriptionId}:period_end`,
    ]);
  });

  test('停止で全ての加入が予約済みなら、記録もStripeの呼び出しもせずに完了を返す', async () => {
    const { handler, calls } = harnessWith([
      SCHEDULED_ROW,
      SUSPENSION_SCHEDULED_ROW,
    ]);

    expect(await handler.handle(eventOf('suspended'))).toStrictEqual({
      kind: 'done',
    });
    expect(calls).toStrictEqual([`subscriptions.findCancellable:${USER_ID}`]);
  });

  test('停止中の利用者の退会では、停止で予約済みの加入も出どころ(退会)を記録して即時に解約する', async () => {
    const { handler, calls } = harnessWith([SUSPENSION_SCHEDULED_ROW]);

    expect(await handler.handle(eventOf('withdrawn'))).toStrictEqual({
      kind: 'done',
    });
    expect(calls).toStrictEqual([
      `subscriptions.findCancellable:${USER_ID}`,
      `subscriptions.markPendingCancellation:${SUSPENSION_SCHEDULED_ROW.id}:withdrawal`,
      `gateway.cancelSubscription:${SUSPENSION_SCHEDULED_ROW.stripeSubscriptionId}:immediate`,
    ]);
  });

  test.each(['withdrawn', 'suspended'] as const)(
    '%sで、Stripe上で既に解約済みの加入は成功として扱い、完了を返す',
    async (type) => {
      const active = rowOf(1);
      const { handler, calls } = harnessWith([active], {
        cancel: () => Promise.resolve('already_canceled'),
      });

      expect(await handler.handle(eventOf(type))).toStrictEqual({
        kind: 'done',
      });
      expect(calls).toHaveLength(3);
    },
  );

  test.each([
    ['一時的な障害', new StripeUnavailableError('Stripeの障害')],
    [
      '恒久的な拒否',
      new StripeRejectedError({
        message: '拒否',
        stripeErrorCode: 'resource_missing',
      }),
    ],
    ['対象が無いこと', new StripeNotFoundError('対象が無い')],
  ] as const)(
    'Stripeの%sは捕まえずに投げ、残りの加入を処理せずに波及処理の再試行に任せる',
    async (_label, failure) => {
      const first = rowOf(1);
      const second = rowOf(4);
      const { handler, calls } = harnessWith([first, second], {
        cancel: () => Promise.reject(failure),
      });

      expect(
        await handler
          .handle(eventOf('withdrawn'))
          .catch((thrown: unknown) => thrown),
      ).toBe(failure);
      expect(calls).toStrictEqual([
        `subscriptions.findCancellable:${USER_ID}`,
        `subscriptions.markPendingCancellation:${first.id}:withdrawal`,
        `gateway.cancelSubscription:${first.stripeSubscriptionId}:immediate`,
      ]);
    },
  );

  test.each(['withdrawn', 'suspended'] as const)(
    '%sで終了していない加入が無ければ、Stripeを呼ばずに完了を返す',
    async (type) => {
      const { handler, calls } = harnessWith([]);

      expect(await handler.handle(eventOf(type))).toStrictEqual({
        kind: 'done',
      });
      expect(calls).toStrictEqual([`subscriptions.findCancellable:${USER_ID}`]);
    },
  );

  test.each(['unsuspended', 'purge_due'] as const)(
    '退会・停止以外の種類(%s)のイベントでは、加入を読まずに何もせず完了を返す',
    async (type) => {
      const { handler, calls } = harnessWith([rowOf(1)]);

      expect(await handler.handle(eventOf(type))).toStrictEqual({
        kind: 'done',
      });
      expect(calls).toStrictEqual([]);
    },
  );
});
