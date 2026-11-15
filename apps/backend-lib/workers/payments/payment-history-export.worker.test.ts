import { beforeEach, describe, expect, test } from 'vitest';

import { paymentRecords } from '../../../db/schema/payments/payment-records.ts';
import type { NewPaymentRecord } from '../../core/payments/ports.ts';
import { D1PaymentRecordStore } from './d1-payment-record-store.ts';
import { StoredPaymentHistoryExport } from './payment-history-export.ts';
import {
  after,
  clearPaymentTables,
  db,
  newPaymentRecord,
  recordIdOf,
} from './testing/payment-store-fixtures.ts';

const PAYMENTS_JSON_FIELDS = [
  'amount',
  'currency',
  'id',
  'kind',
  'occurredAt',
  'purpose',
  'quantity',
  'relatedId',
  'status',
  'stripeReference',
];

const exporter = new StoredPaymentHistoryExport({
  records: new D1PaymentRecordStore(db),
});

async function insertRecords(
  records: readonly NewPaymentRecord[],
): Promise<void> {
  await db.insert(paymentRecords).values([...records]);
}

beforeEach(async () => {
  await clearPaymentTables();
});

describe('StoredPaymentHistoryExport', () => {
  test('仮名化IDの決済履歴の全件を、payments.jsonの項目だけで発生時刻の昇順に返す', async () => {
    await insertRecords([
      newPaymentRecord(1, {
        kind: 'one_time',
        purpose: 'sponsorship',
        amount: 5600,
        quantity: 7,
        stripeReference: 'cs_test_a1',
        relatedId: '01J9B2Y4DCQ7GXWCZJN3E7HNE1',
        consentedAt: after(-60_000),
        consentVersion: '2026-11-01',
        linkFundingSourceGroup: 'bank',
        occurredAt: after(1000),
      }),
      newPaymentRecord(2, {
        kind: 'dispute',
        purpose: 'sponsorship',
        status: 'dispute_lost',
        amount: 0,
        quantity: null,
        stripeReference: 'dp_test_1',
        relatedId: '01J9B2Y4DCQ7GXWCZJN3E7HNE1',
        purchaseId: null,
        occurredAt: after(3000),
      }),
      newPaymentRecord(3, {
        kind: 'refund',
        purpose: 'sponsorship',
        amount: -4800,
        quantity: null,
        stripeReference: 're_test_1',
        relatedId: '01J9B2Y4DCQ7GXWCZJN3E7HNE1',
        occurredAt: after(2000),
      }),
      newPaymentRecord(4, {
        pseudonymousId: 'pseudonymous-other',
        stripeReference: 'cs_test_other',
        occurredAt: after(1500),
      }),
    ]);

    const items = await exporter.listAll('pseudonymous-1');

    expect(items).toEqual([
      {
        id: recordIdOf(1),
        kind: 'one_time',
        purpose: 'sponsorship',
        amount: 5600,
        currency: 'usd',
        quantity: 7,
        status: 'succeeded',
        stripeReference: 'cs_test_a1',
        relatedId: '01J9B2Y4DCQ7GXWCZJN3E7HNE1',
        occurredAt: after(1000).toISOString(),
      },
      {
        id: recordIdOf(3),
        kind: 'refund',
        purpose: 'sponsorship',
        amount: -4800,
        currency: 'usd',
        quantity: null,
        status: 'succeeded',
        stripeReference: 're_test_1',
        relatedId: '01J9B2Y4DCQ7GXWCZJN3E7HNE1',
        occurredAt: after(2000).toISOString(),
      },
      {
        id: recordIdOf(2),
        kind: 'dispute',
        purpose: 'sponsorship',
        amount: 0,
        currency: 'usd',
        quantity: null,
        status: 'dispute_lost',
        stripeReference: 'dp_test_1',
        relatedId: '01J9B2Y4DCQ7GXWCZJN3E7HNE1',
        occurredAt: after(3000).toISOString(),
      },
    ]);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(PAYMENTS_JSON_FIELDS);
    }
  });

  test('決済履歴の無い仮名化IDでは空の配列を返す', async () => {
    expect(await exporter.listAll('pseudonymous-none')).toEqual([]);
  });
});
