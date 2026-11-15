import { resetSync } from '@logtape/logtape';
import {
  CloudflareClient,
  type Event,
  getCurrentScope,
} from '@sentry/cloudflare';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest';

import type { ReflectionInstruction } from '../../core/payments/ports.ts';
import { reflectionRequestKeyOf } from '../../core/payments/refund-rules.ts';
import {
  insertPurchase,
  minutesAfterT0,
  NOW,
  OCCURRED_AT,
  paymentIntentIdOf,
  readRefundRows,
  sessionIdOf,
  snapshotOf,
} from './testing/checkout-reflection-harness.ts';
import {
  ownerMetadataOf,
  type PaymentReflectorHarness,
  reflectorWith,
  refundObjectIdOf,
  refundOf,
} from './testing/payment-reflector-harness.ts';
import {
  clearPaymentTables,
  insertUser,
  purchaseIdOf,
} from './testing/payment-store-fixtures.ts';

const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);

const FAILED_MESSAGE = '決済サービス上で返金が失敗しました';

function installRecordingSentry(): Event[] {
  const events: Event[] = [];
  const client = new CloudflareClient({
    dsn: TEST_DSN,
    integrations: [],
    stackParser: () => [],
    transport: () => ({
      send: () => Promise.resolve({}),
      flush: () => Promise.resolve(true),
    }),
    beforeSend: (event) => {
      events.push(event);
      return null;
    },
  });
  getCurrentScope().setClient(client);
  client.init();
  return events;
}

function refundInstruction(minutes: number): ReflectionInstruction {
  return {
    kind: 'refund',
    refundId: refundObjectIdOf(1),
    occurredAt: minutesAfterT0(minutes),
  };
}

// 反映の期限を過ぎた支払いで、自動返金の依頼を作る
async function reflectLateCheckout(): Promise<{
  readonly harness: PaymentReflectorHarness;
  readonly refundRequestId: string;
}> {
  await insertPurchase(1, {
    deadlineAt: minutesAfterT0(10),
    acceptUntil: minutesAfterT0(5),
    fulfillableUntil: new Date(NOW.getTime() - 1),
  });
  const harness = reflectorWith();
  harness.stripe.put({ kind: 'session', value: snapshotOf(1) });
  harness.stripe.putOwner({
    paymentIntentId: paymentIntentIdOf(1),
    metadata: ownerMetadataOf(1),
    subscriptionMetadata: null,
  });
  await harness.reflector.reflect({
    kind: 'checkout_session',
    sessionId: sessionIdOf(1),
    occurredAt: OCCURRED_AT,
  });
  const [row] = await readRefundRows();
  if (row?.requestKey !== reflectionRequestKeyOf(purchaseIdOf(1))) {
    throw new Error('自動返金の依頼がありません');
  }
  return { harness, refundRequestId: row.id };
}

function failedEvents(events: readonly Event[]): readonly Event[] {
  return events.filter(
    (event) => event.tags?.payments_incident === 'refund-failed',
  );
}

let events: Event[] = [];

beforeEach(async () => {
  events = installRecordingSentry();
  await clearPaymentTables();
  await insertUser(1);
});

afterEach(() => {
  getCurrentScope().setClient(undefined);
});

afterAll(() => {
  resetSync();
});

describe('反映の処理の返金の失敗の知らせ', () => {
  test('成功の後に失敗へ変わった返金を、依頼のIDとStripeの返金IDを添えてerrorで1件知らせる', async () => {
    const { harness, refundRequestId } = await reflectLateCheckout();
    const metadata = { refund_request_id: refundRequestId };
    harness.stripe.put({
      kind: 'refund',
      value: refundOf(1, { status: 'succeeded', metadata }),
    });
    await harness.reflector.reflect(refundInstruction(31));
    expect(failedEvents(events)).toEqual([]);
    harness.stripe.put({
      kind: 'refund',
      value: refundOf(1, {
        status: 'failed',
        failureReason: 'expired_or_canceled_card',
        metadata,
      }),
    });

    await harness.reflector.reflect(refundInstruction(32));

    const [event, ...rest] = failedEvents(events);
    expect(rest).toEqual([]);
    expect(event?.level).toBe('error');
    expect(event?.logentry?.message).toBe(FAILED_MESSAGE);
    expect(event?.message).toBeUndefined();
    expect(event?.fingerprint).toEqual(['payments', 'refund-failed']);
    expect(event?.tags).toStrictEqual({
      payments_incident: 'refund-failed',
      refund_request_id: refundRequestId,
      stripe_refund_id: refundObjectIdOf(1),
      failure_code: 'expired_or_canceled_card',
    });
  });

  test('同じ失敗の通知が再送されても、状態が変わらないため重ねて知らせない', async () => {
    const { harness, refundRequestId } = await reflectLateCheckout();
    harness.stripe.put({
      kind: 'refund',
      value: refundOf(1, {
        status: 'failed',
        failureReason: 'lost_or_stolen_card',
        metadata: { refund_request_id: refundRequestId },
      }),
    });

    await harness.reflector.reflect(refundInstruction(31));
    await harness.reflector.reflect(refundInstruction(32));
    await harness.reflector.reflect(refundInstruction(31));

    expect(failedEvents(events)).toHaveLength(1);
    expect(failedEvents(events)[0]?.tags?.refund_request_id).toBe(
      refundRequestId,
    );
  });

  test('失敗以外への変化と依頼の無い手動の返金の失敗は知らせない', async () => {
    const { harness, refundRequestId } = await reflectLateCheckout();
    harness.stripe.put({
      kind: 'refund',
      value: refundOf(1, {
        status: 'succeeded',
        metadata: { refund_request_id: refundRequestId },
      }),
    });
    await harness.reflector.reflect(refundInstruction(31));
    harness.stripe.put({
      kind: 'refund',
      value: refundOf(2, {
        status: 'failed',
        failureReason: 'expired_or_canceled_card',
      }),
    });

    await harness.reflector.reflect({
      kind: 'refund',
      refundId: refundObjectIdOf(2),
      occurredAt: minutesAfterT0(33),
    });

    expect(failedEvents(events)).toEqual([]);
  });
});
