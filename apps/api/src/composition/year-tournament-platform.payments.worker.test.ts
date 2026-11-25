import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { type Container, ContainerModule } from 'inversify';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { paymentCustomers } from '../../db/schema/payments/payment-customers.ts';
import { paymentPriceSnapshots } from '../../db/schema/payments/payment-price-snapshots.ts';
import { paymentPurchases } from '../../db/schema/payments/payment-purchases.ts';
import { paymentRecords } from '../../db/schema/payments/payment-records.ts';
import { paymentRefunds } from '../../db/schema/payments/payment-refunds.ts';
import { paymentStripeObjects } from '../../db/schema/payments/payment-stripe-objects.ts';
import { yearTournamentEntries } from '../../db/schema/tournament/year-tournament-entries.ts';
import { yearTournaments } from '../../db/schema/tournament/year-tournaments.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../lib/core/email/identifiers.ts';
import { PAYMENTS_PURCHASE_CONFIRMATION_KIND } from '../../lib/core/email/kinds/payments.ts';
import type { EmailSender } from '../../lib/core/email/ports.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { PAYMENTS_TYPES } from '../../lib/core/payments/identifiers.ts';
import type {
  PaymentReflector,
  ReflectionOutcome,
  StripeCheckoutSessionSnapshot,
  StripeGateway,
} from '../../lib/core/payments/ports.ts';
import { PAYMENTS_REFUND_MESSAGE } from '../../lib/core/payments/refund-message.ts';
import type { SessionView } from '../../lib/core/session/session-view.ts';
import { toBusinessDateTime } from '../../lib/core/time/business-time.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../lib/core/year-tournament/identifiers.ts';
import type { YearTournamentStore } from '../../lib/core/year-tournament/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import type { PurchaseFulfillment } from '../../lib/workers/payments/fulfillment-contract.ts';
import {
  createRecordingSender,
  insertPurchase,
  type RecordingSender,
  sessionIdOf,
  snapshotOf,
} from '../../lib/workers/payments/testing/checkout-reflection-harness.ts';
import { createFakeStripeGateway } from '../../lib/workers/payments/testing/fake-stripe-gateway.ts';
import { purchaseIdOf } from '../../lib/workers/payments/testing/payment-store-fixtures.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import {
  clearYearTournamentTables,
  insertYearEntries,
  insertYearTournaments,
  YEAR_SCHEDULE,
  yearEntryIdOf,
  yearTournamentIdOf,
} from '../../lib/workers/year-tournament/testing/year-tournament-fixtures.ts';
import type { CheckoutReturnConfirmer } from '../application/payments/checkout-return-confirmer.ts';
import type { CheckoutReconciliationJob } from '../application/payments/jobs/checkout-reconciliation-job.ts';
import { API_PAYMENTS_TYPES } from '../application/payments/payments-types.ts';
import { MODULES } from './modules.ts';

interface RecordingQueue {
  readonly queue: Queue<QueueEnvelope>;
  readonly sent: QueueEnvelope[];
}

interface Harness {
  readonly container: Container;
  readonly queue: RecordingQueue;
  readonly emails: RecordingSender;
  // 参加資格の付与の口が判断を返した回数
  readonly prepared: () => number;
  readonly now: Date;
}

interface HarnessOptions {
  readonly now: Date;
  // 参加資格の付与の判断を返した直後に年を凍結し、判断と書き込みの間に組み合わせ決定が始まった状況を作る
  readonly freezeAfterPrepare?: boolean;
}

const OWNER = 1;

// 参加の枠の既定のWeek優勝の日時(2026-11-23の23:45)
const AWARDED_AT = new Date('2026-11-24T07:45:00.000Z');

// 業務日付2026-11-25の業務時刻4:00。2027年の決済期限(2027-05-24の23:35)より前
const BEFORE_DEADLINE = new Date('2026-11-25T12:00:00.000Z');

const SECOND = 1000;

const MINUTE = 60 * SECOND;

// 23:40の突合の起動の予定時刻(決済期限の5分後、組み合わせ決定の5分前)
const RECONCILIATION_TIME = new Date(
  YEAR_SCHEDULE.deadlineAt.getTime() + 5 * MINUTE,
);

const owner: SessionView = {
  principal: () =>
    Promise.resolve({
      kind: 'authenticated',
      subjectKind: 'user',
      subjectId: userIdOf(OWNER),
      sessionId: '01JD0SESS10N0000000000000A',
    }),
};

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

function yearSessionOf(index: number): StripeCheckoutSessionSnapshot {
  return snapshotOf(index, {
    metadata: {
      ...snapshotOf(index).metadata,
      purchase_kind: 'year_tournament_entry',
    },
  });
}

// Stripeの決済セッションの照会は記録した支払い済みのセッションを返す
function stripeGateway(): StripeGateway {
  return createFakeStripeGateway({
    retrieveCheckoutSession: (sessionId) => {
      const index = Number(sessionId.split('_').at(-1));
      return Promise.resolve(yearSessionOf(index));
    },
  });
}

// Stripeへ通信せず、メールの依頼を記録し、反映の時刻を固定するため、共通の束縛のうち3つだけを差し替える
function overridesOf(
  options: HarnessOptions,
  emails: RecordingSender,
  onPrepare: () => void,
): Pick<AppModule, 'bindings'> {
  const clock: Clock = { now: () => options.now };
  return {
    bindings: new ContainerModule(({ rebind, onActivation }) => {
      rebind<StripeGateway>(PAYMENTS_TYPES.StripeGateway).toConstantValue(
        stripeGateway(),
      );
      rebind<EmailSender>(EMAIL_TYPES.EmailSender).toConstantValue(
        emails.sender,
      );
      rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(clock);
      onActivation<PurchaseFulfillment>(
        YEAR_TOURNAMENT_TYPES.YearEntryFulfillment,
        (context, fulfillment) => ({
          prepare: async (purchase, database) => {
            const plan = await fulfillment.prepare(purchase, database);
            onPrepare();
            if (options.freezeAfterPrepare === true) {
              await context
                .get<YearTournamentStore>(
                  YEAR_TOURNAMENT_TYPES.YearTournamentStore,
                )
                .freeze(yearTournamentIdOf(1), YEAR_SCHEDULE.drawAt);
            }
            return plan;
          },
        }),
      );
    }),
  };
}

function createHarness(options: HarnessOptions): Harness {
  const queue = createRecordingQueue();
  const emails = createRecordingSender();
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
      overridesOf(options, emails, () => {
        prepared += 1;
      }),
    ],
  );
  return {
    container,
    queue,
    emails,
    prepared: () => prepared,
    now: options.now,
  };
}

// 決済後のランディング: return_urlの決済セッションのIDで状態を確かめる
async function reflectByLanding(harness: Harness, index: number) {
  return harness.container
    .get<CheckoutReturnConfirmer>(API_PAYMENTS_TYPES.CheckoutReturnConfirmer)
    .confirm(owner, sessionIdOf(index));
}

// Webhook: 決済セッションの完了の通知から決済セッションを照会して反映する
function reflectByWebhook(
  harness: Harness,
  index: number,
): Promise<ReflectionOutcome> {
  return harness.container
    .get<PaymentReflector>(PAYMENTS_TYPES.PaymentReflector)
    .reflect({
      kind: 'checkout_session',
      sessionId: sessionIdOf(index),
      occurredAt: harness.now,
    });
}

// 突合: 23:40の起動で決済期限を過ぎた未完了の購入を照会して反映する
async function reflectByReconciliation(harness: Harness): Promise<void> {
  await harness.container
    .get<CheckoutReconciliationJob>(
      API_PAYMENTS_TYPES.CheckoutReconciliationJob,
    )
    .run({
      scheduledTime: RECONCILIATION_TIME,
      cron: '40 7 * * *',
      business: toBusinessDateTime(RECONCILIATION_TIME),
    });
}

async function insertYearPurchase(index: number): Promise<void> {
  await insertPurchase(index, {
    kind: 'year_tournament_entry',
    targetId: launchIdOf(1),
    relatedId: launchIdOf(1),
    exclusivityKey: `launch:${launchIdOf(1)}:year`,
    priceLookupKey: 'year_tournament_entry',
    deadlineAt: YEAR_SCHEDULE.deadlineAt,
    acceptUntil: YEAR_SCHEDULE.acceptUntil,
    fulfillableUntil: YEAR_SCHEDULE.drawAt,
  });
}

async function readEntry() {
  const [row] = await db
    .select({
      status: yearTournamentEntries.status,
      entitlementSource: yearTournamentEntries.entitlementSource,
      purchaseId: yearTournamentEntries.purchaseId,
      entitledAt: yearTournamentEntries.entitledAt,
    })
    .from(yearTournamentEntries)
    .where(eq(yearTournamentEntries.id, yearEntryIdOf(1)));
  return row;
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

function confirmationEmailsOf(...harnesses: readonly Harness[]) {
  return harnesses.flatMap(({ emails }) =>
    emails.sent.filter(
      ({ kind }) => kind.name === PAYMENTS_PURCHASE_CONFIRMATION_KIND.name,
    ),
  );
}

function refundMessagesOf(harness: Harness): QueueEnvelope[] {
  return harness.queue.sent.filter(
    ({ type }) => type === PAYMENTS_REFUND_MESSAGE.type,
  );
}

const AWAITING_ENTRY = Object.freeze({
  status: 'awaiting_payment',
  entitlementSource: null,
  purchaseId: null,
  entitledAt: null,
});

// paymentsの表は利用者を参照するため、Yearとマッチ・プロダクト・利用者の行より先に消す
beforeEach(async () => {
  await db.delete(yearTournamentEntries);
  await db.delete(yearTournaments);
  await db.delete(paymentRefunds);
  await db.delete(paymentRecords);
  await db.delete(paymentStripeObjects);
  await db.delete(paymentPriceSnapshots);
  await db.delete(paymentPurchases);
  await db.delete(paymentCustomers);
  await clearYearTournamentTables();
  await insertUser(OWNER);
  await insertProduct(1, OWNER);
  await insertLaunch(1, 1, {
    launchDate: '2026-11-20',
    outcome: 'won',
    decidedAt: AWARDED_AT,
  });
  await insertYearTournaments([{ index: 1 }]);
  await insertYearEntries([
    {
      index: 1,
      launch: 1,
      product: 1,
      owner: OWNER,
    },
  ]);
});

afterAll(() => {
  resetSync();
});

describe('paymentsの反映を通したYearトーナメント参加費の参加資格の付与', () => {
  test('決済後のランディングの反映で、受付中の枠に決済の出どころと購入を記録して参加資格を与える', async () => {
    const harness = createHarness({ now: BEFORE_DEADLINE });
    await insertYearPurchase(1);

    const { checkout } = await reflectByLanding(harness, 1);

    expect(checkout).toMatchObject({ purchaseId: purchaseIdOf(1) });
    expect(await readPurchase(1)).toEqual({
      status: 'fulfilled',
      rejectionReason: null,
    });
    expect(await readEntry()).toEqual({
      status: 'entitled',
      entitlementSource: 'payment',
      purchaseId: purchaseIdOf(1),
      entitledAt: BEFORE_DEADLINE,
    });
    expect(confirmationEmailsOf(harness)).toHaveLength(1);
  });

  test('決済期限から組み合わせ決定までの突合で付与した購入に、ランディングとWebhookの反映が後から届いても付与は1回だけになる', async () => {
    await insertYearPurchase(1);
    const reconciledAt = new Date(RECONCILIATION_TIME.getTime() + 30 * SECOND);
    const reconciliation = createHarness({ now: reconciledAt });
    const webhook = createHarness({
      now: new Date(reconciledAt.getTime() + MINUTE),
    });
    const landing = createHarness({
      now: new Date(reconciledAt.getTime() + 2 * MINUTE),
    });

    await reflectByReconciliation(reconciliation);
    const webhookOutcome = await reflectByWebhook(webhook, 1);
    await reflectByLanding(landing, 1);

    expect(reconciliation.prepared()).toBe(1);
    expect(webhookOutcome).toEqual({
      kind: 'already_applied',
      purchaseStatus: 'fulfilled',
    });
    expect(webhook.prepared() + landing.prepared()).toBe(0);
    expect(await readEntry()).toEqual({
      status: 'entitled',
      entitlementSource: 'payment',
      purchaseId: purchaseIdOf(1),
      entitledAt: reconciledAt,
    });
    expect(
      await db.select({ id: paymentRecords.id }).from(paymentRecords),
    ).toHaveLength(1);
    expect(
      await db.select({ id: paymentRefunds.id }).from(paymentRefunds),
    ).toEqual([]);
    expect(confirmationEmailsOf(reconciliation, webhook, landing)).toHaveLength(
      1,
    );
  });

  test('ランディング・Webhook・突合の反映が同時に届いても、参加資格の付与と決済の記録は1回だけで返金は依頼しない', async () => {
    await insertYearPurchase(1);
    const harnesses = [0, 1, 2].map(() =>
      createHarness({ now: RECONCILIATION_TIME }),
    );
    const [landing, webhook, reconciliation] = harnesses as [
      Harness,
      Harness,
      Harness,
    ];

    await Promise.all([
      reflectByLanding(landing, 1),
      reflectByWebhook(webhook, 1),
      reflectByReconciliation(reconciliation),
    ]);

    expect(await readPurchase(1)).toEqual({
      status: 'fulfilled',
      rejectionReason: null,
    });
    expect(await readEntry()).toEqual({
      status: 'entitled',
      entitlementSource: 'payment',
      purchaseId: purchaseIdOf(1),
      entitledAt: RECONCILIATION_TIME,
    });
    expect(
      await db.select({ id: paymentRecords.id }).from(paymentRecords),
    ).toHaveLength(1);
    expect(
      await db.select({ id: paymentRefunds.id }).from(paymentRefunds),
    ).toEqual([]);
    expect(confirmationEmailsOf(...harnesses)).toHaveLength(1);
  });

  test('凍結と同時の反映は、付与の書き込みが制約の違反で失敗し、判断を呼び直して拒否と自動の全額返金になる', async () => {
    const harness = createHarness({
      now: new Date(YEAR_SCHEDULE.drawAt.getTime() - SECOND),
      freezeAfterPrepare: true,
    });
    await insertYearPurchase(1);

    expect(await reflectByWebhook(harness, 1)).toEqual({
      kind: 'applied',
      purchaseStatus: 'rejected',
    });

    expect(harness.prepared()).toBe(2);
    expect(await readPurchase(1)).toEqual({
      status: 'rejected',
      rejectionReason: 'ineligible',
    });
    expect(await readEntry()).toEqual(AWAITING_ENTRY);
    const [tournament] = await db
      .select({
        status: yearTournaments.status,
        drawStartedAt: yearTournaments.drawStartedAt,
      })
      .from(yearTournaments);
    expect(tournament).toEqual({
      status: 'drawing',
      drawStartedAt: YEAR_SCHEDULE.drawAt,
    });
    const refunds = await db.select().from(paymentRefunds);
    expect(refunds).toEqual([
      expect.objectContaining({
        purchaseId: purchaseIdOf(1),
        reason: 'ineligible',
        amount: 1_100,
      }),
    ]);
    expect(refundMessagesOf(harness)).toEqual([
      expect.objectContaining({ body: { refundRequestId: refunds[0]?.id } }),
    ]);
  });

  test('参加資格を得た枠への2件目の決済は、参加資格を書き換えずに二重決済として拒否し自動の全額返金を依頼する', async () => {
    await insertYearPurchase(1);
    await insertYearPurchase(2);
    await reflectByLanding(createHarness({ now: BEFORE_DEADLINE }), 1);
    const second = createHarness({
      now: new Date(BEFORE_DEADLINE.getTime() + MINUTE),
    });

    expect(await reflectByWebhook(second, 2)).toEqual({
      kind: 'applied',
      purchaseStatus: 'rejected',
    });

    expect(await readPurchase(2)).toEqual({
      status: 'rejected',
      rejectionReason: 'duplicate',
    });
    expect(await readEntry()).toEqual({
      status: 'entitled',
      entitlementSource: 'payment',
      purchaseId: purchaseIdOf(1),
      entitledAt: BEFORE_DEADLINE,
    });
    const refunds = await db.select().from(paymentRefunds);
    expect(refunds).toEqual([
      expect.objectContaining({
        purchaseId: purchaseIdOf(2),
        reason: 'duplicate',
      }),
    ]);
    expect(refundMessagesOf(second)).toHaveLength(1);
  });

  describe('決済期限の後の反映と新しいローンチ(仮6)', () => {
    beforeEach(async () => {
      await insertLaunch(2, 1, { launchDate: '2026-11-25' });
      await insertYearPurchase(1);
    });

    test('決済期限ちょうど(23:35:00)の反映は、新しいローンチがあっても反映の時刻で参加資格を与える', async () => {
      const harness = createHarness({ now: YEAR_SCHEDULE.deadlineAt });

      expect(await reflectByWebhook(harness, 1)).toEqual({
        kind: 'applied',
        purchaseStatus: 'fulfilled',
      });

      expect(await readEntry()).toEqual({
        status: 'entitled',
        entitlementSource: 'payment',
        purchaseId: purchaseIdOf(1),
        entitledAt: YEAR_SCHEDULE.deadlineAt,
      });
    });

    test('決済期限より後(23:35:01)の反映は、反映の時刻で判断して新しいローンチがあれば拒否し自動の全額返金を依頼する', async () => {
      const harness = createHarness({
        now: new Date(YEAR_SCHEDULE.deadlineAt.getTime() + SECOND),
      });

      expect(await reflectByWebhook(harness, 1)).toEqual({
        kind: 'applied',
        purchaseStatus: 'rejected',
      });

      expect(await readPurchase(1)).toEqual({
        status: 'rejected',
        rejectionReason: 'ineligible',
      });
      expect(await readEntry()).toEqual(AWAITING_ENTRY);
      expect(refundMessagesOf(harness)).toHaveLength(1);
    });
  });
});
