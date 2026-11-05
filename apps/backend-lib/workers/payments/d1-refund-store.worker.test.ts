import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { paymentRefunds } from '../../../db/schema/payments/payment-refunds.ts';
import type {
  NewRefundRequest,
  RefundRequestRecord,
} from '../../core/payments/ports.ts';
import { D1PurchaseStore } from './d1-purchase-store.ts';
import { D1RefundStore } from './d1-refund-store.ts';
import {
  after,
  clearPaymentTables,
  db,
  insertUser,
  newPurchase,
  newRefundRequest,
  purchaseIdOf,
  refundIdOf,
  userIdOf,
} from './testing/payment-store-fixtures.ts';

const MINUTE = 60_000;

const store = new D1RefundStore(db);
const purchases = new D1PurchaseStore(db);

async function insertRefunds(
  ...requests: readonly NewRefundRequest[]
): Promise<void> {
  for (const request of requests) {
    await db.batch([store.insert(request)]);
  }
}

async function setTimes(
  index: number,
  times: { readonly createdAt?: Date; readonly updatedAt?: Date },
): Promise<void> {
  await db
    .update(paymentRefunds)
    .set(times)
    .where(eq(paymentRefunds.id, refundIdOf(index)));
}

function idsOf(records: readonly RefundRequestRecord[]): string[] {
  return records.map(({ id }) => id);
}

beforeEach(async () => {
  await clearPaymentTables();
  await insertUser(1);
  await insertUser(2);
  await db.batch([
    purchases.create(newPurchase(1)),
    purchases.create(newPurchase(2, { userId: userIdOf(2) })),
  ]);
});

describe('D1RefundStoreの依頼の行の追加と検索', () => {
  test('追加した依頼をID・依頼キー・StripeのIDで、初期の状態とともに返す', async () => {
    const request = newRefundRequest(1, {
      amount: 80,
      reason: 'late',
      requestKey: 'reflection:purchase-1',
      noticeStatus: 'pending',
    });
    await insertRefunds(request);
    await store.updateStatus({
      refundRequestId: refundIdOf(1),
      status: 'submitted',
      stripeRefundId: 're_1',
    });

    const found = await store.findById(refundIdOf(1));

    expect(found).toEqual({
      ...request,
      status: 'submitted',
      stripeRefundId: 're_1',
      failureCode: null,
      dispatchedAt: null,
      createdAt: expect.any(Date) as Date,
    });
    expect(await store.findByRequestKey('reflection:purchase-1')).toEqual(
      found,
    );
    expect(await store.findByStripeRefundId('re_1')).toEqual(found);
  });

  test('無い依頼はundefinedを返す', async () => {
    await insertRefunds(newRefundRequest(1));

    expect(await store.findById(refundIdOf(9))).toBeUndefined();
    expect(await store.findByRequestKey('request-key-9')).toBeUndefined();
    expect(await store.findByStripeRefundId('re_none')).toBeUndefined();
  });

  test('同じ依頼キーの2つ目の追加は一意制約で失敗し、行を増やさない', async () => {
    await insertRefunds(newRefundRequest(1, { requestKey: 'same-key' }));

    await expect(
      insertRefunds(newRefundRequest(2, { requestKey: 'same-key' })),
    ).rejects.toThrow();
    expect(await store.findById(refundIdOf(2))).toBeUndefined();
  });
});

describe('D1RefundStoreの依頼済みの合計', () => {
  test('失敗・取り消し以外の依頼の金額を購入ごとに合計する', async () => {
    await insertRefunds(
      newRefundRequest(1, { amount: 10 }),
      newRefundRequest(2, { amount: 20 }),
      newRefundRequest(3, { amount: 40 }),
      newRefundRequest(4, { amount: 80 }),
      newRefundRequest(5, { amount: 160 }),
      newRefundRequest(6, { amount: 320, purchaseId: purchaseIdOf(2) }),
    );
    await store.updateStatus({
      refundRequestId: refundIdOf(2),
      status: 'succeeded',
    });
    await store.updateStatus({
      refundRequestId: refundIdOf(3),
      status: 'failed',
    });
    await store.updateStatus({
      refundRequestId: refundIdOf(4),
      status: 'canceled',
    });
    await store.updateStatus({
      refundRequestId: refundIdOf(5),
      status: 'submitted',
    });

    expect(await store.sumRequested(purchaseIdOf(1))).toBe(10 + 20 + 160);
    expect(await store.sumRequested(purchaseIdOf(2))).toBe(320);
  });

  test('依頼の無い購入は0を返す', async () => {
    expect(await store.sumRequested(purchaseIdOf(1))).toBe(0);
  });
});

describe('D1RefundStoreの送信と状態の更新', () => {
  test('送信の日時は未送信のときだけ記録し、2回目では変えない', async () => {
    await insertRefunds(newRefundRequest(1));

    await store.markDispatched(refundIdOf(1), after(1));
    await store.markDispatched(refundIdOf(1), after(2));

    expect((await store.findById(refundIdOf(1)))?.dispatchedAt).toEqual(
      after(1),
    );
  });

  test('状態の更新は省いた項目を変えず、失敗の理由を消すこともできる', async () => {
    await insertRefunds(newRefundRequest(1));
    await store.updateStatus({
      refundRequestId: refundIdOf(1),
      status: 'failed',
      stripeRefundId: 're_1',
      failureCode: 'charge_already_refunded',
    });

    expect(await store.findById(refundIdOf(1))).toMatchObject({
      status: 'failed',
      stripeRefundId: 're_1',
      failureCode: 'charge_already_refunded',
    });

    await store.updateStatus({
      refundRequestId: refundIdOf(1),
      status: 'succeeded',
      failureCode: null,
    });

    expect(await store.findById(refundIdOf(1))).toMatchObject({
      status: 'succeeded',
      stripeRefundId: 're_1',
      failureCode: null,
    });
  });

  test('作成から指定の日時より前で未送信の依頼を、古い順に上限の件数まで返す', async () => {
    await insertRefunds(
      newRefundRequest(1),
      newRefundRequest(2),
      newRefundRequest(3),
      newRefundRequest(4),
      newRefundRequest(5),
    );
    await setTimes(1, { createdAt: after(3 * MINUTE) });
    await setTimes(2, { createdAt: after(1 * MINUTE) });
    await setTimes(3, { createdAt: after(2 * MINUTE) });
    await setTimes(4, { createdAt: after(10 * MINUTE) });
    await setTimes(5, { createdAt: after(0) });
    await store.markDispatched(refundIdOf(5), after(1));

    expect(
      idsOf(
        await store.findUndispatched({
          createdBefore: after(10 * MINUTE),
          limit: 2,
        }),
      ),
    ).toEqual([refundIdOf(2), refundIdOf(3)]);
    expect(
      idsOf(
        await store.findUndispatched({
          createdBefore: after(10 * MINUTE),
          limit: 100,
        }),
      ),
    ).toEqual([refundIdOf(2), refundIdOf(3), refundIdOf(1)]);
  });
});

describe('D1RefundStoreの自動返金の通知の状態', () => {
  test('通知は依頼待ちのときだけ進め、進めたかを返す', async () => {
    await insertRefunds(
      newRefundRequest(1, { noticeStatus: 'pending' }),
      newRefundRequest(2, { noticeStatus: 'none' }),
      newRefundRequest(3, { noticeStatus: 'pending' }),
    );

    expect(
      await store.markNotice({
        refundRequestId: refundIdOf(1),
        to: 'requested',
      }),
    ).toBe(true);
    expect(
      await store.markNotice({ refundRequestId: refundIdOf(1), to: 'skipped' }),
    ).toBe(false);
    expect(
      await store.markNotice({
        refundRequestId: refundIdOf(2),
        to: 'requested',
      }),
    ).toBe(false);
    expect(
      await store.markNotice({ refundRequestId: refundIdOf(3), to: 'skipped' }),
    ).toBe(true);

    expect((await store.findById(refundIdOf(1)))?.noticeStatus).toBe(
      'requested',
    );
    expect((await store.findById(refundIdOf(2)))?.noticeStatus).toBe('none');
    expect((await store.findById(refundIdOf(3)))?.noticeStatus).toBe('skipped');
  });

  test('返金が成功して通知が依頼待ちのまま、更新から指定の日時より前の依頼を古い順に上限の件数まで返す', async () => {
    await insertRefunds(
      newRefundRequest(1, { noticeStatus: 'pending' }),
      newRefundRequest(2, { noticeStatus: 'pending' }),
      newRefundRequest(3, { noticeStatus: 'pending' }),
      newRefundRequest(4, { noticeStatus: 'pending' }),
      newRefundRequest(5, { noticeStatus: 'none' }),
      newRefundRequest(6, { noticeStatus: 'pending' }),
    );
    for (const index of [1, 2, 3, 5, 6]) {
      await store.updateStatus({
        refundRequestId: refundIdOf(index),
        status: 'succeeded',
      });
    }
    await store.updateStatus({
      refundRequestId: refundIdOf(4),
      status: 'submitted',
    });
    await setTimes(1, { updatedAt: after(3 * MINUTE) });
    await setTimes(2, { updatedAt: after(1 * MINUTE) });
    await setTimes(3, { updatedAt: after(2 * MINUTE) });
    await setTimes(4, { updatedAt: after(0) });
    await setTimes(5, { updatedAt: after(0) });
    await setTimes(6, { updatedAt: after(10 * MINUTE) });

    expect(
      idsOf(
        await store.findPendingNotices({
          updatedBefore: after(10 * MINUTE),
          limit: 2,
        }),
      ),
    ).toEqual([refundIdOf(2), refundIdOf(3)]);
    expect(
      idsOf(
        await store.findPendingNotices({
          updatedBefore: after(10 * MINUTE),
          limit: 100,
        }),
      ),
    ).toEqual([refundIdOf(2), refundIdOf(3), refundIdOf(1)]);
  });
});

describe('D1RefundStoreの利用者の行の削除', () => {
  test('利用者の購入の依頼だけを消し、購入の削除と同じ一括の書き込みで確定できる', async () => {
    await insertRefunds(
      newRefundRequest(1),
      newRefundRequest(2),
      newRefundRequest(3, { purchaseId: purchaseIdOf(2) }),
    );

    await db.batch([
      store.deleteByUser(userIdOf(1)),
      purchases.deleteByUser(userIdOf(1)),
    ]);

    expect(await store.findById(refundIdOf(1))).toBeUndefined();
    expect(await store.findById(refundIdOf(2))).toBeUndefined();
    expect(await store.findById(refundIdOf(3))).toBeDefined();
    expect(await purchases.findById(purchaseIdOf(1))).toBeUndefined();
  });
});
