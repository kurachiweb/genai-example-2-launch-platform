import { resetSync } from '@logtape/logtape';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import {
  type ReflectionInstruction,
  StripeUnavailableError,
} from '../../core/payments/ports.ts';
import type { SubscriptionChange } from '../../core/payments/purchase-kind-contract.ts';
import {
  insertPurchase,
  minutesAfterT0,
  PSEUDONYMOUS_ID,
} from './testing/checkout-reflection-harness.ts';
import { recordLogs } from './testing/fake-stripe.ts';
import {
  createFakeSubscriptionSink,
  type FakeSubscriptionSink,
  ownerMetadataOf,
  reflectorWith,
  sinkObjectIdOf,
  subscriptionIdOf,
  subscriptionOf,
} from './testing/payment-reflector-harness.ts';
import {
  clearPaymentTables,
  db,
  insertUser,
  purchaseIdOf,
  readStripeObjects,
  userIdOf,
} from './testing/payment-store-fixtures.ts';

const SINK_NAME = 'ultras-subscription.plan-state';
const CANCEL_AT = minutesAfterT0(60 * 24 * 30);
const PERIOD_END = minutesAfterT0(60 * 24 * 31);

function subscriptionInstruction(minutes: number): ReflectionInstruction {
  return {
    kind: 'subscription',
    subscriptionId: subscriptionIdOf(1),
    occurredAt: minutesAfterT0(minutes),
  };
}

async function objectIds(): Promise<string[]> {
  return (await readStripeObjects()).map(({ objectId }) => objectId);
}

beforeEach(async () => {
  await clearPaymentTables();
  await insertUser(1);
  await insertPurchase(1, { kind: 'ultras' });
});

afterAll(() => {
  resetSync();
});

describe('反映の処理の定期課金の状態の変化', () => {
  test('解約の予定時刻を含む変化を、発生時刻の記録と受け取り口の文と同時に確定し、確定後の処理を1回呼ぶ', async () => {
    const sink = createFakeSubscriptionSink({ name: SINK_NAME });
    const harness = reflectorWith({ sinks: [sink] });
    harness.stripe.put({
      kind: 'subscription',
      value: subscriptionOf(1, {
        cancelAt: CANCEL_AT,
        currentPeriodEnd: PERIOD_END,
      }),
    });

    const outcome = await harness.reflector.reflect(
      subscriptionInstruction(40),
    );

    expect(outcome).toEqual({ kind: 'applied' });
    const expected: SubscriptionChange = {
      subscriptionId: subscriptionIdOf(1),
      userId: userIdOf(1),
      pseudonymousId: PSEUDONYMOUS_ID,
      purchaseId: purchaseIdOf(1),
      status: 'active',
      cancelAtPeriodEnd: false,
      cancelAt: CANCEL_AT,
      currentPeriodEnd: PERIOD_END,
      endedAt: null,
      occurredAt: minutesAfterT0(40),
    };
    expect(sink.prepared).toEqual([expected]);
    expect(sink.committed).toEqual([expected]);
    expect(await readStripeObjects()).toContainEqual(
      expect.objectContaining({
        objectId: subscriptionIdOf(1),
        lastEventAt: minutesAfterT0(40),
      }),
    );
    expect(await objectIds()).toContain(
      sinkObjectIdOf(SINK_NAME, expected.occurredAt),
    );
  });

  test('記録済みより古い通知は、受け取り口を呼ばずに古い通知として捨てる', async () => {
    const sink = createFakeSubscriptionSink({ name: SINK_NAME });
    const harness = reflectorWith({ sinks: [sink] });
    harness.stripe.put({ kind: 'subscription', value: subscriptionOf(1) });
    await harness.reflector.reflect(subscriptionInstruction(40));

    expect(
      await harness.reflector.reflect(subscriptionInstruction(39)),
    ).toEqual({ kind: 'stale' });

    expect(sink.prepared).toHaveLength(1);
    expect(sink.committed).toHaveLength(1);
    expect(await readStripeObjects()).toContainEqual(
      expect.objectContaining({
        objectId: subscriptionIdOf(1),
        lastEventAt: minutesAfterT0(40),
      }),
    );
  });

  test('受け取り口の文の準備中に新しい通知が先に確定すれば、受け取り口の文を含めて取り消し、確定後の処理を呼ばない', async () => {
    const newer = createFakeSubscriptionSink({ name: SINK_NAME });
    const newerHarness = reflectorWith({ sinks: [newer] });
    newerHarness.stripe.put({ kind: 'subscription', value: subscriptionOf(1) });
    const older = createFakeSubscriptionSink({ name: SINK_NAME });
    const racingOlder: FakeSubscriptionSink = {
      ...older,
      // 古い通知が記録済みの発生時刻を確かめた後、確定の前に新しい通知が確定する
      statementsFor: async (change, database) => {
        await newerHarness.reflector.reflect(subscriptionInstruction(41));
        return older.statementsFor(change, database);
      },
    };
    const olderHarness = reflectorWith({ sinks: [racingOlder] });
    olderHarness.stripe.put({ kind: 'subscription', value: subscriptionOf(1) });

    expect(
      await olderHarness.reflector.reflect(subscriptionInstruction(40)),
    ).toEqual({ kind: 'stale' });

    expect(older.prepared).toHaveLength(1);
    expect(older.committed).toEqual([]);
    expect(newer.committed).toHaveLength(1);
    const ids = await objectIds();
    expect(ids).not.toContain(sinkObjectIdOf(SINK_NAME, minutesAfterT0(40)));
    expect(ids).toContain(sinkObjectIdOf(SINK_NAME, minutesAfterT0(41)));
    expect(await readStripeObjects()).toContainEqual(
      expect.objectContaining({
        objectId: subscriptionIdOf(1),
        lastEventAt: minutesAfterT0(41),
      }),
    );
  });

  test('確定後の処理の例外は反映の結果を変えず、warnのログだけを残す', async () => {
    const logs = recordLogs('event');
    const sink = createFakeSubscriptionSink({
      name: SINK_NAME,
      afterCommitError: new Error('確定後の処理の失敗'),
    });
    const harness = reflectorWith({ sinks: [sink] });
    harness.stripe.put({ kind: 'subscription', value: subscriptionOf(1) });

    expect(
      await harness.reflector.reflect(subscriptionInstruction(40)),
    ).toEqual({ kind: 'applied' });

    expect(sink.committed).toHaveLength(1);
    expect(
      logs.filter(({ method }) => method === 'warn').map(({ args }) => args),
    ).toHaveLength(1);
  });

  test('購入の行が無い(物理削除の後の)定期課金は、利用者をnullにしてメタデータの仮名化IDで渡す', async () => {
    const sink = createFakeSubscriptionSink({ name: SINK_NAME });
    const harness = reflectorWith({ sinks: [sink] });
    harness.stripe.put({
      kind: 'subscription',
      value: subscriptionOf(1, {
        status: 'canceled',
        endedAt: minutesAfterT0(39),
        metadata: ownerMetadataOf(9, 'ultras'),
      }),
    });

    expect(
      await harness.reflector.reflect(subscriptionInstruction(40)),
    ).toEqual({ kind: 'applied' });
    expect(sink.committed).toMatchObject([
      {
        userId: null,
        pseudonymousId: PSEUDONYMOUS_ID,
        purchaseId: purchaseIdOf(9),
        status: 'canceled',
        endedAt: minutesAfterT0(39),
      },
    ]);
  });

  test('Stripeに無い定期課金と、メタデータに仮名化IDの無い定期課金は結び付かないとして反映しない', async () => {
    const sink = createFakeSubscriptionSink({ name: SINK_NAME });
    const harness = reflectorWith({ sinks: [sink] });

    expect(
      await harness.reflector.reflect(subscriptionInstruction(40)),
    ).toEqual({ kind: 'unresolved' });
    harness.stripe.put({
      kind: 'subscription',
      value: subscriptionOf(1, { metadata: {} }),
    });
    expect(
      await harness.reflector.reflect(subscriptionInstruction(40)),
    ).toEqual({ kind: 'unresolved' });

    expect(sink.prepared).toEqual([]);
    expect(await readStripeObjects()).toEqual([]);
  });

  test('Stripeの一時的な失敗と、受け取り口の文のD1の失敗は例外で返し、部分的な書き込みを残さない', async () => {
    const sink = createFakeSubscriptionSink({
      name: SINK_NAME,
      statements: () => [
        db.run(sql`INSERT INTO missing_table (id) VALUES (1)`),
      ],
    });
    const harness = reflectorWith({ sinks: [sink] });
    harness.stripe.put({ kind: 'subscription', value: subscriptionOf(1) });
    harness.stripe.failNext(new StripeUnavailableError('Stripeの障害'));

    await expect(
      harness.reflector.reflect(subscriptionInstruction(40)),
    ).rejects.toBeInstanceOf(StripeUnavailableError);
    await expect(
      harness.reflector.reflect(subscriptionInstruction(40)),
    ).rejects.toThrow();

    expect(await readStripeObjects()).toEqual([]);
    expect(sink.committed).toEqual([]);
  });
});
