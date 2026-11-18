import { AppError } from '../../../../lib/core/errors/app-error.ts';
import type {
  AccountGuard,
  CurrentUser,
} from '../../../../lib/core/identity/account-guard.ts';
import type { SessionView } from '../../../../lib/core/session/session-view.ts';
import type {
  EligibleProductReader,
  NewSponsorship,
  SponsorshipRecord,
  SponsorshipStore,
} from '../../../../lib/core/sponsorship/ports.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../../lib/core/time/business-time.ts';
import type {
  CheckoutStarter,
  CheckoutStartInput,
} from '../../payments/checkout-starter.ts';

export const USER_ID = '01JF0SPUSER000000000000001';
export const OTHER_USER_ID = '01JF0SPUSER000000000000002';
export const PRODUCT_ID = '01JF0SPPRDT000000000000001';
export const SPONSORSHIP_ID = '01JF0SPSPNS000000000000001';
export const PURCHASE_ID = '01JF0SPPRCH000000000000001';

export const TODAY = parseBusinessDate('2026-11-25');
// 業務日付の2026-11-25の23:59。翌日にならない範囲で0:00より後の時刻を使う
export const NOW = fromBusinessDateTime(TODAY, { hour: 23, minute: 59 });

export const SESSION: SessionView = Object.freeze({
  principal: () =>
    Promise.resolve({
      kind: 'authenticated' as const,
      subjectKind: 'user' as const,
      subjectId: USER_ID,
      sessionId: '01JF0SPSESS000000000000001',
    }),
});

export const CURRENT_USER: CurrentUser = {
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: USER_ID,
    sessionId: '01JF0SPSESS000000000000001',
  },
  user: {
    id: USER_ID,
    pseudonymousId: '01JF0SPPSEU000000000000001',
    status: 'active',
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    email: 'sponsor@mail.example',
    nickname: '広告主',
    handle: 'sponsor',
  },
};

export const accountUnavailableError = (): AppError =>
  new AppError({
    kind: 'forbidden',
    code: 'account_unavailable',
    message:
      'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
  });

export const emailNotVerifiedError = (): AppError =>
  new AppError({
    kind: 'forbidden',
    code: 'email_not_verified',
    message:
      'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。',
  });

export const botVerificationFailedError = (): AppError =>
  new AppError({
    kind: 'forbidden',
    code: 'bot_verification_failed',
    message: '認証に失敗しました。ページを再読み込みして再度お試しください。',
  });

export function sponsorshipRecordOf(
  overrides: Partial<SponsorshipRecord> = {},
): SponsorshipRecord {
  return {
    id: SPONSORSHIP_ID,
    userId: USER_ID,
    productId: PRODUCT_ID,
    tier: 'gold',
    startsOn: parseBusinessDate('2026-12-01'),
    endsOn: parseBusinessDate('2026-12-07'),
    days: 7,
    state: 'pending_payment',
    purchaseId: null,
    paymentRecordId: null,
    amountTotal: null,
    paidAt: null,
    terminatedAt: null,
    terminationReason: null,
    productDeletedAt: null,
    terminationRefund: {
      status: 'none',
      days: null,
      amount: null,
      refundRequestId: null,
    },
    stopRefund: {
      status: 'none',
      days: null,
      amount: null,
      refundRequestId: null,
    },
    createdAt: NOW,
    ...overrides,
  };
}

// 呼び出しの順を1つの列に記録し、手順の順序を確かめる
export type ApplicationCall =
  | { readonly kind: 'guard' }
  | { readonly kind: 'humanCheck' }
  | {
      readonly kind: 'isEligible';
      readonly userId: string;
      readonly productId: string;
      readonly now: Date;
    }
  | {
      readonly kind: 'hasPaidOverlap';
      readonly input: Parameters<SponsorshipStore['hasPaidOverlap']>[0];
    }
  | {
      readonly kind: 'create';
      readonly input: NewSponsorship;
      readonly at: Date;
    }
  | { readonly kind: 'findById'; readonly id: string }
  | { readonly kind: 'start'; readonly input: CheckoutStartInput }
  | { readonly kind: 'deleteUnpaid'; readonly id: string };

export interface ApplicationFakeOptions {
  readonly guardError?: AppError;
  readonly humanCheckError?: AppError;
  readonly eligible?: boolean;
  readonly overlaps?: boolean;
  readonly found?: SponsorshipRecord | undefined;
  readonly startError?: Error;
  readonly deleteError?: Error;
}

export interface ApplicationFakes {
  readonly calls: ApplicationCall[];
  readonly guard: AccountGuard;
  readonly humanCheck: () => Promise<void>;
  readonly store: SponsorshipStore;
  readonly eligibleProducts: EligibleProductReader;
  readonly starter: CheckoutStarter;
}

const unexpected = (): Promise<never> =>
  Promise.reject(new Error('呼ばれない想定です'));

export function createApplicationFakes(
  options: ApplicationFakeOptions = {},
): ApplicationFakes {
  const calls: ApplicationCall[] = [];
  const guard: AccountGuard = {
    currentUser: unexpected,
    requireUser: unexpected,
    requireWritableUser: unexpected,
    requireVerifiedUser: () => {
      calls.push({ kind: 'guard' });
      return options.guardError === undefined
        ? Promise.resolve(CURRENT_USER)
        : Promise.reject(options.guardError);
    },
  };
  const humanCheck = (): Promise<void> => {
    calls.push({ kind: 'humanCheck' });
    return options.humanCheckError === undefined
      ? Promise.resolve()
      : Promise.reject(options.humanCheckError);
  };
  const store: SponsorshipStore = {
    create: (input, at) => {
      calls.push({ kind: 'create', input, at });
      return Promise.resolve(sponsorshipRecordOf({ ...input, createdAt: at }));
    },
    findById: (id) => {
      calls.push({ kind: 'findById', id });
      return Promise.resolve(
        'found' in options ? options.found : sponsorshipRecordOf(),
      );
    },
    hasPaidOverlap: (input) => {
      calls.push({ kind: 'hasPaidOverlap', input });
      return Promise.resolve(options.overlaps ?? false);
    },
    deleteUnpaid: (id) => {
      calls.push({ kind: 'deleteUnpaid', id });
      return options.deleteError === undefined
        ? Promise.resolve()
        : Promise.reject(options.deleteError);
    },
    listPaidPeriods: unexpected,
    listByOwner: unexpected,
    listForAdmin: unexpected,
    countActiveForProduct: unexpected,
    deleteExpiredUnpaid: unexpected,
    listUnsettledEnded: unexpected,
  };
  const eligibleProducts: EligibleProductReader = {
    list: unexpected,
    isEligible: (userId, productId, now) => {
      calls.push({ kind: 'isEligible', userId, productId, now });
      return Promise.resolve(options.eligible ?? true);
    },
  };
  const starter: CheckoutStarter = {
    start: (input) => {
      calls.push({ kind: 'start', input });
      return options.startError === undefined
        ? Promise.resolve({ purchaseId: PURCHASE_ID })
        : Promise.reject(options.startError);
    },
  };
  return { calls, guard, humanCheck, store, eligibleProducts, starter };
}

export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('拒否される想定です');
}
