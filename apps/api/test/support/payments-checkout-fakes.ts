import { AppError } from '../../lib/core/errors/app-error.ts';
import type {
  AccountGuard,
  CurrentUser,
} from '../../lib/core/identity/account-guard.ts';
import type {
  PaymentRecordCursor,
  PaymentRecordRow,
  PaymentRecordStore,
  PaymentReflector,
  PurchaseRecord,
  PurchaseStore,
  ReflectionOutcome,
  StripeCheckoutSessionSnapshot,
  StripeGateway,
} from '../../lib/core/payments/ports.ts';
import type { SessionView } from '../../lib/core/session/session-view.ts';
import type { Clock } from '../../lib/core/time/clock.ts';

export const NOW = new Date('2027-04-01T09:00:00.000Z');
export const HOUR_MS = 3_600_000;
export const USER_ID = '01JD0000000000000000USER01';
export const OTHER_USER_ID = '01JD0000000000000000USER02';
export const PSEUDONYMOUS_ID = '01JD0000000000000000PSEU01';
export const PURCHASE_ID = '01JD0000000000000000PURC01';
export const SESSION_ID = 'cs_test_a1B2c3D4e5F6';
export const CLIENT_SECRET = 'cs_test_a1B2c3D4e5F6_secret_x9Y8';

export const SESSION: SessionView = Object.freeze({
  principal: () =>
    Promise.resolve({
      kind: 'authenticated' as const,
      subjectKind: 'user' as const,
      subjectId: USER_ID,
      sessionId: '01JD0000000000000000SESS01',
    }),
});

export const CURRENT_USER: CurrentUser = {
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: USER_ID,
    sessionId: '01JD0000000000000000SESS01',
  },
  user: {
    id: USER_ID,
    pseudonymousId: PSEUDONYMOUS_ID,
    status: 'active',
    emailVerifiedAt: new Date('2027-01-01T00:00:00.000Z'),
    deletedAt: null,
    email: 'buyer@mail.example',
    nickname: '購入する人',
    handle: 'buyer',
  },
};

export const UNAUTHENTICATED = new AppError({
  kind: 'unauthenticated',
  code: 'unauthenticated',
  message: 'ログインしてください。',
});

export const FIXED_CLOCK: Clock = Object.freeze({ now: () => NOW });

export const unexpected = (): Promise<never> =>
  Promise.reject(new Error('呼ばれない想定です'));

export function purchaseRecordOf(
  overrides: Partial<PurchaseRecord> = {},
): PurchaseRecord {
  return {
    id: PURCHASE_ID,
    userId: USER_ID,
    kind: 'week_tournament_entry',
    targetId: '01JD0000000000000000ENTRY1',
    relatedId: '01JD0000000000000000LAUNC1',
    exclusivityKey: 'week:01JD0000000000000000ENTRY1',
    stateToken: '01JD0000000000000000TOKEN1',
    priceLookupKey: 'week_tournament_entry_v1',
    stripePriceId: 'price_week_entry',
    unitAmount: 500,
    quantity: 3,
    amountTotal: 1500,
    summary: {
      itemName: 'Weekトーナメント参加費',
      quantityLabel: '3日間',
      serviceTiming: '決済の直後',
      additionalNotes: ['決勝の結果は翌週に通知します。'],
    },
    deadlineAt: new Date(NOW.getTime() + 10 * HOUR_MS),
    acceptUntil: new Date(NOW.getTime() + 5 * HOUR_MS),
    fulfillableUntil: new Date(NOW.getTime() + 11 * HOUR_MS),
    expiresAt: new Date(NOW.getTime() + HOUR_MS),
    status: 'open',
    rejectionReason: null,
    stripeCheckoutSessionId: SESSION_ID,
    stripePaymentIntentId: null,
    stripeInvoiceId: null,
    stripeSubscriptionId: null,
    consentedAt: null,
    consentVersion: null,
    paidAt: null,
    reflectedAt: null,
    confirmationEmailStatus: 'none',
    lastEventAt: null,
    createdAt: new Date(NOW.getTime() - HOUR_MS),
    ...overrides,
  };
}

export function sessionSnapshotOf(
  overrides: Partial<StripeCheckoutSessionSnapshot> = {},
): StripeCheckoutSessionSnapshot {
  return {
    id: SESSION_ID,
    status: 'open',
    paymentStatus: 'unpaid',
    clientSecret: CLIENT_SECRET,
    amountTotal: 1500,
    currency: 'usd',
    expiresAt: new Date(NOW.getTime() + HOUR_MS),
    paymentIntentId: null,
    paymentIntentStatus: null,
    invoiceId: null,
    subscriptionId: null,
    linkFundingSourceGroup: null,
    metadata: {
      purchase_id: PURCHASE_ID,
      purchase_kind: 'week_tournament_entry',
      pseudonymous_id: PSEUDONYMOUS_ID,
    },
    ...overrides,
  };
}

export const ACCOUNT_UNAVAILABLE = new AppError({
  kind: 'forbidden',
  code: 'account_unavailable',
  message:
    'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
});

// errorは全ての確認を、writableErrorは停止中の利用者のように書き込みを伴う操作の確認だけを拒否する
export function createAccountGuard(
  calls: string[],
  error?: Error,
  writableError?: Error,
): AccountGuard {
  const resolveOr = (failure: Error | undefined) =>
    failure === undefined
      ? Promise.resolve(CURRENT_USER)
      : Promise.reject(failure);
  return {
    requireUser: () => {
      calls.push('requireUser');
      return resolveOr(error);
    },
    requireWritableUser: () => {
      calls.push('requireWritableUser');
      return resolveOr(error ?? writableError);
    },
    currentUser: unexpected,
    requireVerifiedUser: unexpected,
  };
}

export interface ConsentCall {
  readonly purchaseId: string;
  readonly userId: string;
  readonly consentedAt: Date;
  readonly version: string;
}

// D1PurchaseStoreの同意の記録と同じく、本人のopenの購入にだけ同意の日時と版を上書きする
export class InMemoryCheckoutPurchases {
  readonly consentCalls: ConsentCall[] = [];
  private readonly purchases = new Map<string, PurchaseRecord>();

  constructor(
    private readonly calls: string[],
    purchases: readonly PurchaseRecord[] = [],
  ) {
    for (const purchase of purchases) {
      this.purchases.set(purchase.id, purchase);
    }
  }

  put(purchase: PurchaseRecord): void {
    this.purchases.set(purchase.id, purchase);
  }

  get(purchaseId: string): PurchaseRecord | undefined {
    return this.purchases.get(purchaseId);
  }

  store(): PurchaseStore {
    return {
      findById: (purchaseId) => {
        this.calls.push('findById');
        return Promise.resolve(this.purchases.get(purchaseId));
      },
      findBySessionId: (sessionId) => {
        this.calls.push('findBySessionId');
        return Promise.resolve(
          [...this.purchases.values()].find(
            (purchase) => purchase.stripeCheckoutSessionId === sessionId,
          ),
        );
      },
      recordConsent: (input) => {
        this.calls.push('recordConsent');
        this.consentCalls.push(input);
        const purchase = this.purchases.get(input.purchaseId);
        if (
          purchase === undefined ||
          purchase.userId !== input.userId ||
          purchase.status !== 'open'
        ) {
          return Promise.resolve('not_open' as const);
        }
        this.purchases.set(purchase.id, {
          ...purchase,
          consentedAt: input.consentedAt,
          consentVersion: input.version,
        });
        return Promise.resolve('recorded' as const);
      },
      findByPaymentIntentId: unexpected,
      findFulfilledByExclusivityKey: unexpected,
      attachSession: unexpected,
      findOpenByUser: unexpected,
      findOpenByTarget: unexpected,
      findReconcilable: unexpected,
      findStaleOpen: unexpected,
      advanceAlone: unexpected,
      findPendingConfirmations: unexpected,
      markConfirmationEmail: unexpected,
    };
  }
}

export function createSessionGateway(
  calls: string[],
  retrieve: (sessionId: string) => Promise<StripeCheckoutSessionSnapshot>,
): StripeGateway {
  return {
    retrieveCheckoutSession: (sessionId) => {
      calls.push('retrieveCheckoutSession');
      return retrieve(sessionId);
    },
    ensureCustomer: unexpected,
    deleteCustomer: unexpected,
    resolvePrices: unexpected,
    createCheckoutSession: unexpected,
    expireCheckoutSession: unexpected,
    retrieveInvoice: unexpected,
    retrieveRefund: unexpected,
    retrieveDispute: unexpected,
    retrieveSubscription: unexpected,
    createRefund: unexpected,
    cancelSubscription: unexpected,
    createPortalSession: unexpected,
    retrievePaymentIntentOwner: unexpected,
  };
}

export interface SnapshotReflection {
  readonly snapshot: StripeCheckoutSessionSnapshot;
  readonly occurredAt: Date;
}

export function createSnapshotReflector(
  calls: string[],
  reflections: SnapshotReflection[],
  reflect: (
    snapshot: StripeCheckoutSessionSnapshot,
  ) => Promise<ReflectionOutcome>,
): PaymentReflector {
  return {
    reflectCheckoutSnapshot: (snapshot, occurredAt) => {
      calls.push('reflectCheckoutSnapshot');
      reflections.push({ snapshot, occurredAt });
      return reflect(snapshot);
    },
    reflect: unexpected,
  };
}

export interface RecordListCall {
  readonly pseudonymousId: string;
  readonly first: number;
  readonly after: PaymentRecordCursor | null;
}

export function paymentRecordRowOf(
  serial: number,
  overrides: Partial<PaymentRecordRow> = {},
): PaymentRecordRow {
  return {
    id: `01JD${String(serial).padStart(22, '0')}`,
    kind: 'one_time',
    purpose: 'week_tournament_entry',
    amount: 1500,
    currency: 'usd',
    quantity: 3,
    status: 'succeeded',
    stripeReference: `cs_test_${String(serial)}`,
    relatedId: '01JD0000000000000000LAUNC1',
    occurredAt: new Date(NOW.getTime() - serial * HOUR_MS),
    ...overrides,
  };
}

// D1PaymentRecordStoreの一覧と同じく、発生時刻の降順・IDの降順で、カーソルの位置より後ろの行を上限まで返す
export function createPaymentRecordStore(
  calls: string[],
  listCalls: RecordListCall[],
  rows: readonly PaymentRecordRow[],
): PaymentRecordStore {
  const ordered = rows.toSorted(
    (left, right) =>
      right.occurredAt.getTime() - left.occurredAt.getTime() ||
      right.id.localeCompare(left.id),
  );
  const isOlder = (row: PaymentRecordRow, cursor: PaymentRecordCursor) =>
    row.occurredAt.getTime() < cursor.occurredAt.getTime() ||
    (row.occurredAt.getTime() === cursor.occurredAt.getTime() &&
      row.id < cursor.id);
  return {
    listByPseudonymousId: (input) => {
      calls.push('listByPseudonymousId');
      listCalls.push(input);
      const { after } = input;
      return Promise.resolve(
        ordered
          .filter(
            (row) =>
              input.pseudonymousId === PSEUDONYMOUS_ID &&
              (after === null || isOlder(row, after)),
          )
          .slice(0, input.first),
      );
    },
    listAllByPseudonymousId: unexpected,
    deleteRecordedBefore: unexpected,
    findIdByReference: unexpected,
  };
}
