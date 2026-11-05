import { beforeEach, describe, expect, test } from 'vitest';

import type {
  NewPaymentRecord,
  PaymentRecordRow,
} from '../../core/payments/ports.ts';
import { D1PaymentRecordStore } from './d1-payment-record-store.ts';
import { D1PurchaseStore } from './d1-purchase-store.ts';
import {
  after,
  clearPaymentTables,
  db,
  insertUser,
  newPaymentRecord,
  newPurchase,
  purchaseIdOf,
  readRecords,
  recordIdOf,
  tokenOf,
  userIdOf,
} from './testing/payment-store-fixtures.ts';

const DAY = 86_400_000;

const store = new D1PaymentRecordStore(db);
const purchases = new D1PurchaseStore(db);

async function upsert(record: NewPaymentRecord): Promise<void> {
  await db.batch([store.upsertByReference(record)]);
}

async function insertDispute(record: NewPaymentRecord): Promise<void> {
  await db.batch([store.insertDisputeStage(record)]);
}

function rowOf(record: NewPaymentRecord): PaymentRecordRow {
  return {
    id: record.id,
    kind: record.kind,
    purpose: record.purpose,
    amount: record.amount,
    currency: record.currency,
    quantity: record.quantity,
    status: record.status,
    stripeReference: record.stripeReference,
    relatedId: record.relatedId,
    occurredAt: record.occurredAt,
  };
}

function idsOf(rows: readonly PaymentRecordRow[]): string[] {
  return rows.map(({ id }) => id);
}

beforeEach(async () => {
  await clearPaymentTables();
  await insertUser(1);
});

describe('D1PaymentRecordStoreの決済セッションの記録', () => {
  test('購入の版が一致すれば記録し、同じ決済セッションの2回目の記録は重複として無視する', async () => {
    await db.batch([purchases.create(newPurchase(1))]);
    const guard = { purchaseId: purchaseIdOf(1), expectedToken: tokenOf(1) };
    const first = store.insertCheckoutRecordGuarded(
      newPaymentRecord(1, {
        consentedAt: after(1),
        consentVersion: 'checkout-consent-v1',
      }),
      guard,
    );
    const second = store.insertCheckoutRecordGuarded(
      newPaymentRecord(2, { stripeReference: 'cs_test_1' }),
      guard,
    );

    expect(first.guardColumn).toBe('payment_records.pseudonymous_id');
    await db.batch([first.statement]);
    await db.batch([second.statement]);

    expect(await readRecords()).toMatchObject([
      {
        id: recordIdOf(1),
        pseudonymousId: 'pseudonymous-1',
        stripeReference: 'cs_test_1',
        consentedAt: after(1),
        consentVersion: 'checkout-consent-v1',
      },
    ]);
  });

  test('購入の版が変わっていれば、検査の列のNOT NULLの違反で記録しない', async () => {
    await db.batch([purchases.create(newPurchase(1))]);
    const { statement } = store.insertCheckoutRecordGuarded(
      newPaymentRecord(1),
      { purchaseId: purchaseIdOf(1), expectedToken: tokenOf(99) },
    );

    await expect(db.batch([statement])).rejects.toThrow();
    expect(await readRecords()).toEqual([]);
  });
});

describe('D1PaymentRecordStoreの請求・返金の記録', () => {
  test('まだ無い請求は新しい行として記録する', async () => {
    const invoice = newPaymentRecord(1, {
      kind: 'subscription',
      purpose: 'payments_smoke',
      status: 'failed',
      stripeReference: 'in_1',
      occurredAt: after(10),
      lastEventAt: after(10),
      recordedAt: after(10),
    });

    await upsert(invoice);

    expect(await store.listAllByPseudonymousId('pseudonymous-1')).toEqual([
      rowOf(invoice),
    ]);
  });

  test('受け取った発生時刻が記録済みより新しければ、状態・金額・発生時刻を更新する', async () => {
    await upsert(
      newPaymentRecord(1, {
        kind: 'subscription',
        status: 'failed',
        amount: 500,
        stripeReference: 'in_1',
        occurredAt: after(10),
        lastEventAt: after(10),
      }),
    );

    await upsert(
      newPaymentRecord(2, {
        kind: 'subscription',
        status: 'succeeded',
        amount: 700,
        quantity: 2,
        stripeReference: 'in_1',
        occurredAt: after(20),
        lastEventAt: after(20),
      }),
    );

    expect(await readRecords()).toMatchObject([
      {
        id: recordIdOf(1),
        status: 'succeeded',
        amount: 700,
        quantity: 2,
        occurredAt: after(20),
        lastEventAt: after(20),
      },
    ]);
  });

  test('受け取った発生時刻が記録済みと同じでも更新する', async () => {
    await upsert(
      newPaymentRecord(1, {
        kind: 'refund',
        status: 'pending',
        amount: -100,
        stripeReference: 're_1',
        lastEventAt: after(10),
      }),
    );

    await upsert(
      newPaymentRecord(2, {
        kind: 'refund',
        status: 'succeeded',
        amount: -100,
        stripeReference: 're_1',
        lastEventAt: after(10),
      }),
    );

    expect(await readRecords()).toMatchObject([
      { id: recordIdOf(1), status: 'succeeded' },
    ]);
  });

  test('記録済みより古い発生時刻の通知では状態を戻さない', async () => {
    await upsert(
      newPaymentRecord(1, {
        kind: 'refund',
        status: 'succeeded',
        amount: -100,
        stripeReference: 're_1',
        occurredAt: after(5),
        lastEventAt: after(20),
      }),
    );

    await upsert(
      newPaymentRecord(2, {
        kind: 'refund',
        status: 'pending',
        amount: -90,
        stripeReference: 're_1',
        occurredAt: after(1),
        lastEventAt: after(19),
      }),
    );

    expect(await readRecords()).toMatchObject([
      {
        id: recordIdOf(1),
        status: 'succeeded',
        amount: -100,
        occurredAt: after(5),
        lastEventAt: after(20),
      },
    ]);
  });

  test('更新しても、最初の記録の仮名化ID・記録日時・同意の日時と版・購入のIDを保つ', async () => {
    await db.batch([purchases.create(newPurchase(1))]);
    const { statement } = store.insertCheckoutRecordGuarded(
      newPaymentRecord(1, {
        kind: 'subscription',
        stripeReference: 'in_first',
        consentedAt: after(1),
        consentVersion: 'checkout-consent-v1',
        linkFundingSourceGroup: 'link-group',
        relatedId: 'related-1',
        lastEventAt: after(10),
        recordedAt: after(10),
      }),
      { purchaseId: purchaseIdOf(1), expectedToken: tokenOf(1) },
    );
    await db.batch([statement]);

    await upsert(
      newPaymentRecord(2, {
        pseudonymousId: 'pseudonymous-other',
        kind: 'subscription',
        stripeReference: 'in_first',
        purchaseId: null,
        relatedId: null,
        consentedAt: null,
        consentVersion: null,
        linkFundingSourceGroup: null,
        lastEventAt: after(30),
        recordedAt: after(30),
      }),
    );

    expect(await readRecords()).toMatchObject([
      {
        id: recordIdOf(1),
        pseudonymousId: 'pseudonymous-1',
        purchaseId: purchaseIdOf(1),
        relatedId: 'related-1',
        consentedAt: after(1),
        consentVersion: 'checkout-consent-v1',
        linkFundingSourceGroup: 'link-group',
        lastEventAt: after(30),
        recordedAt: after(10),
      },
    ]);
  });

  test('同じStripeのIDでも種類が異なれば別の行にする', async () => {
    await upsert(
      newPaymentRecord(1, { kind: 'one_time', stripeReference: 'ref_1' }),
    );
    await upsert(
      newPaymentRecord(2, {
        kind: 'refund',
        amount: -100,
        stripeReference: 'ref_1',
      }),
    );

    expect(
      idsOf(await store.listAllByPseudonymousId('pseudonymous-1')),
    ).toEqual([recordIdOf(1), recordIdOf(2)]);
  });

  test('チャージバックの記録はチャージバックの段階の挿入でだけ受け付ける', () => {
    expect(() =>
      store.upsertByReference(newPaymentRecord(1, { kind: 'dispute' })),
    ).toThrow(TypeError);
    expect(() =>
      store.insertDisputeStage(newPaymentRecord(1, { kind: 'refund' })),
    ).toThrow(TypeError);
  });
});

describe('D1PaymentRecordStoreのチャージバックの記録', () => {
  test('段階ごとに行を追加し、同じ段階の2回目は重複として無視する', async () => {
    const disputed = newPaymentRecord(1, {
      kind: 'dispute',
      status: 'disputed',
      amount: -100,
      stripeReference: 'dp_1',
      occurredAt: after(10),
    });
    const won = newPaymentRecord(2, {
      kind: 'dispute',
      status: 'dispute_won',
      amount: 100,
      stripeReference: 'dp_1',
      occurredAt: after(20),
    });

    await insertDispute(disputed);
    await insertDispute(won);
    await insertDispute(
      newPaymentRecord(3, {
        kind: 'dispute',
        status: 'disputed',
        amount: -90,
        stripeReference: 'dp_1',
        occurredAt: after(30),
      }),
    );

    expect(await store.listAllByPseudonymousId('pseudonymous-1')).toEqual([
      rowOf(disputed),
      rowOf(won),
    ]);
  });
});

describe('D1PaymentRecordStoreの一覧', () => {
  async function seedHistory(): Promise<void> {
    await upsert(newPaymentRecord(1, { occurredAt: after(10) }));
    await upsert(newPaymentRecord(2, { occurredAt: after(30) }));
    await upsert(newPaymentRecord(3, { occurredAt: after(20) }));
    await upsert(newPaymentRecord(4, { occurredAt: after(20) }));
    await upsert(newPaymentRecord(5, { occurredAt: after(40) }));
    await upsert(
      newPaymentRecord(6, {
        pseudonymousId: 'pseudonymous-2',
        occurredAt: after(50),
      }),
    );
  }

  test('仮名化IDの記録を発生時刻の降順・IDの降順で、指定の件数まで返す', async () => {
    await seedHistory();

    const page = await store.listByPseudonymousId({
      pseudonymousId: 'pseudonymous-1',
      first: 3,
      after: null,
    });

    expect(idsOf(page)).toEqual([recordIdOf(5), recordIdOf(2), recordIdOf(4)]);
    expect(page[0]).toEqual(
      rowOf(newPaymentRecord(5, { occurredAt: after(40) })),
    );
  });

  test('カーソルの行を含まず、それより前の行から続きを返す', async () => {
    await seedHistory();

    const next = await store.listByPseudonymousId({
      pseudonymousId: 'pseudonymous-1',
      first: 3,
      after: { occurredAt: after(20), id: recordIdOf(4) },
    });

    expect(idsOf(next)).toEqual([recordIdOf(3), recordIdOf(1)]);
  });

  test('記録が無い仮名化IDは空の一覧を返す', async () => {
    await seedHistory();

    expect(
      await store.listByPseudonymousId({
        pseudonymousId: 'pseudonymous-none',
        first: 20,
        after: null,
      }),
    ).toEqual([]);
  });

  test('全件の読み出しは仮名化IDの記録を発生時刻の昇順・IDの昇順で返す', async () => {
    await seedHistory();

    expect(
      idsOf(await store.listAllByPseudonymousId('pseudonymous-1')),
    ).toEqual([
      recordIdOf(1),
      recordIdOf(3),
      recordIdOf(4),
      recordIdOf(2),
      recordIdOf(5),
    ]);
  });
});

describe('D1PaymentRecordStoreの保持期間を過ぎた記録の削除', () => {
  test('記録日時が基準より前の記録を、古い順に上限の件数まで消して件数を返す', async () => {
    await upsert(newPaymentRecord(1, { recordedAt: after(3 * DAY) }));
    await upsert(newPaymentRecord(2, { recordedAt: after(1 * DAY) }));
    await upsert(newPaymentRecord(3, { recordedAt: after(2 * DAY) }));
    await upsert(newPaymentRecord(4, { recordedAt: after(5 * DAY) }));
    await upsert(newPaymentRecord(5, { recordedAt: after(4 * DAY) }));

    expect(await store.deleteRecordedBefore(after(5 * DAY), 2)).toBe(2);
    expect((await readRecords()).map(({ id }) => id)).toEqual([
      recordIdOf(1),
      recordIdOf(4),
      recordIdOf(5),
    ]);

    expect(await store.deleteRecordedBefore(after(5 * DAY), 2)).toBe(2);
    expect(await store.deleteRecordedBefore(after(5 * DAY), 2)).toBe(0);
    expect((await readRecords()).map(({ id }) => id)).toEqual([recordIdOf(4)]);
  });
});

describe('D1PaymentRecordStoreの利用者との結び付き', () => {
  test('決済履歴の行に利用者の主キーが入らない', async () => {
    await db.batch([purchases.create(newPurchase(1))]);
    const { statement } = store.insertCheckoutRecordGuarded(
      newPaymentRecord(1),
      { purchaseId: purchaseIdOf(1), expectedToken: tokenOf(1) },
    );
    await db.batch([statement]);
    await upsert(newPaymentRecord(2, { kind: 'refund', amount: -100 }));
    await insertDispute(
      newPaymentRecord(3, { kind: 'dispute', status: 'disputed' }),
    );

    const rows = await readRecords();

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain('userId');
      expect(Object.values(row)).not.toContain(userIdOf(1));
    }
  });
});
