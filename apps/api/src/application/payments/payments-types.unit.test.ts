import { describe, expect, test } from 'bun:test';

import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import { API_PAYMENTS_TYPES } from './payments-types.ts';

const PORT_NAMES = [
  'CheckoutStartLimits',
  'CheckoutPurchaseWriter',
  'PurchaseOfferPolicyResolver',
  'PaymentsJobIncidentReporter',
] as const;

const USE_CASE_NAMES = [
  'CheckoutStarter',
  'CheckoutReader',
  'CheckoutConsentRecorder',
  'CheckoutReturnConfirmer',
  'PaymentHistoryReader',
] as const;

const JOB_NAMES = [
  'CheckoutReconciliationJob',
  'PendingCheckoutSweepJob',
  'PaymentHistoryRetentionJob',
] as const;

const EXPECTED_NAMES = [
  ...PORT_NAMES,
  ...USE_CASE_NAMES,
  ...JOB_NAMES,
] as const;

describe('API_PAYMENTS_TYPES', () => {
  test('決済のポート・ユースケース・ジョブの識別子だけを持つ', () => {
    expect(Object.keys(API_PAYMENTS_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のpayments.<名前>である',
    (name) => {
      expect<symbol>(API_PAYMENTS_TYPES[name]).toBe(
        Symbol.for(`payments.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(API_PAYMENTS_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('同じpayments.の接頭辞を使う共通の識別子とメンバーの名前が重ならない', () => {
    const shared = new Set(Object.keys(PAYMENTS_TYPES));

    expect(
      Object.keys(API_PAYMENTS_TYPES).filter((name) => shared.has(name)),
    ).toEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(API_PAYMENTS_TYPES)).toBe(true);
  });
});
