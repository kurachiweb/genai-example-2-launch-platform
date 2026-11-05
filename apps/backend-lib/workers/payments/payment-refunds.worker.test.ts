import { resetSync } from '@logtape/logtape';
import { asc } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import type { PurchaseStatus } from '../../../common-lib/payments/purchase-states.ts';
import { paymentRefunds } from '../../../db/schema/payments/payment-refunds.ts';
import { createUlidGenerator } from '../../core/ids/id-generator.ts';
import { MESSAGE_CONTRACTS } from '../../core/messaging/contracts/index.ts';
import type { QueueEnvelope } from '../../core/messaging/envelope.ts';
import type {
  RefundRequestInput,
  RefundStore,
} from '../../core/payments/ports.ts';
import { PAYMENTS_REFUND_MESSAGE } from '../../core/payments/refund-message.ts';
import type { Clock } from '../../core/time/clock.ts';
import { createMessagePublisher } from '../messaging/queue-publisher.ts';
import { D1PaymentRecordStore } from './d1-payment-record-store.ts';
import { D1PurchaseStore } from './d1-purchase-store.ts';
import { D1RefundStore } from './d1-refund-store.ts';
import { D1GuardedBatch } from './guarded-batch.ts';
import { D1PaymentRefunds } from './payment-refunds.ts';
import { recordLogs } from './testing/fake-stripe.ts';
import {
  after,
  clearPaymentTables,
  db,
  insertUser,
  newPaymentRecord,
  newPurchase,
  newRefundRequest,
  purchaseIdOf,
  T0,
  tokenOf,
} from './testing/payment-store-fixtures.ts';

const PAID = 1_000;
const PAYMENT_INTENT_ID = 'pi_test_refunds_1';
// 返金のメッセージの本文はULIDに限る
const DISPATCH_ID = '01JC0ZZZZZZZZZZZZZZZZZZZZ1';

const purchases = new D1PurchaseStore(db);
const refunds = new D1RefundStore(db);
const paymentRecords = new D1PaymentRecordStore(db);
const guardedBatch = new D1GuardedBatch(db);

interface RecordingQueue {
  readonly queue: Queue<QueueEnvelope>;
  readonly sent: QueueEnvelope[];
}

function createRecordingQueue(failure?: Error): RecordingQueue {
  const sent: QueueEnvelope[] = [];
  const queue: Queue<QueueEnvelope> = {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: (body) => {
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      sent.push(body);
      return Promise.resolve({
        metadata: { metrics: { backlogCount: sent.length, backlogBytes: 0 } },
      });
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
  return { queue, sent };
}

const clock: Clock = { now: () => after(60_000) };

function refundsWith(
  queue: Queue<QueueEnvelope>,
  refundStore: RefundStore = refunds,
): D1PaymentRefunds {
  const ids = createUlidGenerator(clock);
  return new D1PaymentRefunds({
    appName: 'api',
    db,
    purchases,
    refunds: refundStore,
    refundStatements: refunds,
    publisher: createMessagePublisher(queue, MESSAGE_CONTRACTS, ids, clock),
    ids,
    clock,
  });
}

function inputOf(
  overrides: Partial<RefundRequestInput> = {},
): RefundRequestInput {
  return {
    purchaseId: purchaseIdOf(1),
    amount: null,
    reason: 'entitlement_lost',
    requestKey: 'tournament-week:entry-1',
    ...overrides,
  };
}

async function insertPurchase(
  index: number,
  options: {
    readonly status?: PurchaseStatus;
    readonly paymentIntentId?: string | null;
  } = {},
): Promise<void> {
  const status = options.status ?? 'fulfilled';
  await db.batch([purchases.create(newPurchase(index, { amountTotal: PAID }))]);
  if (status !== 'open') {
    await db.batch([
      purchases.advance({
        purchaseId: purchaseIdOf(index),
        to: status,
        from: ['open'],
        nextToken: tokenOf(index + 1000),
        patch: {
          stripePaymentIntentId:
            options.paymentIntentId === undefined
              ? PAYMENT_INTENT_ID
              : options.paymentIntentId,
        },
      }),
    ]);
  }
}

async function readRefundRows(): Promise<
  (typeof paymentRefunds.$inferSelect)[]
> {
  return db
    .select()
    .from(paymentRefunds)
    .orderBy(asc(paymentRefunds.createdAt), asc(paymentRefunds.id));
}

beforeEach(async () => {
  await clearPaymentTables();
  await insertUser(1);
});

afterAll(() => {
  resetSync();
});

describe('D1PaymentRefunds.request', () => {
  test('金額を省いた依頼は残りの全額で記録し、返金のメッセージを送って送信の日時を記録し、Stripeの呼び出しを待たずに受け付ける', async () => {
    await insertPurchase(1);
    const { queue, sent } = createRecordingQueue();

    const result = await refundsWith(queue).request(inputOf());

    expect(result).toMatchObject({ kind: 'accepted', duplicate: false });
    if (result.kind !== 'accepted') {
      throw new Error('受け付けられませんでした');
    }
    const rows = await readRefundRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.refundRequestId,
      purchaseId: purchaseIdOf(1),
      requestKey: 'tournament-week:entry-1',
      amount: PAID,
      reason: 'entitlement_lost',
      status: 'requested',
      stripeRefundId: null,
      noticeStatus: 'none',
      dispatchedAt: clock.now(),
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: PAYMENTS_REFUND_MESSAGE.type,
      body: { refundRequestId: result.refundRequestId },
    });
  });

  test('一部の金額の依頼はその金額で記録し、続く全額の依頼は残りの額になる', async () => {
    await insertPurchase(1);
    const { queue } = createRecordingQueue();
    const component = refundsWith(queue);

    await component.request(inputOf({ amount: 300, requestKey: 'partial' }));
    await component.request(inputOf({ amount: null, requestKey: 'rest' }));

    expect(
      (await readRefundRows()).map(({ requestKey, amount }) => ({
        requestKey,
        amount,
      })),
    ).toEqual([
      { requestKey: 'partial', amount: 300 },
      { requestKey: 'rest', amount: PAID - 300 },
    ]);
  });

  test('拒否の購入(自動返金の対象になり得る購入)も支払い済みとして受け付ける', async () => {
    await insertPurchase(1, { status: 'rejected' });
    const { queue } = createRecordingQueue();

    await expect(
      refundsWith(queue).request(inputOf({ amount: 100 })),
    ).resolves.toMatchObject({ kind: 'accepted', duplicate: false });
  });

  test('同じ依頼キーの2回目は、金額や理由が異なり残りの額を超えていても既存の依頼を重複として返し、行を増やさない', async () => {
    await insertPurchase(1);
    const { queue } = createRecordingQueue();
    const component = refundsWith(queue);
    const first = await component.request(inputOf());

    const second = await component.request(
      inputOf({ amount: PAID * 5, reason: 'duplicate' }),
    );

    expect(first.kind).toBe('accepted');
    expect(second).toEqual({
      kind: 'accepted',
      refundRequestId:
        first.kind === 'accepted' ? first.refundRequestId : undefined,
      duplicate: true,
    });
    expect(await readRefundRows()).toHaveLength(1);
  });

  test('照会の後に同じ依頼キーの依頼が先に確定していれば、一意制約の違反をその依頼の重複として返す', async () => {
    await insertPurchase(1);
    await db.batch([
      refunds.insert(
        newRefundRequest(1, {
          id: DISPATCH_ID,
          requestKey: inputOf().requestKey,
          amount: 100,
        }),
      ),
    ]);
    let lookups = 0;
    const racingStore: RefundStore = Object.assign(
      Object.create(refunds) as RefundStore,
      {
        findByRequestKey: async (requestKey: string) => {
          lookups += 1;
          return lookups === 1
            ? undefined
            : refunds.findByRequestKey(requestKey);
        },
      },
    );
    const { queue, sent } = createRecordingQueue();

    const result = await refundsWith(queue, racingStore).request(
      inputOf({ amount: 100 }),
    );

    expect(result).toEqual({
      kind: 'accepted',
      refundRequestId: DISPATCH_ID,
      duplicate: true,
    });
    expect(await readRefundRows()).toHaveLength(1);
    expect(sent.map(({ body }) => body)).toEqual([
      { refundRequestId: DISPATCH_ID },
    ]);
  });

  test('支払額から依頼済みの額を除いた残りを超える依頼は拒否し、記録も送信もしない', async () => {
    await insertPurchase(1);
    const { queue, sent } = createRecordingQueue();
    const component = refundsWith(queue);
    await component.request(inputOf({ amount: 600, requestKey: 'first' }));

    const result = await component.request(
      inputOf({ amount: 401, requestKey: 'second' }),
    );

    expect(result).toEqual({
      kind: 'rejected',
      code: 'amount_exceeds_refundable',
    });
    expect(await readRefundRows()).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  test('失敗・取り消しの依頼は残りの額に数えない', async () => {
    await insertPurchase(1);
    await db.batch([refunds.insert(newRefundRequest(1, { amount: PAID }))]);
    await refunds.updateStatus({
      refundRequestId: newRefundRequest(1).id,
      status: 'failed',
    });
    const { queue } = createRecordingQueue();

    await expect(
      refundsWith(queue).request(inputOf({ amount: PAID })),
    ).resolves.toMatchObject({ kind: 'accepted' });
  });

  test.each([0, -1, 1.5])(
    '金額%sの依頼はinvalid_amountで拒否する',
    async (amount) => {
      await insertPurchase(1);
      const { queue } = createRecordingQueue();

      await expect(
        refundsWith(queue).request(inputOf({ amount })),
      ).resolves.toEqual({ kind: 'rejected', code: 'invalid_amount' });
      expect(await readRefundRows()).toEqual([]);
    },
  );

  test.each<[string, PurchaseStatus, string | null]>([
    ['未完了の購入', 'open', null],
    ['処理中の購入', 'processing', PAYMENT_INTENT_ID],
    ['失効した購入', 'expired', null],
    ['PaymentIntentのIDが無い完了の購入', 'fulfilled', null],
  ])(
    '%sは未確定としてnot_paidで拒否する',
    async (_, status, paymentIntentId) => {
      await insertPurchase(1, { status, paymentIntentId });
      const { queue, sent } = createRecordingQueue();

      await expect(refundsWith(queue).request(inputOf())).resolves.toEqual({
        kind: 'rejected',
        code: 'not_paid',
      });
      expect(await readRefundRows()).toEqual([]);
      expect(sent).toEqual([]);
    },
  );

  test('存在しない購入はpurchase_not_foundで拒否する', async () => {
    const { queue } = createRecordingQueue();

    await expect(
      refundsWith(queue).request(inputOf({ purchaseId: purchaseIdOf(9) })),
    ).resolves.toEqual({ kind: 'rejected', code: 'purchase_not_found' });
  });

  test.each([
    ['空', ''],
    ['129文字', 'k'.repeat(129)],
    ['reflection:で始まる', 'reflection:anything'],
  ])('依頼キーが%sならinvalid_request_keyで拒否する', async (_, requestKey) => {
    await insertPurchase(1);
    const { queue } = createRecordingQueue();

    await expect(
      refundsWith(queue).request(inputOf({ requestKey })),
    ).resolves.toEqual({ kind: 'rejected', code: 'invalid_request_key' });
    expect(await readRefundRows()).toEqual([]);
  });

  test('128文字の依頼キーは受け付ける', async () => {
    await insertPurchase(1);
    const { queue } = createRecordingQueue();

    await expect(
      refundsWith(queue).request(inputOf({ requestKey: 'k'.repeat(128) })),
    ).resolves.toMatchObject({ kind: 'accepted' });
  });

  test('依頼キーの形式の検査は照会より先で、既に存在するreflection:の依頼キーでも重複ではなくinvalid_request_keyで拒否する', async () => {
    await insertPurchase(1, { status: 'rejected' });
    const requestKey = `reflection:${purchaseIdOf(1)}`;
    await db.batch([
      refunds.insert(newRefundRequest(1, { requestKey, amount: PAID })),
    ]);
    const { queue } = createRecordingQueue();

    await expect(
      refundsWith(queue).request(inputOf({ requestKey })),
    ).resolves.toEqual({ kind: 'rejected', code: 'invalid_request_key' });
  });

  test('理由が小文字・数字・_の1〜64文字でなければ、呼び出し側の誤りとして例外にする', async () => {
    await insertPurchase(1);
    const { queue } = createRecordingQueue();

    await expect(
      refundsWith(queue).request(inputOf({ reason: 'Entitlement-Lost' })),
    ).rejects.toThrow(RangeError);
    expect(await readRefundRows()).toEqual([]);
  });

  test('送信に失敗しても依頼は受け付け、送信待ちの行が残ってwarningのログになる', async () => {
    const logs = recordLogs();
    await insertPurchase(1);
    const { queue } = createRecordingQueue(new Error('Queueへの送信に失敗'));

    const result = await refundsWith(queue).request(inputOf());

    expect(result).toMatchObject({ kind: 'accepted', duplicate: false });
    const [row] = await readRefundRows();
    expect(row?.dispatchedAt).toBeNull();
    expect(
      (
        await refunds.findUndispatched({
          createdBefore: after(1e12),
          limit: 10,
        })
      ).map(({ id }) => id),
    ).toEqual([row?.id]);
    expect(logs.filter(({ method }) => method === 'warn')).toHaveLength(1);
  });

  test('送信に失敗した依頼の2回目は重複として返し、送り直す', async () => {
    recordLogs();
    await insertPurchase(1);
    const failing = createRecordingQueue(new Error('Queueへの送信に失敗'));
    await refundsWith(failing.queue).request(inputOf());
    const { queue, sent } = createRecordingQueue();

    const result = await refundsWith(queue).request(inputOf());

    expect(result).toMatchObject({ kind: 'accepted', duplicate: true });
    expect(sent).toHaveLength(1);
    expect((await readRefundRows())[0]?.dispatchedAt).toEqual(clock.now());
  });
});

describe('D1PaymentRefunds.prepare', () => {
  test('依頼の行の文を返すだけで書き込まず、依頼元が確定するまで行は無い', async () => {
    await insertPurchase(1);
    const { queue, sent } = createRecordingQueue();

    const result = await refundsWith(queue).prepare(inputOf({ amount: 200 }));

    expect(result).toMatchObject({ kind: 'accepted', duplicate: false });
    if (result.kind !== 'accepted') {
      throw new Error('受け付けられませんでした');
    }
    expect(result.statements).toHaveLength(1);
    expect(await readRefundRows()).toEqual([]);
    expect(sent).toEqual([]);
  });

  test('依頼元の一括の書き込みで確定した後のdispatchで送り、2回目のdispatchは何もしない', async () => {
    await insertPurchase(1);
    const { queue, sent } = createRecordingQueue();
    const component = refundsWith(queue);
    const result = await component.prepare(inputOf({ amount: 200 }));
    if (result.kind !== 'accepted') {
      throw new Error('受け付けられませんでした');
    }
    const [statement, ...rest] = result.statements;
    if (statement === undefined) {
      throw new Error('文がありません');
    }
    await db.batch([statement, ...rest]);

    await component.dispatch(result.refundRequestId);
    await component.dispatch(result.refundRequestId);

    expect(await readRefundRows()).toEqual([
      expect.objectContaining({
        id: result.refundRequestId,
        amount: 200,
        status: 'requested',
        noticeStatus: 'none',
        dispatchedAt: clock.now(),
      }),
    ]);
    expect(sent.map(({ body }) => body)).toEqual([
      { refundRequestId: result.refundRequestId },
    ]);
  });

  test('同じ依頼キーの2回目は、金額や理由が異なり残りの額を超えていても既存の依頼の識別と重複の印と空の文を返す', async () => {
    await insertPurchase(1);
    const { queue } = createRecordingQueue();
    const component = refundsWith(queue);
    const first = await component.request(inputOf());
    if (first.kind !== 'accepted') {
      throw new Error('受け付けられませんでした');
    }

    const second = await component.prepare(
      inputOf({ amount: PAID * 2, reason: 'late' }),
    );

    expect(second).toEqual({
      kind: 'accepted',
      refundRequestId: first.refundRequestId,
      duplicate: true,
      statements: [],
    });
    expect(await readRefundRows()).toHaveLength(1);
  });

  test('確定前の2つの依頼の文が同じ依頼キーで重なると、後から確定する一括の書き込みが一意制約で失敗する', async () => {
    await insertPurchase(1);
    const { queue } = createRecordingQueue();
    const component = refundsWith(queue);
    const first = await component.prepare(inputOf({ amount: 100 }));
    const second = await component.prepare(inputOf({ amount: 100 }));
    if (first.kind !== 'accepted' || second.kind !== 'accepted') {
      throw new Error('受け付けられませんでした');
    }
    expect(second.duplicate).toBe(false);
    const [firstStatement] = first.statements;
    const [secondStatement] = second.statements;
    if (firstStatement === undefined || secondStatement === undefined) {
      throw new Error('文がありません');
    }

    await db.batch([firstStatement]);

    await expect(db.batch([secondStatement])).rejects.toThrow();
    expect(await readRefundRows()).toHaveLength(1);
    await expect(component.prepare(inputOf())).resolves.toMatchObject({
      kind: 'accepted',
      refundRequestId: first.refundRequestId,
      duplicate: true,
    });
  });

  test.each([
    ['空', ''],
    ['reflection:で始まる', 'reflection:anything'],
  ])('依頼キーが%sならinvalid_request_keyで拒否する', async (_, requestKey) => {
    await insertPurchase(1);
    const { queue } = createRecordingQueue();

    await expect(
      refundsWith(queue).prepare(inputOf({ requestKey })),
    ).resolves.toEqual({ kind: 'rejected', code: 'invalid_request_key' });
  });

  test('既に存在するreflection:の依頼キーでも重複ではなくinvalid_request_keyで拒否する', async () => {
    await insertPurchase(1, { status: 'rejected' });
    const requestKey = `reflection:${purchaseIdOf(1)}`;
    await db.batch([
      refunds.insert(newRefundRequest(1, { requestKey, amount: PAID })),
    ]);
    const { queue } = createRecordingQueue();

    await expect(
      refundsWith(queue).prepare(inputOf({ requestKey })),
    ).resolves.toEqual({ kind: 'rejected', code: 'invalid_request_key' });
  });

  test('支払額を超える依頼・未確定・存在しない購入を拒否する', async () => {
    await insertPurchase(1);
    await insertPurchase(2, { status: 'open' });
    const { queue } = createRecordingQueue();
    const component = refundsWith(queue);

    await expect(
      component.prepare(inputOf({ amount: PAID + 1 })),
    ).resolves.toEqual({ kind: 'rejected', code: 'amount_exceeds_refundable' });
    await expect(
      component.prepare(inputOf({ purchaseId: purchaseIdOf(2) })),
    ).resolves.toEqual({ kind: 'rejected', code: 'not_paid' });
    await expect(
      component.prepare(inputOf({ purchaseId: purchaseIdOf(9) })),
    ).resolves.toEqual({ kind: 'rejected', code: 'purchase_not_found' });
  });
});

describe('D1PaymentRefunds.prepareForReflection', () => {
  test('購入の状態とPaymentIntentのIDを検査せず、読み書きもせずに、引数の支払額で全額の依頼の文を返す', async () => {
    await insertPurchase(1, { status: 'open' });
    const { queue, sent } = createRecordingQueue();

    const result = refundsWith(queue).prepareForReflection({
      purchaseId: purchaseIdOf(1),
      amountPaid: 750,
      reason: 'late',
      requestKey: `reflection:${purchaseIdOf(1)}`,
    });

    expect(result.statements).toHaveLength(1);
    expect(result.refundRequestId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(await readRefundRows()).toEqual([]);
    expect(sent).toEqual([]);
  });

  test('前進の文と同じ一括の書き込みが確定すると、自動返金の通知が依頼待ちの依頼の行ができる', async () => {
    await insertPurchase(1, { status: 'open' });
    const { queue } = createRecordingQueue();
    const result = refundsWith(queue).prepareForReflection({
      purchaseId: purchaseIdOf(1),
      amountPaid: 750,
      reason: 'duplicate',
      requestKey: `reflection:${purchaseIdOf(1)}`,
    });

    const outcome = await guardedBatch.run({
      guarded: paymentRecords.insertCheckoutRecordGuarded(newPaymentRecord(1), {
        purchaseId: purchaseIdOf(1),
        expectedToken: tokenOf(1),
      }),
      rest: [
        purchases.advance({
          purchaseId: purchaseIdOf(1),
          to: 'rejected',
          from: ['open'],
          nextToken: tokenOf(2001),
          patch: { rejectionReason: 'duplicate' },
        }),
        ...result.statements,
      ],
    });

    expect(outcome).toBe('committed');
    expect(await readRefundRows()).toEqual([
      expect.objectContaining({
        id: result.refundRequestId,
        purchaseId: purchaseIdOf(1),
        requestKey: `reflection:${purchaseIdOf(1)}`,
        amount: 750,
        reason: 'duplicate',
        status: 'requested',
        noticeStatus: 'pending',
        dispatchedAt: null,
      }),
    ]);
  });

  test('前進の文の版の検査が失敗すると、依頼の行も作られない', async () => {
    await insertPurchase(1, { status: 'open' });
    const { queue } = createRecordingQueue();
    const result = refundsWith(queue).prepareForReflection({
      purchaseId: purchaseIdOf(1),
      amountPaid: 750,
      reason: 'late',
      requestKey: `reflection:${purchaseIdOf(1)}`,
    });

    const outcome = await guardedBatch.run({
      guarded: paymentRecords.insertCheckoutRecordGuarded(newPaymentRecord(1), {
        purchaseId: purchaseIdOf(1),
        expectedToken: tokenOf(999),
      }),
      rest: [...result.statements],
    });

    expect(outcome).toBe('guard_failed');
    expect(await readRefundRows()).toEqual([]);
  });

  test('依頼キーがreflection:<購入ID>でなければ、呼び出し側の誤りとして例外にする', () => {
    const { queue } = createRecordingQueue();

    expect(() =>
      refundsWith(queue).prepareForReflection({
        purchaseId: purchaseIdOf(1),
        amountPaid: 750,
        reason: 'late',
        requestKey: `reflection:${purchaseIdOf(2)}`,
      }),
    ).toThrow(RangeError);
  });
});

describe('D1PaymentRefunds.dispatch', () => {
  test('送信に失敗すると送信の日時を記録せず、例外にしない', async () => {
    const logs = recordLogs();
    await insertPurchase(1);
    await db.batch([refunds.insert(newRefundRequest(1, { id: DISPATCH_ID }))]);
    const { queue } = createRecordingQueue(new Error('Queueへの送信に失敗'));

    await expect(
      refundsWith(queue).dispatch(DISPATCH_ID),
    ).resolves.toBeUndefined();

    expect((await readRefundRows())[0]?.dispatchedAt).toBeNull();
    expect(logs.filter(({ method }) => method === 'warn')).toHaveLength(1);
  });

  test('存在しない依頼は送らない', async () => {
    recordLogs();
    const { queue, sent } = createRecordingQueue();

    await refundsWith(queue).dispatch('01JC0ZZZZZZZZZZZZZZZZZZZZZ');

    expect(sent).toEqual([]);
  });

  test('送信済みの依頼は送らない', async () => {
    await insertPurchase(1);
    await db.batch([refunds.insert(newRefundRequest(1, { id: DISPATCH_ID }))]);
    await refunds.markDispatched(DISPATCH_ID, T0);
    const { queue, sent } = createRecordingQueue();

    await refundsWith(queue).dispatch(DISPATCH_ID);

    expect(sent).toEqual([]);
    expect((await readRefundRows())[0]?.dispatchedAt).toEqual(T0);
  });
});
