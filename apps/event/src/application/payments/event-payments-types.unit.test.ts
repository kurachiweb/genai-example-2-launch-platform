import { describe, expect, test } from 'bun:test';

import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import { EVENT_PAYMENTS_TYPES } from './event-payments-types.ts';

const EXPECTED_NAMES = [
  'StripeWebhookReceiver',
  'RefundPaymentHandler',
  'RefundIncidentReporter',
  'CustomerErasureHandler',
  'OpenCheckoutExpiryHandler',
  'PaymentAccountDataEraser',
] as const;

describe('EVENT_PAYMENTS_TYPES', () => {
  test('Webhookの受け付け・返金の処理と失敗の通知・波及処理・削除の書き込みの単位の識別子だけを持つ', () => {
    expect(Object.keys(EVENT_PAYMENTS_TYPES)).toEqual([...EXPECTED_NAMES]);
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のpayments.<名前>である',
    (name) => {
      expect<symbol>(EVENT_PAYMENTS_TYPES[name]).toBe(
        Symbol.for(`payments.${name}`),
      );
    },
  );

  test('同じpayments.の接頭辞を使う共通の識別子とメンバーの名前が重ならない', () => {
    const shared = new Set(Object.keys(PAYMENTS_TYPES));

    expect(
      Object.keys(EVENT_PAYMENTS_TYPES).filter((name) => shared.has(name)),
    ).toEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_PAYMENTS_TYPES)).toBe(true);
  });
});
