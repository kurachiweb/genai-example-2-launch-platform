import { describe, expect, test } from 'bun:test';

import { PAYMENTS_REFUND_MESSAGE } from './refund-message.ts';

const ULID = '01JBQ6Z8Y3V4W5X6Y7Z8A9B0C1';

describe('PAYMENTS_REFUND_MESSAGE', () => {
  test('種別payments.refund-paymentの凍結済みの契約である', () => {
    expect(PAYMENTS_REFUND_MESSAGE.type).toBe('payments.refund-payment');
    expect(Object.isFrozen(PAYMENTS_REFUND_MESSAGE)).toBe(true);
  });

  test('返金の依頼のIDだけの本文を受け付ける', () => {
    expect(
      PAYMENTS_REFUND_MESSAGE.schema.safeParse({ refundRequestId: ULID }),
    ).toEqual({ success: true, data: { refundRequestId: ULID } });
  });

  test('本文に金額や個人情報を持ち込めず、検証の結果をもう一度検証しても同じ値になる', () => {
    const first = PAYMENTS_REFUND_MESSAGE.schema.parse({
      refundRequestId: ULID,
      amount: 4900,
      paymentIntentId: 'pi_test_1',
      email: 'someone@mail.example',
    });

    expect(first).toEqual({ refundRequestId: ULID });
    expect(PAYMENTS_REFUND_MESSAGE.schema.parse(first)).toEqual(first);
  });

  test.each([
    ['返金の依頼のIDの欠落', {}],
    ['空の返金の依頼のID', { refundRequestId: '' }],
    ['ULIDでない返金の依頼のID', { refundRequestId: 'refund-1' }],
    ['Stripeの返金のID', { refundRequestId: 're_test_1' }],
    ['数値の返金の依頼のID', { refundRequestId: 1 }],
    ['nullの返金の依頼のID', { refundRequestId: null }],
  ])('%sの本文を拒否する', (_label, body) => {
    expect(PAYMENTS_REFUND_MESSAGE.schema.safeParse(body).success).toBe(false);
  });
});
