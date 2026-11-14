import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { paymentRecords } from '../../../db/schema/payments/payment-records.ts';
import { checkoutRecordGuardedInsert } from './checkout-record-guard.ts';
import { D1PurchaseStore } from './d1-purchase-store.ts';
import { D1StripeObjectStore } from './d1-stripe-object-store.ts';
import { D1GuardedBatch } from './guarded-batch.ts';
import {
  after,
  clearPaymentTables,
  db,
  insertUser,
  newPaymentRecord,
  newPurchase,
  purchaseIdOf,
  readPurchaseRow,
  readRecords,
  readStripeObjects,
  recordIdOf,
  tokenOf,
} from './testing/payment-store-fixtures.ts';

const purchases = new D1PurchaseStore(db);
const stripeObjects = new D1StripeObjectStore(db);
const guardedBatch = new D1GuardedBatch(db);

async function createPurchase(
  ...columns: Parameters<typeof newPurchase>
): Promise<void> {
  await db.batch([purchases.create(newPurchase(...columns))]);
}

// 決済セッションの反映と同じく、決済履歴の記録を先頭に、購入の前進を続ける一括の書き込み
function fulfillment(input: {
  readonly index: number;
  readonly recordIndex: number;
  readonly expectedToken: string;
  readonly nextToken: string;
  readonly stripeReference?: string;
}) {
  return {
    guarded: checkoutRecordGuardedInsert(
      db,
      newPaymentRecord(input.recordIndex, {
        purchaseId: purchaseIdOf(input.index),
        stripeReference:
          input.stripeReference ?? `cs_test_${String(input.index)}`,
      }),
      {
        purchaseId: purchaseIdOf(input.index),
        expectedToken: input.expectedToken,
      },
    ),
    rest: [
      purchases.advance({
        purchaseId: purchaseIdOf(input.index),
        to: 'fulfilled',
        from: ['open', 'processing', 'superseded'],
        nextToken: input.nextToken,
        patch: { paidAt: after(1), reflectedAt: after(1) },
      }),
    ],
  };
}

beforeEach(async () => {
  await clearPaymentTables();
  await insertUser(1);
});

describe('D1GuardedBatchと決済履歴の記録の版の検査', () => {
  test('購入のstate_tokenが読み取った版と一致すれば、記録と前進が確定する', async () => {
    await createPurchase(1);

    expect(
      await guardedBatch.run(
        fulfillment({
          index: 1,
          recordIndex: 1,
          expectedToken: tokenOf(1),
          nextToken: tokenOf(101),
        }),
      ),
    ).toBe('committed');

    expect(await readRecords()).toMatchObject([
      { id: recordIdOf(1), pseudonymousId: 'pseudonymous-1' },
    ]);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'fulfilled',
      stateToken: tokenOf(101),
    });
  });

  test('他の書き込みが先に購入を前進させていれば、全体が取り消されてguard_failedになる', async () => {
    await createPurchase(1);
    await db.batch([
      purchases.advance({
        purchaseId: purchaseIdOf(1),
        to: 'processing',
        from: ['open'],
        nextToken: tokenOf(50),
        patch: {},
      }),
    ]);

    expect(
      await guardedBatch.run(
        fulfillment({
          index: 1,
          recordIndex: 1,
          expectedToken: tokenOf(1),
          nextToken: tokenOf(101),
        }),
      ),
    ).toBe('guard_failed');

    expect(await readRecords()).toEqual([]);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'processing',
      stateToken: tokenOf(50),
    });
  });

  test('購入が無ければguard_failedになる', async () => {
    expect(
      await guardedBatch.run({
        guarded: checkoutRecordGuardedInsert(db, newPaymentRecord(1), {
          purchaseId: purchaseIdOf(9),
          expectedToken: tokenOf(9),
        }),
        rest: [],
      }),
    ).toBe('guard_failed');
    expect(await readRecords()).toEqual([]);
  });

  test('先頭の記録が一意キーと衝突しても版の検査が働き、版が一致すれば既存の行を変えずに確定する', async () => {
    await createPurchase(1);
    // 初回の請求の行が決済セッションの反映より先に記録された場合
    await db.insert(paymentRecords).values(
      newPaymentRecord(9, {
        kind: 'subscription',
        stripeReference: 'in_first',
        amount: 500,
      }),
    );
    const subscriptionFulfillment = (
      expectedToken: string,
      nextToken: string,
    ) => {
      const base = fulfillment({
        index: 1,
        recordIndex: 1,
        expectedToken,
        nextToken,
      });
      return {
        ...base,
        guarded: checkoutRecordGuardedInsert(
          db,
          newPaymentRecord(1, {
            kind: 'subscription',
            stripeReference: 'in_first',
          }),
          { purchaseId: purchaseIdOf(1), expectedToken },
        ),
      };
    };

    expect(
      await guardedBatch.run(subscriptionFulfillment(tokenOf(7), tokenOf(101))),
    ).toBe('guard_failed');
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'open',
    });

    expect(
      await guardedBatch.run(subscriptionFulfillment(tokenOf(1), tokenOf(101))),
    ).toBe('committed');
    expect(await readRecords()).toMatchObject([
      { id: recordIdOf(9), amount: 500 },
    ]);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'fulfilled',
    });
  });

  test('同時に2つの前進を一括の書き込みにしても1つだけが確定する', async () => {
    await createPurchase(1);

    const results = await Promise.all([
      guardedBatch.run(
        fulfillment({
          index: 1,
          recordIndex: 1,
          expectedToken: tokenOf(1),
          nextToken: tokenOf(101),
        }),
      ),
      guardedBatch.run(
        fulfillment({
          index: 1,
          recordIndex: 2,
          expectedToken: tokenOf(1),
          nextToken: tokenOf(102),
          stripeReference: 'cs_test_other',
        }),
      ),
    ]);

    expect([...results].sort()).toEqual(['committed', 'guard_failed']);
    const records = await readRecords();
    expect(records).toHaveLength(1);
    const winner = results[0] === 'committed' ? tokenOf(101) : tokenOf(102);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'fulfilled',
      stateToken: winner,
    });
  });
});

describe('D1GuardedBatchの違反の判別', () => {
  test('exclusivity_keyの部分一意索引の違反はconstraint_failedになり、全体が取り消される', async () => {
    await createPurchase(1, { exclusivityKey: 'sponsorship:t1' });
    await createPurchase(2, { exclusivityKey: 'sponsorship:t1' });
    expect(
      await guardedBatch.run(
        fulfillment({
          index: 1,
          recordIndex: 1,
          expectedToken: tokenOf(1),
          nextToken: tokenOf(101),
        }),
      ),
    ).toBe('committed');

    expect(
      await guardedBatch.run(
        fulfillment({
          index: 2,
          recordIndex: 2,
          expectedToken: tokenOf(2),
          nextToken: tokenOf(102),
        }),
      ),
    ).toBe('constraint_failed');

    expect(await readRecords()).toMatchObject([{ id: recordIdOf(1) }]);
    expect(await readPurchaseRow(purchaseIdOf(2))).toMatchObject({
      status: 'open',
      stateToken: tokenOf(2),
    });
  });

  test('後続の文の外部キーの違反はconstraint_failedになる', async () => {
    await createPurchase(1);
    const base = fulfillment({
      index: 1,
      recordIndex: 1,
      expectedToken: tokenOf(1),
      nextToken: tokenOf(101),
    });

    expect(
      await guardedBatch.run({
        ...base,
        rest: [
          ...base.rest,
          purchases.create(newPurchase(2, { userId: 'missing-user' })),
        ],
      }),
    ).toBe('constraint_failed');
    expect(await readRecords()).toEqual([]);
  });

  test('後続の文の別の列のNOT NULLの違反は、検査の列と重ならないためconstraint_failedになる', async () => {
    await createPurchase(1);
    await db.batch([
      stripeObjects.advanceGuarded({
        objectId: 'sub_1',
        objectType: 'subscription',
        occurredAt: after(100),
      }).statement,
    ]);
    const base = fulfillment({
      index: 1,
      recordIndex: 1,
      expectedToken: tokenOf(1),
      nextToken: tokenOf(101),
    });

    expect(
      await guardedBatch.run({
        ...base,
        rest: [
          ...base.rest,
          stripeObjects.advanceGuarded({
            objectId: 'sub_1',
            objectType: 'subscription',
            occurredAt: after(50),
          }).statement,
        ],
      }),
    ).toBe('constraint_failed');
    expect(await readRecords()).toEqual([]);
  });

  test('制約の違反でない失敗は例外のまま返し、全体が取り消される', async () => {
    await createPurchase(1);
    const base = fulfillment({
      index: 1,
      recordIndex: 1,
      expectedToken: tokenOf(1),
      nextToken: tokenOf(101),
    });

    await expect(
      guardedBatch.run({
        ...base,
        rest: [...base.rest, db.run(sql`INSERT INTO missing_table VALUES (1)`)],
      }),
    ).rejects.toThrow(/missing_table/u);
    expect(await readRecords()).toEqual([]);
  });
});

describe('D1GuardedBatchと定期課金の発生時刻の検査', () => {
  function subscriptionAdvance(occurredAt: Date, purchaseIndex: number) {
    return {
      guarded: stripeObjects.advanceGuarded({
        objectId: 'sub_1',
        objectType: 'subscription',
        occurredAt,
      }),
      rest: [purchases.create(newPurchase(purchaseIndex))],
    };
  }

  test('より新しい発生時刻が記録済みなら、後続の文を含めて全体が取り消される', async () => {
    expect(await guardedBatch.run(subscriptionAdvance(after(100), 1))).toBe(
      'committed',
    );

    expect(await guardedBatch.run(subscriptionAdvance(after(99), 2))).toBe(
      'guard_failed',
    );

    expect(await readPurchaseRow(purchaseIdOf(2))).toBeUndefined();
    expect(await readStripeObjects()).toMatchObject([
      { objectId: 'sub_1', lastEventAt: after(100) },
    ]);
  });

  test('同じ発生時刻と新しい発生時刻の通知は通る', async () => {
    expect(await guardedBatch.run(subscriptionAdvance(after(100), 1))).toBe(
      'committed',
    );
    expect(await guardedBatch.run(subscriptionAdvance(after(100), 2))).toBe(
      'committed',
    );
    expect(await guardedBatch.run(subscriptionAdvance(after(200), 3))).toBe(
      'committed',
    );

    expect(await readPurchaseRow(purchaseIdOf(3))).toBeDefined();
    expect(await readStripeObjects()).toMatchObject([
      {
        objectId: 'sub_1',
        objectType: 'subscription',
        lastEventAt: after(200),
      },
    ]);
  });
});
