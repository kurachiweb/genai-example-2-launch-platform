import { describe, expect, test } from 'bun:test';

import {
  HANDLED_STRIPE_EVENT_TYPES,
  mapStripeEvent,
} from './stripe-event-mapping.ts';

const CREATED_SECONDS = 1_767_225_600;
const OCCURRED_AT = new Date('2026-01-01T00:00:00.000Z');

function eventOf(type: string, objectId: string) {
  return {
    id: 'evt_test_1',
    type,
    created: CREATED_SECONDS,
    data: { object: { id: objectId } },
  };
}

describe('HANDLED_STRIPE_EVENT_TYPES', () => {
  test('Webhook endpointの購読の一覧と同じ15種の通知を受け付ける', () => {
    expect([...HANDLED_STRIPE_EVENT_TYPES].sort()).toEqual(
      [
        'checkout.session.completed',
        'checkout.session.async_payment_succeeded',
        'checkout.session.async_payment_failed',
        'checkout.session.expired',
        'invoice.paid',
        'invoice.payment_failed',
        'customer.subscription.created',
        'customer.subscription.updated',
        'customer.subscription.deleted',
        'refund.created',
        'refund.updated',
        'refund.failed',
        'charge.dispute.funds_withdrawn',
        'charge.dispute.funds_reinstated',
        'charge.dispute.closed',
      ].sort(),
    );
  });

  test('一覧は凍結されていて実行時に種類を追加できない', () => {
    expect(Object.isFrozen(HANDLED_STRIPE_EVENT_TYPES)).toBe(true);
  });
});

describe('mapStripeEvent', () => {
  test.each([
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired',
  ])('%sを決済セッションの反映の指示にする', (type) => {
    expect(mapStripeEvent(eventOf(type, 'cs_test_1'))).toEqual({
      kind: 'checkout_session',
      sessionId: 'cs_test_1',
      occurredAt: OCCURRED_AT,
    });
  });

  test.each(['invoice.paid', 'invoice.payment_failed'])(
    '%sを請求の反映の指示にする',
    (type) => {
      expect(mapStripeEvent(eventOf(type, 'in_test_1'))).toEqual({
        kind: 'invoice',
        invoiceId: 'in_test_1',
        occurredAt: OCCURRED_AT,
      });
    },
  );

  test.each([
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
  ])('%sを定期課金の反映の指示にする', (type) => {
    expect(mapStripeEvent(eventOf(type, 'sub_test_1'))).toEqual({
      kind: 'subscription',
      subscriptionId: 'sub_test_1',
      occurredAt: OCCURRED_AT,
    });
  });

  test.each(['refund.created', 'refund.updated', 'refund.failed'])(
    '%sを返金の反映の指示にする',
    (type) => {
      expect(mapStripeEvent(eventOf(type, 're_test_1'))).toEqual({
        kind: 'refund',
        refundId: 're_test_1',
        occurredAt: OCCURRED_AT,
      });
    },
  );

  test.each([
    ['charge.dispute.funds_withdrawn', 'funds_withdrawn'],
    ['charge.dispute.funds_reinstated', 'funds_reinstated'],
    ['charge.dispute.closed', 'closed'],
  ] as const)('%sをチャージバックの段階%sの反映の指示にする', (type, stage) => {
    expect(mapStripeEvent(eventOf(type, 'du_test_1'))).toEqual({
      kind: 'dispute',
      disputeId: 'du_test_1',
      stage,
      occurredAt: OCCURRED_AT,
    });
  });

  test.each([
    'charge.dispute.created',
    'charge.dispute.updated',
    'charge.succeeded',
    'payment_intent.succeeded',
    'customer.created',
    'invoice.created',
    'checkout.session',
    '',
  ])('受け付けない種類%pを無視の指示にする', (type) => {
    expect(mapStripeEvent(eventOf(type, 'obj_test_1'))).toEqual({
      kind: 'ignored',
      eventType: type,
    });
  });

  test.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'オブジェクトの組み込みの名前%pの種類も無視の指示にする',
    (type) => {
      expect(mapStripeEvent(eventOf(type, 'obj_test_1'))).toEqual({
        kind: 'ignored',
        eventType: type,
      });
    },
  );

  test('発生時刻を通知の秒単位の時刻から作る', () => {
    const instruction = mapStripeEvent({
      type: 'refund.updated',
      created: 1_767_225_601,
      data: { object: { id: 're_test_1' } },
    });

    expect(instruction).toEqual({
      kind: 'refund',
      refundId: 're_test_1',
      occurredAt: new Date('2026-01-01T00:00:01.000Z'),
    });
  });

  test('同じ通知を2回正規化しても同じ指示になる', () => {
    const event = eventOf('invoice.paid', 'in_test_1');

    expect(mapStripeEvent(event)).toEqual(mapStripeEvent(event));
  });
});
