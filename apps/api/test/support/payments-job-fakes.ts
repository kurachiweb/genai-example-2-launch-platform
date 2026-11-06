import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type {
  NoticeOutcome,
  PaymentRecordStore,
  PaymentReflector,
  PaymentRefunds,
  PurchaseAdvance,
  PurchaseNotifier,
  PurchaseRecord,
  PurchaseStore,
  RefundRequestRecord,
  RefundStore,
  StripeCheckoutSessionSnapshot,
  StripeGateway,
} from '../../lib/core/payments/ports.ts';
import type { IdGenerator } from '../../lib/core/ids/id-generator.ts';
import type { ScheduledJobContext } from '../../lib/core/scheduling/cron-registry.ts';
import { toBusinessDateTime } from '../../lib/core/time/business-time.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import type {
  PaymentsJobIncident,
  PaymentsJobIncidentReporter,
} from '../../src/application/payments/jobs/payments-job-incidents.ts';
import { HOUR_MS, purchaseRecordOf } from './payments-checkout-fakes.ts';

export const MINUTE_MS = 60_000;

// 業務時刻(UTC-08:00)の月曜日23:40と、その翌日の4:21
export const RECONCILIATION_TIME = new Date('2027-04-06T07:40:00.000Z');
export const SWEEP_TIME = new Date('2027-04-06T12:21:00.000Z');

// 実際に動いた時刻。反映の発生時刻に使い、対象の範囲には使わない
export const RUN_CLOCK_TIME = new Date('2027-04-06T12:21:07.000Z');

const RECONCILABLE: readonly PurchaseRecord['status'][] = [
  'open',
  'processing',
  'superseded',
];

export function jobContextAt(
  scheduledTime: Date,
  cron: string,
): ScheduledJobContext {
  return { scheduledTime, cron, business: toBusinessDateTime(scheduledTime) };
}

export const RUN_CLOCK: Clock = Object.freeze({ now: () => RUN_CLOCK_TIME });

// 前進の後の版に使う連番のULID
export function createJobIds(): IdGenerator {
  let serial = 0;
  return {
    generate: () => {
      serial += 1;
      return jobUlidOf('01JDTKN', serial);
    },
  };
}

// 使わないメソッドを呼んだら失敗させ、ジョブが想定外のポートに触れたことを検出する。DIコンテナが束縛した値をPromiseか判定するthenは持たないものとして返す
function partialFake<T extends object>(implemented: Partial<T>): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      if (property === 'then') {
        return undefined;
      }
      return () => {
        throw new Error(`この偽物では使わない: ${String(property)}`);
      };
    },
  }) as T;
}

// Crockfordの文字だけを使う有効なULID
export function jobUlidOf(prefix: string, serial: number): string {
  return `${prefix}${String(serial).padStart(26 - prefix.length, '0')}`;
}

export const sessionIdOf = (serial: number): string =>
  `cs_test_job${String(serial)}`;

export function jobPurchaseOf(
  serial: number,
  overrides: Partial<PurchaseRecord> = {},
): PurchaseRecord {
  return purchaseRecordOf({
    id: jobUlidOf('01JDPRCH', serial),
    stripeCheckoutSessionId: sessionIdOf(serial),
    ...overrides,
  });
}

const byTimeThenId =
  (timeOf: (purchase: PurchaseRecord) => Date | null) =>
  (left: PurchaseRecord, right: PurchaseRecord): number =>
    (timeOf(left)?.getTime() ?? 0) - (timeOf(right)?.getTime() ?? 0) ||
    left.id.localeCompare(right.id);

export interface PurchaseQueries {
  readonly reconcilable: {
    readonly deadlineFrom: Date;
    readonly deadlineTo: Date;
    readonly limit: number;
  }[];
  readonly staleOpen: {
    readonly expiredBefore: Date;
    readonly limit: number;
  }[];
  readonly pendingConfirmations: {
    readonly reflectedBefore: Date;
    readonly limit: number;
  }[];
}

// D1PurchaseStoreと同じ条件と順で、未完了・処理中・置き換え済みの購入と依頼待ちの購入確認メールを探す
export class InMemoryJobPurchases {
  readonly queries: PurchaseQueries = {
    reconcilable: [],
    staleOpen: [],
    pendingConfirmations: [],
  };
  readonly advances: PurchaseAdvance[] = [];
  private readonly purchases = new Map<string, PurchaseRecord>();

  constructor(purchases: readonly PurchaseRecord[] = []) {
    for (const purchase of purchases) {
      this.purchases.set(purchase.id, purchase);
    }
  }

  get(purchaseId: string): PurchaseRecord | undefined {
    return this.purchases.get(purchaseId);
  }

  update(purchaseId: string, patch: Partial<PurchaseRecord>): void {
    const purchase = this.purchases.get(purchaseId);
    if (purchase !== undefined) {
      this.purchases.set(purchaseId, { ...purchase, ...patch });
    }
  }

  bySessionId(sessionId: string): PurchaseRecord | undefined {
    return [...this.purchases.values()].find(
      (purchase) => purchase.stripeCheckoutSessionId === sessionId,
    );
  }

  statuses(): Record<string, PurchaseRecord['status']> {
    return Object.fromEntries(
      [...this.purchases.values()].map((purchase) => [
        purchase.id,
        purchase.status,
      ]),
    );
  }

  store(): PurchaseStore {
    const all = () => [...this.purchases.values()];
    const isReconcilable = (purchase: PurchaseRecord) =>
      RECONCILABLE.includes(purchase.status) &&
      purchase.stripeCheckoutSessionId !== null;
    return partialFake<PurchaseStore>({
      findReconcilable: (input) => {
        this.queries.reconcilable.push(input);
        return Promise.resolve(
          all()
            .filter(
              (purchase) =>
                isReconcilable(purchase) &&
                purchase.deadlineAt !== null &&
                purchase.deadlineAt.getTime() >= input.deadlineFrom.getTime() &&
                purchase.deadlineAt.getTime() <= input.deadlineTo.getTime(),
            )
            .toSorted(byTimeThenId((purchase) => purchase.deadlineAt))
            .slice(0, input.limit),
        );
      },
      findStaleOpen: (input) => {
        this.queries.staleOpen.push(input);
        return Promise.resolve(
          all()
            .filter(
              (purchase) =>
                isReconcilable(purchase) &&
                purchase.expiresAt.getTime() < input.expiredBefore.getTime(),
            )
            .toSorted(byTimeThenId((purchase) => purchase.expiresAt))
            .slice(0, input.limit),
        );
      },
      findPendingConfirmations: (input) => {
        this.queries.pendingConfirmations.push(input);
        return Promise.resolve(
          all()
            .filter(
              (purchase) =>
                purchase.confirmationEmailStatus === 'pending' &&
                purchase.reflectedAt !== null &&
                purchase.reflectedAt.getTime() <
                  input.reflectedBefore.getTime(),
            )
            .toSorted(byTimeThenId((purchase) => purchase.reflectedAt))
            .slice(0, input.limit),
        );
      },
      advanceAlone: (input) => {
        this.advances.push(input);
        const purchase = this.purchases.get(input.purchaseId);
        if (purchase === undefined || !input.from.includes(purchase.status)) {
          return Promise.resolve(false);
        }
        this.update(input.purchaseId, {
          ...input.patch,
          status: input.to,
          stateToken: input.nextToken,
        });
        return Promise.resolve(true);
      },
    });
  }
}

export type SessionBehavior =
  | {
      readonly kind: 'snapshot';
      readonly snapshot: StripeCheckoutSessionSnapshot;
    }
  | { readonly kind: 'error'; readonly error: Error };

// 決済セッションごとの取得の結果。指定の無い決済セッションは失効として返す
export function createJobSessionGateway(
  calls: string[],
  behaviors: ReadonlyMap<string, SessionBehavior>,
  fallback: (sessionId: string) => StripeCheckoutSessionSnapshot,
): StripeGateway {
  return partialFake<StripeGateway>({
    retrieveCheckoutSession: (sessionId) => {
      calls.push(`retrieve:${sessionId}`);
      const behavior = behaviors.get(sessionId);
      if (behavior?.kind === 'error') {
        return Promise.reject(behavior.error);
      }
      return Promise.resolve(behavior?.snapshot ?? fallback(sessionId));
    },
  });
}

export interface JobReflection {
  readonly sessionId: string;
  readonly occurredAt: Date;
}

// StripeCheckoutSessionReflectionと同じく、失効した決済セッションと未払いの完了を失効に、支払い済みを確定に進め、完了済みの購入を変えない
export function createJobReflector(
  purchases: InMemoryJobPurchases,
  reflections: JobReflection[],
  failures: ReadonlyMap<string, Error> = new Map(),
): PaymentReflector {
  return partialFake<PaymentReflector>({
    reflectCheckoutSnapshot: (snapshot, occurredAt) => {
      reflections.push({ sessionId: snapshot.id, occurredAt });
      const failure = failures.get(snapshot.id);
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      const purchase = purchases.bySessionId(snapshot.id);
      if (purchase === undefined) {
        return Promise.resolve({ kind: 'unresolved' as const });
      }
      if (
        !RECONCILABLE.includes(purchase.status) ||
        snapshot.status === 'open'
      ) {
        return Promise.resolve({
          kind: 'already_applied' as const,
          purchaseStatus: purchase.status,
        });
      }
      const to =
        snapshot.status === 'complete' && snapshot.paymentStatus === 'paid'
          ? ('fulfilled' as const)
          : ('expired' as const);
      purchases.update(purchase.id, { status: to, lastEventAt: occurredAt });
      return Promise.resolve({ kind: 'applied' as const, purchaseStatus: to });
    },
  });
}

export function jobRefundOf(
  serial: number,
  overrides: Partial<RefundRequestRecord> = {},
): RefundRequestRecord {
  return {
    id: jobUlidOf('01JDRFND', serial),
    purchaseId: jobUlidOf('01JDPRCH', serial),
    requestKey: `reflection:late:${String(serial)}`,
    amount: 1500,
    reason: 'late',
    noticeStatus: 'none',
    status: 'requested',
    stripeRefundId: null,
    failureCode: null,
    dispatchedAt: null,
    createdAt: new Date(SWEEP_TIME.getTime() - HOUR_MS),
    updatedAt: new Date(SWEEP_TIME.getTime() - HOUR_MS),
    ...overrides,
  };
}

export interface RefundQueries {
  readonly undispatched: {
    readonly createdBefore: Date;
    readonly limit: number;
  }[];
  readonly pendingNotices: {
    readonly updatedBefore: Date;
    readonly limit: number;
  }[];
}

// D1RefundStoreと同じ条件と順で、未送信の返金の依頼と依頼待ちの自動返金の通知を探す
export class InMemoryJobRefunds {
  readonly queries: RefundQueries = { undispatched: [], pendingNotices: [] };
  private readonly refunds = new Map<string, RefundRequestRecord>();

  constructor(refunds: readonly RefundRequestRecord[] = []) {
    for (const refund of refunds) {
      this.refunds.set(refund.id, refund);
    }
  }

  get(refundRequestId: string): RefundRequestRecord | undefined {
    return this.refunds.get(refundRequestId);
  }

  update(refundRequestId: string, patch: Partial<RefundRequestRecord>): void {
    const refund = this.refunds.get(refundRequestId);
    if (refund !== undefined) {
      this.refunds.set(refundRequestId, { ...refund, ...patch });
    }
  }

  store(): RefundStore {
    const ordered = (timeOf: (refund: RefundRequestRecord) => Date) =>
      [...this.refunds.values()].toSorted(
        (left, right) =>
          timeOf(left).getTime() - timeOf(right).getTime() ||
          left.id.localeCompare(right.id),
      );
    return partialFake<RefundStore>({
      findUndispatched: (input) => {
        this.queries.undispatched.push(input);
        return Promise.resolve(
          ordered((refund) => refund.createdAt)
            .filter(
              (refund) =>
                refund.dispatchedAt === null &&
                refund.createdAt.getTime() < input.createdBefore.getTime(),
            )
            .slice(0, input.limit),
        );
      },
      findPendingNotices: (input) => {
        this.queries.pendingNotices.push(input);
        return Promise.resolve(
          ordered((refund) => refund.updatedAt)
            .filter(
              (refund) =>
                refund.status === 'succeeded' &&
                refund.noticeStatus === 'pending' &&
                refund.updatedAt.getTime() < input.updatedBefore.getTime(),
            )
            .slice(0, input.limit),
        );
      },
    });
  }
}

// D1PaymentRefundsと同じく、送信済みなら何もしない
export function createJobPaymentRefunds(
  refunds: InMemoryJobRefunds,
  dispatched: string[],
  failures: ReadonlyMap<string, Error> = new Map(),
): PaymentRefunds {
  return partialFake<PaymentRefunds>({
    dispatch: (refundRequestId) => {
      dispatched.push(refundRequestId);
      const failure = failures.get(refundRequestId);
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      if (refunds.get(refundRequestId)?.dispatchedAt === null) {
        refunds.update(refundRequestId, { dispatchedAt: RUN_CLOCK_TIME });
      }
      return Promise.resolve();
    },
  });
}

// 送信の失敗はfailed、入力を組み立てられない行はskipped
export type NoticeBehavior = 'failed' | 'skipped' | Error;

export interface NoticeCalls {
  readonly purchases: string[];
  readonly refunds: string[];
}

// EmailPurchaseNotifierと同じく、依頼待ちの行だけを依頼済みか対象外に進め、送信に失敗すれば依頼待ちのまま残す
export function createJobNotifier(
  purchases: InMemoryJobPurchases,
  refunds: InMemoryJobRefunds,
  calls: NoticeCalls,
  behaviors: ReadonlyMap<string, NoticeBehavior> = new Map(),
): PurchaseNotifier {
  const outcomeOf = (
    id: string,
    pending: boolean,
    mark: (to: 'requested' | 'skipped') => void,
  ): Promise<NoticeOutcome> => {
    const behavior = behaviors.get(id);
    if (behavior instanceof Error) {
      return Promise.reject(behavior);
    }
    if (!pending) {
      return Promise.resolve('not_pending');
    }
    if (behavior === 'failed') {
      return Promise.resolve('failed');
    }
    const to = behavior ?? 'requested';
    mark(to);
    return Promise.resolve(to);
  };
  return partialFake<PurchaseNotifier>({
    notifyPurchase: (purchaseId) => {
      calls.purchases.push(purchaseId);
      return outcomeOf(
        purchaseId,
        purchases.get(purchaseId)?.confirmationEmailStatus === 'pending',
        (to) => {
          purchases.update(purchaseId, { confirmationEmailStatus: to });
        },
      );
    },
    notifyAutomaticRefund: (refundRequestId) => {
      calls.refunds.push(refundRequestId);
      return outcomeOf(
        refundRequestId,
        refunds.get(refundRequestId)?.noticeStatus === 'pending',
        (to) => {
          refunds.update(refundRequestId, { noticeStatus: to });
        },
      );
    },
  });
}

export interface DeletionCall {
  readonly threshold: Date;
  readonly limit: number;
}

// D1PaymentRecordStoreと同じく、記録日時が閾値より前の記録を古い順に上限まで消し、消した件数を返す
export class InMemoryRecordedAt {
  readonly deletions: DeletionCall[] = [];
  private recordedAts: Date[];

  constructor(
    recordedAts: readonly Date[],
    private readonly failures: ReadonlyMap<number, Error> = new Map(),
  ) {
    this.recordedAts = [...recordedAts];
  }

  remaining(): readonly Date[] {
    return this.recordedAts.toSorted(
      (left, right) => left.getTime() - right.getTime(),
    );
  }

  store(): PaymentRecordStore {
    return partialFake<PaymentRecordStore>({
      deleteRecordedBefore: (threshold, limit) => {
        const failure = this.failures.get(this.deletions.length);
        this.deletions.push({ threshold, limit });
        if (failure !== undefined) {
          return Promise.reject(failure);
        }
        const expired = this.remaining()
          .filter((recordedAt) => recordedAt.getTime() < threshold.getTime())
          .slice(0, limit);
        const removed = new Set(expired);
        this.recordedAts = this.recordedAts.filter(
          (recordedAt) => !removed.has(recordedAt),
        );
        return Promise.resolve(expired.length);
      },
    });
  }
}

export function createIncidentRecorder(): {
  readonly reporter: PaymentsJobIncidentReporter;
  readonly incidents: PaymentsJobIncident[];
} {
  const incidents: PaymentsJobIncident[] = [];
  return {
    reporter: {
      report: (incident) => {
        incidents.push(incident);
      },
    },
    incidents,
  };
}

export function createJobLogCapture() {
  const records: LogRecord[] = [];
  return {
    start(): void {
      records.length = 0;
      configureSync({
        reset: true,
        sinks: { memory: (record) => records.push(record) },
        loggers: [
          { category: ['logtape', 'meta'], lowestLevel: 'warning', sinks: [] },
          { category: ['api'], lowestLevel: 'debug', sinks: ['memory'] },
        ],
      });
    },
    stop(): void {
      resetSync();
    },
    of(feature: string) {
      return records
        .filter(
          (record) => record.category.join('.') === `api.payments.${feature}`,
        )
        .map(({ level, properties }) => ({ level, properties }));
    },
  };
}
