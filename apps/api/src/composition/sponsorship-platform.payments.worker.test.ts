import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
import { type Container, ContainerModule } from 'inversify';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { paymentPurchases } from '../../db/schema/payments/payment-purchases.ts';
import { paymentRecords } from '../../db/schema/payments/payment-records.ts';
import { paymentRefunds } from '../../db/schema/payments/payment-refunds.ts';
import { sponsorships } from '../../db/schema/sponsorship/sponsorships.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../lib/core/email/identifiers.ts';
import type { EmailSender } from '../../lib/core/email/ports.ts';
import { SPONSORSHIP_DISPATCH_NOTICES_MESSAGE } from '../../lib/core/messaging/contracts/sponsorship.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { PAYMENTS_TYPES } from '../../lib/core/payments/identifiers.ts';
import type {
  PaymentReflector,
  ReflectionOutcome,
  StripeGateway,
} from '../../lib/core/payments/ports.ts';
import type {
  PurchaseOffer,
  PurchaseOfferPolicy,
} from '../../lib/core/payments/purchase-kind-contract.ts';
import { PAYMENTS_REFUND_MESSAGE } from '../../lib/core/payments/refund-message.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../lib/core/sponsorship/identifiers.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import type { PurchaseFulfillment } from '../../lib/workers/payments/fulfillment-contract.ts';
import {
  AMOUNT_PAID,
  createRecordingSender,
  insertPurchase,
  paymentIntentIdOf,
  sessionIdOf,
  snapshotOf,
} from '../../lib/workers/payments/testing/checkout-reflection-harness.ts';
import {
  createFakeStripeObjects,
  disputeIdOf,
  disputeOf,
  type FakeStripeObjects,
  ownerMetadataOf,
  refundObjectIdOf,
  refundOf,
} from '../../lib/workers/payments/testing/payment-reflector-harness.ts';
import { purchaseIdOf } from '../../lib/workers/payments/testing/payment-store-fixtures.ts';
import {
  clearSponsorshipTables,
  db,
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorUser,
  NOW,
  paidColumnsOf,
  readSponsorshipRow,
  sponsorshipIdOf,
  TODAY,
  userIdOf,
} from '../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import { MODULES } from './modules.ts';

interface RecordingQueue {
  readonly queue: Queue<QueueEnvelope>;
  readonly sent: QueueEnvelope[];
}

interface Harness {
  readonly container: Container;
  readonly queue: RecordingQueue;
  // 掲載権の付与の口が判断を返した回数
  readonly prepared: () => number;
  readonly now: Date;
}

interface HarnessOptions {
  readonly now: Date;
  readonly stripe: FakeStripeObjects;
  // 掲載権の付与の判断を返した直後に実行し、判断と書き込みの間に条件が崩れた状況を作る
  readonly afterFirstPrepare?: () => Promise<void>;
}

const OWNER = 1;

const SECOND = 1000;

const MINUTE = 60 * SECOND;

// 業務日付2026-11-25の業務時刻4:00。既定の申込(12-01〜12-07)の開始日より前
const PAID_AT = new Date('2026-11-25T12:00:00.000Z');

// 既定の申込の開始日の翌日(2026-12-02)の0:00
const NEXT_DAY_OF_START = new Date('2026-12-02T08:00:00.000Z');

// 開始日が今日(2026-11-25)の申込の、開始日の0:07
const START_NOTICE_AT = new Date('2026-11-25T08:07:00.000Z');

const STARTING_TODAY = Object.freeze({
  startsOn: TODAY,
  endsOn: '2026-11-27',
  days: 3,
});

function createRecordingQueue(): RecordingQueue {
  const sent: QueueEnvelope[] = [];
  const queue: Queue<QueueEnvelope> = {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: (body) => {
      sent.push(body);
      return Promise.resolve({
        metadata: { metrics: { backlogCount: sent.length, backlogBytes: 0 } },
      });
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
  return { queue, sent };
}

// Stripeの決済セッションと決済の持ち主の照会には、記録した支払い済みのスポンサー広告の決済を返す
function putSponsorshipPayment(stripe: FakeStripeObjects, index: number): void {
  stripe.put({
    kind: 'session',
    value: snapshotOf(index, {
      metadata: {
        ...snapshotOf(index).metadata,
        purchase_kind: 'sponsorship',
      },
    }),
  });
  stripe.putOwner({
    paymentIntentId: paymentIntentIdOf(index),
    metadata: ownerMetadataOf(index, 'sponsorship'),
    subscriptionMetadata: null,
  });
}

// Stripeへ通信せず、メールの依頼を記録し、反映の時刻を固定するため、共通の束縛のうち3つだけを差し替える
function overridesOf(
  options: HarnessOptions,
  onPrepare: () => number,
): Pick<AppModule, 'bindings'> {
  const clock: Clock = { now: () => options.now };
  return {
    bindings: new ContainerModule(({ rebind, onActivation }) => {
      rebind<StripeGateway>(PAYMENTS_TYPES.StripeGateway).toConstantValue(
        options.stripe.gateway,
      );
      rebind<EmailSender>(EMAIL_TYPES.EmailSender).toConstantValue(
        createRecordingSender().sender,
      );
      rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(clock);
      onActivation<PurchaseFulfillment>(
        SPONSORSHIP_PLATFORM_TYPES.SponsorshipFulfillment,
        (_, fulfillment) => ({
          prepare: async (purchase, database) => {
            const plan = await fulfillment.prepare(purchase, database);
            if (onPrepare() === 1) {
              await options.afterFirstPrepare?.();
            }
            return plan;
          },
          afterCommit: async (purchase) => {
            await fulfillment.afterCommit?.(purchase);
          },
        }),
      );
    }),
  };
}

function createHarness(options: HarnessOptions): Harness {
  const queue = createRecordingQueue();
  let prepared = 0;
  const container = createInvocationContainer(
    {
      env: { ...env, JOBS_QUEUE: queue.queue },
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    [
      ...MODULES,
      overridesOf(options, () => {
        prepared += 1;
        return prepared;
      }),
    ],
  );
  return {
    container,
    queue,
    prepared: () => prepared,
    now: options.now,
  };
}

function reflect(
  harness: Harness,
  instruction: Parameters<PaymentReflector['reflect']>[0],
): Promise<ReflectionOutcome> {
  return harness.container
    .get<PaymentReflector>(PAYMENTS_TYPES.PaymentReflector)
    .reflect(instruction);
}

// Webhook: 決済セッションの完了の通知から決済セッションを照会して反映する
function reflectCheckout(
  harness: Harness,
  index: number,
): Promise<ReflectionOutcome> {
  return reflect(harness, {
    kind: 'checkout_session',
    sessionId: sessionIdOf(index),
    occurredAt: harness.now,
  });
}

// 決済の開始と同じく、購入の可否の口が返す内容で申込1の購入の行を作る
async function insertSponsorshipPurchase(
  index: number,
  stripe: FakeStripeObjects,
): Promise<void> {
  const decision = await createHarness({ now: NOW, stripe })
    .container.get<PurchaseOfferPolicy>(
      SPONSORSHIP_PLATFORM_TYPES.SponsorshipOfferPolicy,
    )
    .describe({
      userId: userIdOf(OWNER),
      targetId: sponsorshipIdOf(1),
      now: NOW,
    });
  if (decision.kind !== 'available') {
    throw new Error(`申込1の決済を開始できません: ${decision.code}`);
  }
  const offer: PurchaseOffer = decision.offer;
  await insertPurchase(index, {
    kind: 'sponsorship',
    targetId: sponsorshipIdOf(1),
    relatedId: offer.relatedId,
    exclusivityKey: offer.exclusivityKey,
    priceLookupKey: offer.priceLookupKey,
    quantity: offer.quantity,
    summary: offer.summary,
    deadlineAt: offer.deadlineAt,
    acceptUntil: offer.acceptUntil,
    fulfillableUntil: offer.fulfillableUntil,
  });
  putSponsorshipPayment(stripe, index);
}

async function readPurchase(index: number) {
  const [row] = await db
    .select({
      status: paymentPurchases.status,
      rejectionReason: paymentPurchases.rejectionReason,
    })
    .from(paymentPurchases)
    .where(eq(paymentPurchases.id, purchaseIdOf(index)));
  return row;
}

async function readRecordIdOf(index: number): Promise<string | undefined> {
  const [row] = await db
    .select({ id: paymentRecords.id })
    .from(paymentRecords)
    .where(eq(paymentRecords.purchaseId, purchaseIdOf(index)));
  return row?.id;
}

async function readRefunds() {
  return db
    .select({
      purchaseId: paymentRefunds.purchaseId,
      reason: paymentRefunds.reason,
      amount: paymentRefunds.amount,
    })
    .from(paymentRefunds)
    .orderBy(asc(paymentRefunds.id));
}

function messagesOf(harness: Harness, type: string): QueueEnvelope[] {
  return harness.queue.sent.filter((envelope) => envelope.type === type);
}

async function softDeleteSponsorship(): Promise<void> {
  await db
    .update(sponsorships)
    .set({ deletedAt: PAID_AT })
    .where(eq(sponsorships.id, sponsorshipIdOf(1)));
}

// 申込1と同じプロダクト・ティアで期間が重なる申込2を作り、決済済みにする
async function payOverlappingSponsorship(): Promise<void> {
  await db
    .update(sponsorships)
    .set(paidColumnsOf(2))
    .where(eq(sponsorships.id, sponsorshipIdOf(2)));
}

const PENDING_SPONSORSHIP = Object.freeze({
  state: 'pending_payment',
  purchaseId: null,
  paymentRecordId: null,
  amountTotal: null,
  paidAt: null,
});

let stripe: FakeStripeObjects;

beforeEach(async () => {
  stripe = createFakeStripeObjects();
  await clearSponsorshipTables();
  await insertSponsorUser(OWNER);
  await insertSponsorProduct({ index: 1, owner: OWNER });
  await insertSponsorships([
    { index: 1, owner: OWNER, product: 1 },
    {
      index: 2,
      owner: OWNER,
      product: 1,
      columns: { startsOn: '2026-12-07', endsOn: '2026-12-09', days: 3 },
    },
  ]);
});

afterAll(() => {
  resetSync();
});

describe('paymentsの反映を通したスポンサー広告の掲載権の付与', () => {
  test('決済の確定で、反映と同じ書き込みで申込を決済済みにし、支払った金額と決済履歴の記録の識別と決済の時刻を保存する', async () => {
    await insertSponsorshipPurchase(1, stripe);
    const harness = createHarness({ now: PAID_AT, stripe });

    expect(await reflectCheckout(harness, 1)).toEqual({
      kind: 'applied',
      purchaseStatus: 'fulfilled',
    });

    expect(await readSponsorshipRow(1)).toMatchObject({
      state: 'paid',
      purchaseId: purchaseIdOf(1),
      paymentRecordId: await readRecordIdOf(1),
      amountTotal: AMOUNT_PAID,
      paidAt: PAID_AT,
      startNotice: 'none',
    });
    expect(await readRefunds()).toEqual([]);
    expect(
      messagesOf(harness, SPONSORSHIP_DISPATCH_NOTICES_MESSAGE.type),
    ).toEqual([]);
  });

  test.each([
    ['申込が論理削除されている', softDeleteSponsorship],
    [
      '同じプロダクト・ティアの決済済みの申込と期間が重なる',
      payOverlappingSponsorship,
    ],
  ])(
    '%sと、掲載権を付与せず付与できない購入として拒否し、全額返金を依頼する',
    async (_, breakCondition) => {
      await insertSponsorshipPurchase(1, stripe);
      await breakCondition();
      const harness = createHarness({ now: PAID_AT, stripe });

      expect(await reflectCheckout(harness, 1)).toEqual({
        kind: 'applied',
        purchaseStatus: 'rejected',
      });

      expect(await readPurchase(1)).toEqual({
        status: 'rejected',
        rejectionReason: 'ineligible',
      });
      expect(await readSponsorshipRow(1)).toMatchObject(PENDING_SPONSORSHIP);
      const refunds = await readRefunds();
      expect(refunds).toEqual([
        {
          purchaseId: purchaseIdOf(1),
          reason: 'ineligible',
          amount: AMOUNT_PAID,
        },
      ]);
      expect(messagesOf(harness, PAYMENTS_REFUND_MESSAGE.type)).toHaveLength(1);
    },
  );

  test.each([
    ['申込が論理削除された', softDeleteSponsorship],
    ['重なる申込が決済済みになった', payOverlappingSponsorship],
  ])(
    '判断の後、書き込みの前に%sら、前進の文が取り消され、判断を呼び直して拒否と全額返金になる',
    async (_, breakCondition) => {
      await insertSponsorshipPurchase(1, stripe);
      const harness = createHarness({
        now: PAID_AT,
        stripe,
        afterFirstPrepare: breakCondition,
      });

      expect(await reflectCheckout(harness, 1)).toEqual({
        kind: 'applied',
        purchaseStatus: 'rejected',
      });

      expect(harness.prepared()).toBe(2);
      expect(await readPurchase(1)).toEqual({
        status: 'rejected',
        rejectionReason: 'ineligible',
      });
      expect(await readSponsorshipRow(1)).toMatchObject(PENDING_SPONSORSHIP);
      expect(await readRefunds()).toEqual([
        {
          purchaseId: purchaseIdOf(1),
          reason: 'ineligible',
          amount: AMOUNT_PAID,
        },
      ]);
      expect(messagesOf(harness, PAYMENTS_REFUND_MESSAGE.type)).toHaveLength(1);
    },
  );

  test('開始日の翌日0:00の直前の確定は、反映の期限内として掲載権を付与する', async () => {
    await insertSponsorshipPurchase(1, stripe);
    const paidAt = new Date(NEXT_DAY_OF_START.getTime() - 1);
    const harness = createHarness({ now: paidAt, stripe });

    expect(await reflectCheckout(harness, 1)).toEqual({
      kind: 'applied',
      purchaseStatus: 'fulfilled',
    });

    expect(await readSponsorshipRow(1)).toMatchObject({
      state: 'paid',
      paidAt,
    });
  });

  test.each([
    ['開始日の翌日0:00ちょうど', NEXT_DAY_OF_START],
    ['開始日の翌日0:00より後', new Date(NEXT_DAY_OF_START.getTime() + MINUTE)],
  ])(
    '%sの確定は、掲載権の付与の口を呼ばずに反映の期限切れとして拒否し、全額返金を依頼する',
    async (_, paidAt) => {
      await insertSponsorshipPurchase(1, stripe);
      const harness = createHarness({ now: paidAt, stripe });

      expect(await reflectCheckout(harness, 1)).toEqual({
        kind: 'applied',
        purchaseStatus: 'rejected',
      });

      expect(harness.prepared()).toBe(0);
      expect(await readPurchase(1)).toEqual({
        status: 'rejected',
        rejectionReason: 'late',
      });
      expect(await readSponsorshipRow(1)).toMatchObject(PENDING_SPONSORSHIP);
      expect(await readRefunds()).toEqual([
        { purchaseId: purchaseIdOf(1), reason: 'late', amount: AMOUNT_PAID },
      ]);
    },
  );

  test('決済済みの申込への2回目の決済は、掲載権を書き換えずに二重決済として拒否し、全額返金を依頼する', async () => {
    await insertSponsorshipPurchase(1, stripe);
    await insertSponsorshipPurchase(2, stripe);
    await reflectCheckout(createHarness({ now: PAID_AT, stripe }), 1);
    const paidAfterFirst = await readSponsorshipRow(1);
    const second = createHarness({
      now: new Date(PAID_AT.getTime() + MINUTE),
      stripe,
    });

    expect(await reflectCheckout(second, 2)).toEqual({
      kind: 'applied',
      purchaseStatus: 'rejected',
    });

    expect(second.prepared()).toBe(1);
    expect(await readPurchase(2)).toEqual({
      status: 'rejected',
      rejectionReason: 'duplicate',
    });
    expect(await readSponsorshipRow(1)).toEqual(paidAfterFirst);
    expect(paidAfterFirst).toMatchObject({
      state: 'paid',
      purchaseId: purchaseIdOf(1),
    });
    expect(await readRefunds()).toEqual([
      { purchaseId: purchaseIdOf(2), reason: 'duplicate', amount: AMOUNT_PAID },
    ]);
    expect(messagesOf(second, PAYMENTS_REFUND_MESSAGE.type)).toHaveLength(1);
  });

  describe('開始日の当日の確定', () => {
    beforeEach(async () => {
      await db
        .update(sponsorships)
        .set(STARTING_TODAY)
        .where(eq(sponsorships.id, sponsorshipIdOf(1)));
      await insertSponsorshipPurchase(1, stripe);
    });

    test('0:07以降の確定は、開始通知を依頼待ちにして送信を1回依頼する', async () => {
      const harness = createHarness({ now: START_NOTICE_AT, stripe });

      expect(await reflectCheckout(harness, 1)).toEqual({
        kind: 'applied',
        purchaseStatus: 'fulfilled',
      });

      expect(await readSponsorshipRow(1)).toMatchObject({
        state: 'paid',
        startNotice: 'pending',
      });
      expect(
        messagesOf(harness, SPONSORSHIP_DISPATCH_NOTICES_MESSAGE.type),
      ).toEqual([
        expect.objectContaining({
          body: { requestedAt: START_NOTICE_AT.toISOString() },
        }),
      ]);
    });

    test('0:07より前の確定は、開始通知を0:07のジョブに任せて送信を依頼しない', async () => {
      const harness = createHarness({
        now: new Date(START_NOTICE_AT.getTime() - 1),
        stripe,
      });

      expect(await reflectCheckout(harness, 1)).toEqual({
        kind: 'applied',
        purchaseStatus: 'fulfilled',
      });

      expect(await readSponsorshipRow(1)).toMatchObject({
        state: 'paid',
        startNotice: 'none',
      });
      expect(
        messagesOf(harness, SPONSORSHIP_DISPATCH_NOTICES_MESSAGE.type),
      ).toEqual([]);
    });
  });

  test('掲載権を付与した決済の返金とチャージバックを反映しても、掲載権は変わらない', async () => {
    await insertSponsorshipPurchase(1, stripe);
    await reflectCheckout(createHarness({ now: PAID_AT, stripe }), 1);
    const paid = await readSponsorshipRow(1);
    const later = createHarness({
      now: new Date(PAID_AT.getTime() + 10 * MINUTE),
      stripe,
    });
    stripe.put({
      kind: 'refund',
      value: refundOf(1, {
        status: 'succeeded',
        amount: 500,
        paymentIntentId: paymentIntentIdOf(1),
      }),
    });
    stripe.put({
      kind: 'dispute',
      value: disputeOf(1, {
        amount: AMOUNT_PAID - 500,
        paymentIntentId: paymentIntentIdOf(1),
        balanceTransactions: [
          { id: 'txn_withdrawal', amount: -(AMOUNT_PAID - 500) },
        ],
      }),
    });

    expect(
      await reflect(later, {
        kind: 'refund',
        refundId: refundObjectIdOf(1),
        occurredAt: later.now,
      }),
    ).toEqual({ kind: 'applied' });
    expect(
      await reflect(later, {
        kind: 'dispute',
        disputeId: disputeIdOf(1),
        stage: 'funds_withdrawn',
        occurredAt: later.now,
      }),
    ).toEqual({ kind: 'applied' });

    const records = await db
      .select({ kind: paymentRecords.kind })
      .from(paymentRecords)
      .where(eq(paymentRecords.purchaseId, purchaseIdOf(1)));
    expect(records.map(({ kind }) => kind).toSorted()).toEqual([
      'dispute',
      'one_time',
      'refund',
    ]);
    expect(later.prepared()).toBe(0);
    expect(await readSponsorshipRow(1)).toEqual(paid);
    expect(paid).toMatchObject({ state: 'paid', purchaseId: purchaseIdOf(1) });
  });
});
