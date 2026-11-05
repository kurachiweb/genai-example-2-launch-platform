import { describe, expect, test } from 'bun:test';

import { PAYMENTS_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'StripeGateway',
  'StripeWebhookVerifier',
  'PurchaseKindRegistry',
  'PaymentReflector',
  'OpenCheckoutExpirer',
  'PaymentRefunds',
  'PurchaseNotifier',
  'PriceCatalog',
  'CustomerDirectory',
  'PaymentHistoryExport',
  'PaymentRevenueReport',
  'PurchaseStore',
  'PaymentRecordStore',
  'RefundStore',
  'CustomerStore',
  'StripeObjectStore',
  'PriceSnapshotStore',
  'PurchaseStatements',
  'PaymentRecordStatements',
  'RefundStatements',
  'CustomerStatements',
  'StripeObjectStatements',
  'GuardedBatch',
  'PaymentRefundStatements',
  'PaymentOwnerResolver',
] as const;

describe('PAYMENTS_TYPES', () => {
  test('application層と後続specが受け取る17種と、workersとinfrastructureだけが受け取る8種の識別子だけを持つ', () => {
    expect(Object.keys(PAYMENTS_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のpayments.<名前>である',
    (name) => {
      expect<symbol>(PAYMENTS_TYPES[name]).toBe(Symbol.for(`payments.${name}`));
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(PAYMENTS_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(PAYMENTS_TYPES)).toBe(true);
  });
});
