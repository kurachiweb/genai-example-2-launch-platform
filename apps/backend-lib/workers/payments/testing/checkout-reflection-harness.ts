import { asc, eq } from 'drizzle-orm';

import { CHECKOUT_CONSENT_VERSION } from '../../../../common-lib/payments/checkout-consent.ts';
import type { PurchaseKind } from '../../../../common-lib/payments/purchase-kinds.ts';
import type { PurchaseStatus } from '../../../../common-lib/payments/purchase-states.ts';
import type { Database } from '../../../../db/client.ts';
import { paymentPurchases } from '../../../../db/schema/payments/payment-purchases.ts';
import { paymentRefunds } from '../../../../db/schema/payments/payment-refunds.ts';
import { paymentStripeObjects } from '../../../../db/schema/payments/payment-stripe-objects.ts';
import type {
  EmailSender,
  EmailSendRequest,
} from '../../../core/email/ports.ts';
import { createUlidGenerator } from '../../../core/ids/id-generator.ts';
import type { UserContactDirectory } from '../../../core/identity/ports.ts';
import { MESSAGE_CONTRACTS } from '../../../core/messaging/contracts/index.ts';
import type { QueueEnvelope } from '../../../core/messaging/envelope.ts';
import type {
  NewPurchase,
  PurchaseNotifier,
  StripeCheckoutSessionSnapshot,
} from '../../../core/payments/ports.ts';
import type {
  FulfillablePurchase,
  PaymentsEnv,
} from '../../../core/payments/purchase-kind-contract.ts';
import { createPurchaseKindRegistry } from '../../../core/payments/purchase-kind-registry.ts';
import type { Clock } from '../../../core/time/clock.ts';
import { emailOf } from '../../identity/testing/identity-store-fixtures.ts';
import { createMessagePublisher } from '../../messaging/queue-publisher.ts';
import {
  type CheckoutSessionReflection,
  StripeCheckoutSessionReflection,
} from '../checkout-session-reflection.ts';
import { D1PaymentRecordStore } from '../d1-payment-record-store.ts';
import { D1PurchaseStore } from '../d1-purchase-store.ts';
import { D1RefundStore } from '../d1-refund-store.ts';
import type {
  FulfillmentPlan,
  PurchaseFulfillment,
  PurchaseKindRegistration,
} from '../fulfillment-contract.ts';
import { D1GuardedBatch } from '../guarded-batch.ts';
import { D1PaymentRefunds } from '../payment-refunds.ts';
import { EmailPurchaseNotifier } from '../purchase-notifier.ts';
import {
  createFakeStripeGateway,
  type FakeStripeGateway,
} from './fake-stripe-gateway.ts';
import {
  after,
  db,
  newPurchase,
  purchaseIdOf,
  readPurchaseRow,
  userIdOf,
} from './payment-store-fixtures.ts';

const MINUTE = 60_000;

export const NOW = after(30 * MINUTE);
export const OCCURRED_AT = after(29 * MINUTE);
export const CONSENTED_AT = after(20 * MINUTE);
export const PRICE = 1_000;
// 税を含むStripeの支払額
export const AMOUNT_PAID = 1_100;
export const PSEUDONYMOUS_ID = 'psn_01JC0REFLECTION0000000001';
export const LINK_FUNDING_SOURCE_GROUP = 'bank_account';

const PAYMENTS_ENV: PaymentsEnv = {
  PAYMENTS_SMOKE_ENABLED: 'true',
  CLIENT_SITE_ORIGIN: 'https://client.example',
};

const purchases = new D1PurchaseStore(db);
const records = new D1PaymentRecordStore(db);
const refundStore = new D1RefundStore(db);
const guardedBatch = new D1GuardedBatch(db);
const clock: Clock = { now: () => NOW };

export function minutesAfterT0(minutes: number): Date {
  return after(minutes * MINUTE);
}

export function sessionIdOf(index: number): string {
  return `cs_test_reflection_${String(index)}`;
}

export function paymentIntentIdOf(index: number): string {
  return `pi_test_reflection_${String(index)}`;
}

export function snapshotOf(
  index: number,
  overrides: Partial<StripeCheckoutSessionSnapshot> = {},
): StripeCheckoutSessionSnapshot {
  return {
    id: sessionIdOf(index),
    status: 'complete',
    paymentStatus: 'paid',
    clientSecret: null,
    amountTotal: AMOUNT_PAID,
    currency: 'usd',
    expiresAt: after(60 * MINUTE),
    paymentIntentId: paymentIntentIdOf(index),
    paymentIntentStatus: 'succeeded',
    invoiceId: null,
    subscriptionId: null,
    linkFundingSourceGroup: LINK_FUNDING_SOURCE_GROUP,
    metadata: {
      purchase_id: purchaseIdOf(index),
      purchase_kind: 'payments_smoke',
      pseudonymous_id: PSEUDONYMOUS_ID,
    },
    ...overrides,
  };
}

// 権利の付与の文の書き込み先として、テストでは定期課金の発生時刻の表を借りる。object_idの一意索引で付与の文を失敗させられる
export function grantObjectIdOf(purchaseId: string): string {
  return `grant_${purchaseId}`;
}

export function grantStatementOf(
  purchase: FulfillablePurchase,
  objectId = grantObjectIdOf(purchase.purchaseId),
) {
  return db.insert(paymentStripeObjects).values({
    objectId,
    objectType: 'subscription',
    lastEventAt: purchase.paidAt,
  });
}

export async function insertGrant(objectId: string): Promise<void> {
  await db.insert(paymentStripeObjects).values({
    objectId,
    objectType: 'subscription',
    lastEventAt: after(0),
  });
}

export async function readGrants(): Promise<
  (typeof paymentStripeObjects.$inferSelect)[]
> {
  return db
    .select()
    .from(paymentStripeObjects)
    .orderBy(asc(paymentStripeObjects.objectId));
}

type PlanOf = (
  purchase: FulfillablePurchase,
  attempt: number,
) => FulfillmentPlan;

export interface FakeFulfillment extends PurchaseFulfillment {
  readonly prepared: FulfillablePurchase[];
  readonly databases: Database[];
  readonly committed: FulfillablePurchase[];
}

export function createFakeFulfillment(
  options: {
    readonly plan?: PlanOf;
    readonly afterCommitError?: Error;
    // 指定の数のprepareが揃うまで待たせ、同時の反映が同じ版を読むようにする
    readonly barrier?: number;
  } = {},
): FakeFulfillment {
  const prepared: FulfillablePurchase[] = [];
  const databases: Database[] = [];
  const committed: FulfillablePurchase[] = [];
  const plan: PlanOf =
    options.plan ??
    ((purchase) => ({
      kind: 'fulfill',
      statements: [grantStatementOf(purchase)],
    }));
  const waiting: (() => void)[] = [];
  return {
    prepared,
    databases,
    committed,
    prepare: async (purchase, database) => {
      prepared.push(purchase);
      databases.push(database);
      const attempt = prepared.filter(
        ({ purchaseId }) => purchaseId === purchase.purchaseId,
      ).length;
      if (options.barrier !== undefined) {
        if (prepared.length < options.barrier) {
          await new Promise<void>((resolve) => {
            waiting.push(resolve);
          });
        } else {
          for (const resolve of waiting.splice(0)) {
            resolve();
          }
        }
      }
      return plan(purchase, attempt);
    },
    afterCommit: (purchase) => {
      committed.push(purchase);
      return options.afterCommitError === undefined
        ? Promise.resolve()
        : Promise.reject(options.afterCommitError);
    },
  };
}

export interface RecordingQueue {
  readonly queue: Queue<QueueEnvelope>;
  readonly sent: QueueEnvelope[];
}

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

export interface RecordingSender {
  readonly sender: EmailSender;
  readonly sent: EmailSendRequest<unknown>[];
}

export function createRecordingSender(): RecordingSender {
  const sent: EmailSendRequest<unknown>[] = [];
  const sender: EmailSender = {
    send: <TInput>(request: EmailSendRequest<TInput>) => {
      request.kind.inputSchema.parse(request.input);
      sent.push(request);
      return Promise.resolve(
        `01JC0EMAIL${String(sent.length).padStart(16, '0')}`,
      );
    },
  };
  return { sender, sent };
}

const contacts: UserContactDirectory = {
  findContact: (userId) =>
    Promise.resolve(
      userId === userIdOf(1)
        ? {
            userId,
            email: emailOf(1),
            nickname: '利用者1',
            emailVerified: true,
          }
        : undefined,
    ),
};

export interface NotifierCall {
  readonly purchaseId: string;
  // 呼ばれた時点の購入の状態。確定の後に呼ばれたことを確かめる
  readonly statusAtCall: PurchaseStatus | undefined;
}

export interface ReflectionHarness {
  readonly reflection: CheckoutSessionReflection;
  readonly queue: RecordingQueue;
  readonly emails: RecordingSender;
  readonly notifierCalls: NotifierCall[];
  // 自動返金の通知を依頼した返金の依頼のID
  readonly refundNoticeCalls: string[];
  readonly notifier: PurchaseNotifier;
  readonly paymentRefunds: D1PaymentRefunds;
}

const FULFILLMENT_ID = Symbol.for('payments.test.FakeFulfillment');

// 偽の購入種別の口とStripeのほかは、D1の実装と実際の返金の依頼・通知の部品で組み立てる
export function harnessWith(
  options: {
    readonly fulfillment?: PurchaseFulfillment;
    readonly kinds?: readonly PurchaseKind[];
    readonly gateway?: FakeStripeGateway;
    readonly emails?: RecordingSender;
  } = {},
): ReflectionHarness {
  const fulfillment = options.fulfillment ?? createFakeFulfillment();
  const registrations: PurchaseKindRegistration[] = (
    options.kinds ?? ['payments_smoke', 'ultras', 'sponsorship']
  ).map((kind) => ({
    kind,
    offer: Symbol.for('payments.test.FakeOffer'),
    fulfillment: FULFILLMENT_ID,
  }));
  const queue = createRecordingQueue();
  const emails = options.emails ?? createRecordingSender();
  const ids = createUlidGenerator(clock);
  const notifier = new EmailPurchaseNotifier({
    appName: 'event',
    purchases,
    refunds: refundStore,
    contacts,
    emails: emails.sender,
    clientSiteOrigin: PAYMENTS_ENV.CLIENT_SITE_ORIGIN,
  });
  const notifierCalls: NotifierCall[] = [];
  const refundNoticeCalls: string[] = [];
  const recordingNotifier: PurchaseNotifier = {
    notifyPurchase: async (purchaseId) => {
      notifierCalls.push({
        purchaseId,
        statusAtCall: (await readPurchaseRow(purchaseId))?.status,
      });
      return notifier.notifyPurchase(purchaseId);
    },
    notifyAutomaticRefund: (refundRequestId) => {
      refundNoticeCalls.push(refundRequestId);
      return notifier.notifyAutomaticRefund(refundRequestId);
    },
  };
  const paymentRefunds = new D1PaymentRefunds({
    appName: 'event',
    db,
    purchases,
    refunds: refundStore,
    refundStatements: refundStore,
    publisher: createMessagePublisher(
      queue.queue,
      MESSAGE_CONTRACTS,
      ids,
      clock,
    ),
    ids,
    clock,
  });
  const reflection = new StripeCheckoutSessionReflection({
    appName: 'event',
    db,
    env: PAYMENTS_ENV,
    gateway: options.gateway ?? createFakeStripeGateway(),
    purchases,
    purchaseStatements: purchases,
    records,
    recordStatements: records,
    guardedBatch,
    registry: createPurchaseKindRegistry(registrations),
    resolveFulfillment: (identifier) => {
      if (identifier !== FULFILLMENT_ID) {
        throw new Error('想定外の権利の付与の口の識別子です');
      }
      return fulfillment;
    },
    refunds: paymentRefunds,
    refundStatements: paymentRefunds,
    notifier: recordingNotifier,
    ids,
    clock,
  });
  return {
    reflection,
    queue,
    emails,
    notifierCalls,
    refundNoticeCalls,
    notifier: recordingNotifier,
    paymentRefunds,
  };
}

export async function insertPurchase(
  index: number,
  columns: Partial<NewPurchase> = {},
  options: { readonly attachSession?: boolean } = {},
): Promise<void> {
  await db.batch([
    purchases.create(
      newPurchase(index, {
        unitAmount: PRICE,
        amountTotal: PRICE,
        relatedId: `related-${String(index)}`,
        ...columns,
      }),
    ),
  ]);
  if (options.attachSession ?? true) {
    await purchases.attachSession({
      purchaseId: purchaseIdOf(index),
      sessionId: sessionIdOf(index),
      expiresAt: after(60 * MINUTE),
    });
  }
  await purchases.recordConsent({
    purchaseId: purchaseIdOf(index),
    userId: userIdOf(1),
    consentedAt: CONSENTED_AT,
    version: CHECKOUT_CONSENT_VERSION,
  });
}

export async function setStatus(
  index: number,
  status: PurchaseStatus,
): Promise<void> {
  await db
    .update(paymentPurchases)
    .set({ status })
    .where(eq(paymentPurchases.id, purchaseIdOf(index)));
}

export async function readRefundRows(): Promise<
  (typeof paymentRefunds.$inferSelect)[]
> {
  return db.select().from(paymentRefunds).orderBy(asc(paymentRefunds.id));
}
