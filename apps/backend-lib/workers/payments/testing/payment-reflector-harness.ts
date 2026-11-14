import type { BatchItem } from 'drizzle-orm/batch';

import { paymentStripeObjects } from '../../../../db/schema/payments/payment-stripe-objects.ts';
import { createUlidGenerator } from '../../../core/ids/id-generator.ts';
import {
  type PaymentReflector,
  type StripeCheckoutSessionSnapshot,
  type StripeDisputeSnapshot,
  type StripeInvoiceSnapshot,
  StripeNotFoundError,
  type StripePaymentOwnerHint,
  type StripeRefundSnapshot,
  type StripeSubscriptionSnapshot,
} from '../../../core/payments/ports.ts';
import type { SubscriptionChange } from '../../../core/payments/purchase-kind-contract.ts';
import type { Clock } from '../../../core/time/clock.ts';
import { D1PaymentRecordStore } from '../d1-payment-record-store.ts';
import { D1PurchaseStore } from '../d1-purchase-store.ts';
import { D1RefundStore } from '../d1-refund-store.ts';
import { D1StripeObjectStore } from '../d1-stripe-object-store.ts';
import type {
  PurchaseFulfillment,
  SubscriptionEventSink,
  SubscriptionEventSinkRegistration,
} from '../fulfillment-contract.ts';
import { D1GuardedBatch } from '../guarded-batch.ts';
import { StripePaymentOwnerResolver } from '../payment-owner-resolver.ts';
import { StripePaymentReflector } from '../payment-reflector.ts';
import {
  harnessWith,
  NOW,
  type NotifierCall,
  PSEUDONYMOUS_ID,
  type RecordingSender,
} from './checkout-reflection-harness.ts';
import {
  createFakeStripeGateway,
  type FakeStripeGateway,
} from './fake-stripe-gateway.ts';
import { db, purchaseIdOf } from './payment-store-fixtures.ts';

const clock: Clock = { now: () => NOW };

export function invoiceIdOf(index: number): string {
  return `in_test_reflector_${String(index)}`;
}

export function subscriptionIdOf(index: number): string {
  return `sub_test_reflector_${String(index)}`;
}

export function refundObjectIdOf(index: number): string {
  return `re_test_reflector_${String(index)}`;
}

export function disputeIdOf(index: number): string {
  return `dp_test_reflector_${String(index)}`;
}

export function ownerMetadataOf(
  purchaseIndex: number,
  purchaseKind = 'payments_smoke',
): Readonly<Record<string, string>> {
  return {
    purchase_id: purchaseIdOf(purchaseIndex),
    purchase_kind: purchaseKind,
    pseudonymous_id: PSEUDONYMOUS_ID,
  };
}

export function invoiceOf(
  index: number,
  overrides: Partial<StripeInvoiceSnapshot> = {},
): StripeInvoiceSnapshot {
  return {
    id: invoiceIdOf(index),
    status: 'paid',
    amountPaid: 500,
    amountDue: 500,
    currency: 'usd',
    paymentIntentId: null,
    subscriptionId: subscriptionIdOf(1),
    subscriptionMetadata: ownerMetadataOf(1, 'ultras'),
    ...overrides,
  };
}

export function refundOf(
  index: number,
  overrides: Partial<StripeRefundSnapshot> = {},
): StripeRefundSnapshot {
  return {
    id: refundObjectIdOf(index),
    status: 'pending',
    amount: 1_100,
    currency: 'usd',
    paymentIntentId: 'pi_test_reflection_1',
    failureReason: null,
    metadata: {},
    ...overrides,
  };
}

export function disputeOf(
  index: number,
  overrides: Partial<StripeDisputeSnapshot> = {},
): StripeDisputeSnapshot {
  return {
    id: disputeIdOf(index),
    status: 'needs_response',
    amount: 1_100,
    currency: 'usd',
    paymentIntentId: 'pi_test_reflection_1',
    balanceTransactions: [],
    ...overrides,
  };
}

export function subscriptionOf(
  index: number,
  overrides: Partial<StripeSubscriptionSnapshot> = {},
): StripeSubscriptionSnapshot {
  return {
    id: subscriptionIdOf(index),
    status: 'active',
    cancelAtPeriodEnd: false,
    cancelAt: null,
    currentPeriodEnd: null,
    endedAt: null,
    customerId: 'cus_test_reflector',
    metadata: ownerMetadataOf(1, 'ultras'),
    ...overrides,
  };
}

// テストがStripe上の最新の状態を置き換えながら反映し、取得の対象が無ければStripeNotFoundErrorにする
export interface FakeStripeObjects {
  readonly gateway: FakeStripeGateway;
  put(
    snapshot:
      | { readonly kind: 'invoice'; readonly value: StripeInvoiceSnapshot }
      | { readonly kind: 'refund'; readonly value: StripeRefundSnapshot }
      | { readonly kind: 'dispute'; readonly value: StripeDisputeSnapshot }
      | {
          readonly kind: 'subscription';
          readonly value: StripeSubscriptionSnapshot;
        }
      | {
          readonly kind: 'session';
          readonly value: StripeCheckoutSessionSnapshot;
        },
  ): void;
  putOwner(hint: StripePaymentOwnerHint): void;
  // 次の取得をこの例外で失敗させる
  failNext(error: Error): void;
}

export function createFakeStripeObjects(): FakeStripeObjects {
  const objects = new Map<string, unknown>();
  const failures: Error[] = [];
  const find = <T>(kind: string, id: string): Promise<T> => {
    const failure = failures.shift();
    if (failure !== undefined) {
      return Promise.reject(failure);
    }
    const value = objects.get(`${kind}:${id}`);
    return value === undefined
      ? Promise.reject(new StripeNotFoundError(`${kind} ${id}`))
      : Promise.resolve(value as T);
  };
  const gateway = createFakeStripeGateway({
    retrieveInvoice: (id) => find('invoice', id),
    retrieveRefund: (id) => find('refund', id),
    retrieveDispute: (id) => find('dispute', id),
    retrieveSubscription: (id) => find('subscription', id),
    retrieveCheckoutSession: (id) => find('session', id),
    retrievePaymentIntentOwner: (id) => find('owner', id),
  });
  return {
    gateway,
    put: ({ kind, value }) => {
      objects.set(`${kind}:${value.id}`, value);
    },
    putOwner: (hint) => {
      objects.set(`owner:${hint.paymentIntentId}`, hint);
    },
    failNext: (error) => {
      failures.push(error);
    },
  };
}

// 受け取り口の文の書き込み先として、テストでは定期課金の発生時刻の表を借りる
export function sinkObjectIdOf(name: string, occurredAt: Date): string {
  return `sink_${name}_${String(occurredAt.getTime())}`;
}

export interface FakeSubscriptionSink extends SubscriptionEventSink {
  readonly name: string;
  readonly prepared: SubscriptionChange[];
  readonly committed: SubscriptionChange[];
}

export function createFakeSubscriptionSink(
  options: {
    readonly name?: string;
    readonly statements?: (
      change: SubscriptionChange,
    ) => readonly BatchItem<'sqlite'>[];
    readonly afterCommitError?: Error;
  } = {},
): FakeSubscriptionSink {
  const name = options.name ?? 'ultras-subscription.plan-state';
  const prepared: SubscriptionChange[] = [];
  const committed: SubscriptionChange[] = [];
  const statements =
    options.statements ??
    ((change: SubscriptionChange) => [
      db.insert(paymentStripeObjects).values({
        objectId: sinkObjectIdOf(name, change.occurredAt),
        objectType: 'subscription',
        lastEventAt: change.occurredAt,
      }),
    ]);
  return {
    name,
    prepared,
    committed,
    statementsFor: (change) => {
      prepared.push(change);
      return Promise.resolve(statements(change));
    },
    afterCommit: (change) => {
      committed.push(change);
      return options.afterCommitError === undefined
        ? Promise.resolve()
        : Promise.reject(options.afterCommitError);
    },
  };
}

export interface PaymentReflectorHarness {
  readonly reflector: PaymentReflector;
  readonly stripe: FakeStripeObjects;
  readonly emails: RecordingSender;
  readonly notifierCalls: NotifierCall[];
  readonly refundNoticeCalls: string[];
}

// 偽のStripe・購入種別の口・受け取り口のほかは、D1の実装と実際の決済セッションの反映・持ち主の特定・通知の部品で組み立てる
export function reflectorWith(
  options: {
    readonly sinks?: readonly FakeSubscriptionSink[];
    readonly fulfillment?: PurchaseFulfillment;
    readonly stripe?: FakeStripeObjects;
    readonly emails?: RecordingSender;
  } = {},
): PaymentReflectorHarness {
  const stripe = options.stripe ?? createFakeStripeObjects();
  const checkout = harnessWith({
    gateway: stripe.gateway,
    ...(options.fulfillment === undefined
      ? {}
      : { fulfillment: options.fulfillment }),
    ...(options.emails === undefined ? {} : { emails: options.emails }),
  });
  const sinks = options.sinks ?? [];
  const registrations: SubscriptionEventSinkRegistration[] = sinks.map(
    (sink) => ({ name: sink.name, sink: Symbol.for(`test.${sink.name}`) }),
  );
  const purchases = new D1PurchaseStore(db);
  const records = new D1PaymentRecordStore(db);
  const refunds = new D1RefundStore(db);
  const stripeObjects = new D1StripeObjectStore(db);
  const reflector = new StripePaymentReflector({
    appName: 'event',
    db,
    gateway: stripe.gateway,
    checkout: checkout.reflection,
    owners: new StripePaymentOwnerResolver({
      appName: 'event',
      gateway: stripe.gateway,
      purchases,
    }),
    purchases,
    recordStatements: records,
    refunds,
    refundStatements: refunds,
    stripeObjects,
    stripeObjectStatements: stripeObjects,
    guardedBatch: new D1GuardedBatch(db),
    subscriptionSinks: registrations,
    resolveSink: (identifier) => {
      const index = registrations.findIndex(({ sink }) => sink === identifier);
      const sink = sinks[index];
      if (sink === undefined) {
        throw new Error('想定外の受け取り口の識別子です');
      }
      return sink;
    },
    notifier: checkout.notifier,
    ids: createUlidGenerator(clock),
    clock,
  });
  return {
    reflector,
    stripe,
    emails: checkout.emails,
    notifierCalls: checkout.notifierCalls,
    refundNoticeCalls: checkout.refundNoticeCalls,
  };
}
