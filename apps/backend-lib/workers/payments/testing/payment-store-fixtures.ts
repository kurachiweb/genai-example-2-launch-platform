import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';

import { createDatabase, type Database } from '../../../../db/client.ts';
import { paymentCustomers } from '../../../../db/schema/payments/payment-customers.ts';
import { paymentPriceSnapshots } from '../../../../db/schema/payments/payment-price-snapshots.ts';
import { paymentPurchases } from '../../../../db/schema/payments/payment-purchases.ts';
import { paymentRecords } from '../../../../db/schema/payments/payment-records.ts';
import { paymentRefunds } from '../../../../db/schema/payments/payment-refunds.ts';
import { paymentStripeObjects } from '../../../../db/schema/payments/payment-stripe-objects.ts';
import type {
  NewPaymentRecord,
  NewPurchase,
  NewRefundRequest,
} from '../../../core/payments/ports.ts';
import {
  clearIdentityTables,
  db,
  T0,
  userIdOf,
} from '../../identity/testing/identity-store-fixtures.ts';

export {
  after,
  db,
  insertUser,
  T0,
  userIdOf,
} from '../../identity/testing/identity-store-fixtures.ts';

export function purchaseIdOf(index: number): string {
  return `01JC0PURCHASE${String(index).padStart(13, '0')}`;
}

export function tokenOf(index: number): string {
  return `01JC0TOKEN${String(index).padStart(16, '0')}`;
}

export function recordIdOf(index: number): string {
  return `01JC0RECORD${String(index).padStart(15, '0')}`;
}

export function refundIdOf(index: number): string {
  return `01JC0REFUND${String(index).padStart(15, '0')}`;
}

export function newPurchase(
  index: number,
  columns: Partial<NewPurchase> = {},
): NewPurchase {
  return {
    id: purchaseIdOf(index),
    userId: userIdOf(1),
    kind: 'payments_smoke',
    targetId: null,
    relatedId: null,
    exclusivityKey: null,
    stateToken: tokenOf(index),
    priceLookupKey: 'payments_smoke_v1',
    stripePriceId: 'price_smoke',
    unitAmount: 100,
    quantity: 1,
    amountTotal: 100,
    summary: {
      itemName: '疎通確認',
      quantityLabel: '1件',
      serviceTiming: '決済の直後',
      additionalNotes: [],
    },
    deadlineAt: null,
    acceptUntil: null,
    fulfillableUntil: null,
    expiresAt: new Date(T0.getTime() + 3_600_000),
    ...columns,
  };
}

export function newPaymentRecord(
  index: number,
  columns: Partial<NewPaymentRecord> = {},
): NewPaymentRecord {
  return {
    id: recordIdOf(index),
    pseudonymousId: 'pseudonymous-1',
    kind: 'one_time',
    purpose: 'payments_smoke',
    status: 'succeeded',
    amount: 100,
    currency: 'usd',
    quantity: 1,
    stripeReference: `cs_test_${String(index)}`,
    relatedId: null,
    purchaseId: purchaseIdOf(index),
    consentedAt: null,
    consentVersion: null,
    linkFundingSourceGroup: null,
    occurredAt: T0,
    lastEventAt: T0,
    recordedAt: T0,
    ...columns,
  };
}

export function newRefundRequest(
  index: number,
  columns: Partial<NewRefundRequest> = {},
): NewRefundRequest {
  return {
    id: refundIdOf(index),
    purchaseId: purchaseIdOf(1),
    requestKey: `request-key-${String(index)}`,
    amount: 100,
    reason: 'entitlement_lost',
    noticeStatus: 'none',
    ...columns,
  };
}

export async function clearPaymentTables(): Promise<void> {
  await db.delete(paymentRefunds);
  await db.delete(paymentRecords);
  await db.delete(paymentStripeObjects);
  await db.delete(paymentPriceSnapshots);
  await db.delete(paymentPurchases);
  await db.delete(paymentCustomers);
  await clearIdentityTables();
}

export async function readPurchaseRow(
  purchaseId: string,
): Promise<typeof paymentPurchases.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(paymentPurchases)
    .where(eq(paymentPurchases.id, purchaseId));
  return row;
}

export async function readRecords(): Promise<
  (typeof paymentRecords.$inferSelect)[]
> {
  return db.select().from(paymentRecords).orderBy(asc(paymentRecords.id));
}

export async function readStripeObjects(): Promise<
  (typeof paymentStripeObjects.$inferSelect)[]
> {
  return db
    .select()
    .from(paymentStripeObjects)
    .orderBy(asc(paymentStripeObjects.objectId));
}

// 各文のバインド変数の数を記録し、実行はテスト用のD1へそのまま渡す
export function createRecordingDatabase(): {
  readonly database: Database;
  readonly placeholderCounts: readonly number[];
} {
  const placeholderCounts: number[] = [];
  const d1 = env.DB;
  const recording: D1Database = {
    prepare: (query) => {
      placeholderCounts.push(query.match(/\?/g)?.length ?? 0);
      return d1.prepare(query);
    },
    batch: d1.batch.bind(d1),
    exec: d1.exec.bind(d1),
    withSession: d1.withSession.bind(d1),
    // D1Databaseの型が非推奨のdumpも必須にするため、偽物でも実装する
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    dump: () => Promise.reject(new Error('テストでは使わない')),
  };
  return { database: createDatabase(recording), placeholderCounts };
}
