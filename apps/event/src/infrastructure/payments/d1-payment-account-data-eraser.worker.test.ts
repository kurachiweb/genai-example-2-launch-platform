import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { paymentCustomers } from '../../../db/schema/payments/payment-customers.ts';
import { paymentPurchases } from '../../../db/schema/payments/payment-purchases.ts';
import { paymentRefunds } from '../../../db/schema/payments/payment-refunds.ts';
import { D1CustomerStore } from '../../../lib/workers/payments/d1-customer-store.ts';
import { D1PaymentRecordStore } from '../../../lib/workers/payments/d1-payment-record-store.ts';
import { D1PurchaseStore } from '../../../lib/workers/payments/d1-purchase-store.ts';
import { D1RefundStore } from '../../../lib/workers/payments/d1-refund-store.ts';
import {
  clearPaymentTables,
  createRecordingDatabase,
  db,
  insertUser,
  newPaymentRecord,
  newPurchase,
  newRefundRequest,
  purchaseIdOf,
  readRecords,
  recordIdOf,
  refundIdOf,
  userIdOf,
} from '../../../lib/workers/payments/testing/payment-store-fixtures.ts';
import type { PaymentAccountDataEraser } from '../../application/payments/payment-account-data-eraser.ts';
import { D1IdentityPurgeStore } from '../identity/d1-identity-purge-store.ts';
import { D1PaymentAccountDataEraser } from './d1-payment-account-data-eraser.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const ERASED = 1;

const KEPT = 2;

const purchases = new D1PurchaseStore(db);
const refunds = new D1RefundStore(db);
const customers = new D1CustomerStore(db);
const records = new D1PaymentRecordStore(db);

function createEraser(database: Database = db): PaymentAccountDataEraser {
  return new D1PaymentAccountDataEraser(
    database,
    new D1RefundStore(database),
    new D1PurchaseStore(database),
    new D1CustomerStore(database),
  );
}

interface UserPaymentRows {
  readonly customerIds: readonly string[];
  readonly purchaseIds: readonly string[];
  readonly refundIds: readonly string[];
}

async function readUserPaymentRows(
  userIndex: number,
): Promise<UserPaymentRows> {
  const userId = userIdOf(userIndex);
  const customerRows = await db
    .select({ id: paymentCustomers.stripeCustomerId })
    .from(paymentCustomers)
    .where(eq(paymentCustomers.userId, userId));
  const purchaseRows = await db
    .select({ id: paymentPurchases.id })
    .from(paymentPurchases)
    .where(eq(paymentPurchases.userId, userId))
    .orderBy(asc(paymentPurchases.id));
  const refundRows = await db
    .select({ id: paymentRefunds.id })
    .from(paymentRefunds)
    .innerJoin(
      paymentPurchases,
      eq(paymentPurchases.id, paymentRefunds.purchaseId),
    )
    .where(eq(paymentPurchases.userId, userId))
    .orderBy(asc(paymentRefunds.id));
  return {
    customerIds: customerRows.map(({ id }) => id),
    purchaseIds: purchaseRows.map(({ id }) => id),
    refundIds: refundRows.map(({ id }) => id),
  };
}

async function userRowExists(userIndex: number): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userIdOf(userIndex)));
  return rows.length === 1;
}

const ERASED_USER_ROWS: UserPaymentRows = {
  customerIds: ['cus_test_erased_1'],
  purchaseIds: [purchaseIdOf(1), purchaseIdOf(2)],
  refundIds: [refundIdOf(1), refundIdOf(2)],
};

const KEPT_USER_ROWS: UserPaymentRows = {
  customerIds: ['cus_test_kept_2'],
  purchaseIds: [purchaseIdOf(3)],
  refundIds: [refundIdOf(3)],
};

const NO_ROWS: UserPaymentRows = {
  customerIds: [],
  purchaseIds: [],
  refundIds: [],
};

// 物理削除する退会者に2件の購入・返金の依頼・決済履歴とCustomerの対応を、行が残るべき別の利用者に1件ずつを入れる
async function arrangeErasedAndKeptUsers(): Promise<void> {
  await insertUser(ERASED, { deletedAt: new Date('2026-11-01T00:00:00.000Z') });
  await insertUser(KEPT);
  await customers.save(userIdOf(ERASED), 'cus_test_erased_1');
  await customers.save(userIdOf(KEPT), 'cus_test_kept_2');
  await db.batch([
    purchases.create(newPurchase(1)),
    purchases.create(newPurchase(2)),
    purchases.create(newPurchase(3, { userId: userIdOf(KEPT) })),
  ]);
  await db.batch([
    refunds.insert(newRefundRequest(1, { purchaseId: purchaseIdOf(1) })),
    refunds.insert(newRefundRequest(2, { purchaseId: purchaseIdOf(2) })),
    refunds.insert(newRefundRequest(3, { purchaseId: purchaseIdOf(3) })),
  ]);
  await db.batch([
    records.upsertByReference(newPaymentRecord(1)),
    records.upsertByReference(newPaymentRecord(2)),
    records.upsertByReference(
      newPaymentRecord(3, { pseudonymousId: 'pseudonymous-2' }),
    ),
  ]);
}

async function readRecordSummaries(): Promise<
  readonly { readonly id: string; readonly pseudonymousId: string }[]
> {
  return (await readRecords()).map(({ id, pseudonymousId }) => ({
    id,
    pseudonymousId,
  }));
}

const ALL_RECORDS = [
  { id: recordIdOf(1), pseudonymousId: 'pseudonymous-1' },
  { id: recordIdOf(2), pseudonymousId: 'pseudonymous-1' },
  { id: recordIdOf(3), pseudonymousId: 'pseudonymous-2' },
];

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearPaymentTables();
});

describe('D1PaymentAccountDataEraser.erase', () => {
  test('利用者の返金の依頼・購入・Customerの対応を消し、決済履歴と他の利用者の行は残す', async () => {
    await arrangeErasedAndKeptUsers();

    await expect(
      createEraser().erase(userIdOf(ERASED)),
    ).resolves.toBeUndefined();

    await expect(readUserPaymentRows(ERASED)).resolves.toStrictEqual(NO_ROWS);
    await expect(readUserPaymentRows(KEPT)).resolves.toStrictEqual(
      KEPT_USER_ROWS,
    );
    await expect(readRecordSummaries()).resolves.toStrictEqual(ALL_RECORDS);
  });

  test('決済の行が残る間は利用者の行の物理削除が外部キーの違反で失敗し、削除の後は成功する', async () => {
    await arrangeErasedAndKeptUsers();
    const identityPurge = new D1IdentityPurgeStore(db);

    await expect(identityPurge.purge(userIdOf(ERASED))).rejects.toThrow();
    await expect(userRowExists(ERASED)).resolves.toBe(true);

    await createEraser().erase(userIdOf(ERASED));

    await expect(
      identityPurge.purge(userIdOf(ERASED)),
    ).resolves.toBeUndefined();
    await expect(userRowExists(ERASED)).resolves.toBe(false);
    await expect(readRecordSummaries()).resolves.toStrictEqual(ALL_RECORDS);
  });

  test('3つの削除の文を1回の一括の書き込みで確定する', async () => {
    await arrangeErasedAndKeptUsers();
    const { database, batchSizes } = createRecordingDatabase();

    await createEraser(database).erase(userIdOf(ERASED));

    expect(batchSizes).toStrictEqual([3]);
  });

  test('同じ利用者で2回呼んでも失敗せず、結果が変わらない', async () => {
    await arrangeErasedAndKeptUsers();
    const eraser = createEraser();
    await eraser.erase(userIdOf(ERASED));

    await expect(eraser.erase(userIdOf(ERASED))).resolves.toBeUndefined();

    await expect(readUserPaymentRows(ERASED)).resolves.toStrictEqual(NO_ROWS);
    await expect(readUserPaymentRows(KEPT)).resolves.toStrictEqual(
      KEPT_USER_ROWS,
    );
  });

  test('一括の書き込みの途中で失敗すると、返金の依頼も購入も残して失敗を投げる', async () => {
    await arrangeErasedAndKeptUsers();
    await env.DB.exec(
      "CREATE TRIGGER payment_customers_delete_failure BEFORE DELETE ON payment_customers BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );

    try {
      await expect(createEraser().erase(userIdOf(ERASED))).rejects.toThrow();
    } finally {
      await env.DB.exec('DROP TRIGGER payment_customers_delete_failure');
    }
    await expect(readUserPaymentRows(ERASED)).resolves.toStrictEqual(
      ERASED_USER_ROWS,
    );
  });
});
