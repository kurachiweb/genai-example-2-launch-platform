import { beforeEach, describe, expect, test } from 'vitest';

import { D1CustomerStore } from './d1-customer-store.ts';
import { D1PaymentRecordStore } from './d1-payment-record-store.ts';
import { D1PurchaseStore } from './d1-purchase-store.ts';
import { D1RefundStore } from './d1-refund-store.ts';
import {
  clearPaymentTables,
  db,
  insertUser,
  newPaymentRecord,
  newPurchase,
  newRefundRequest,
  userIdOf,
} from './testing/payment-store-fixtures.ts';

const store = new D1CustomerStore(db);

beforeEach(async () => {
  await clearPaymentTables();
  await insertUser(1);
  await insertUser(2);
});

describe('D1CustomerStore', () => {
  test('保存したCustomerのIDを利用者ごとに返し、無い利用者はundefinedを返す', async () => {
    await store.save(userIdOf(1), 'cus_1');
    await store.save(userIdOf(2), 'cus_2');

    expect(await store.find(userIdOf(1))).toBe('cus_1');
    expect(await store.find(userIdOf(2))).toBe('cus_2');
    expect(await store.find(userIdOf(3))).toBeUndefined();
  });

  test('同じ利用者の2回目の保存はCustomerのIDを置き換える', async () => {
    await store.save(userIdOf(1), 'cus_old');
    await store.save(userIdOf(1), 'cus_new');

    expect(await store.find(userIdOf(1))).toBe('cus_new');
  });

  test('後続spec用の照会は保存したCustomerのIDを返す', async () => {
    await store.save(userIdOf(1), 'cus_1');

    expect(await store.findCustomerId(userIdOf(1))).toBe('cus_1');
    expect(await store.findCustomerId(userIdOf(2))).toBeUndefined();
  });

  test('利用者の対応の削除の文はその利用者の行だけを消す', async () => {
    await store.save(userIdOf(1), 'cus_1');
    await store.save(userIdOf(2), 'cus_2');

    await db.batch([store.deleteByUser(userIdOf(1))]);

    expect(await store.find(userIdOf(1))).toBeUndefined();
    expect(await store.find(userIdOf(2))).toBe('cus_2');
  });

  test('返金の依頼・購入・Customerの順の削除の文を1回の一括の書き込みで確定でき、決済履歴は仮名化IDで残る', async () => {
    const purchases = new D1PurchaseStore(db);
    const refunds = new D1RefundStore(db);
    const records = new D1PaymentRecordStore(db);
    await store.save(userIdOf(1), 'cus_1');
    await db.batch([purchases.create(newPurchase(1))]);
    await db.batch([
      refunds.insert(newRefundRequest(1)),
      records.upsertByReference(newPaymentRecord(1)),
    ]);

    await db.batch([
      refunds.deleteByUser(userIdOf(1)),
      purchases.deleteByUser(userIdOf(1)),
      store.deleteByUser(userIdOf(1)),
    ]);

    expect(await store.find(userIdOf(1))).toBeUndefined();
    expect(await purchases.findOpenByUser(userIdOf(1))).toEqual([]);
    expect(
      await records.listAllByPseudonymousId('pseudonymous-1'),
    ).toHaveLength(1);
  });
});
