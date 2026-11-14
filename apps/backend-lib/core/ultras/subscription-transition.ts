import {
  benefitEndForScheduledEnd,
  type StripeSubscriptionStatus,
  type SubscriptionSnapshot,
} from './entitlement-rules.ts';
import type { UltrasNoticeKind } from './ports.ts';

export interface SubscriptionChangeInput {
  readonly status: StripeSubscriptionStatus;
  readonly cancelAtPeriodEnd: boolean;
  readonly cancelAt: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly endedAt: Date | null;
  readonly occurredAt: Date;
}

export interface SubscriptionTransitionNotice {
  readonly kind: UltrasNoticeKind;
  readonly dedupeKey: string;
  readonly benefitEndsAt: Date | null;
  readonly acceptedAt: Date;
}

// 本サービスの設定では届かないはずの値。純粋な規則はログを出さないため、呼び出し側が記録する
export type SubscriptionTransitionAnomaly =
  | {
      readonly kind: 'unexpected_status';
      readonly status: StripeSubscriptionStatus;
    }
  | { readonly kind: 'scheduled_end_missing' };

export interface SubscriptionTransitionResult {
  readonly next: SubscriptionSnapshot;
  readonly notices: readonly SubscriptionTransitionNotice[];
  readonly anomalies: readonly SubscriptionTransitionAnomaly[];
}

type BenefitEnd = Pick<
  SubscriptionSnapshot,
  'benefitEndsAt' | 'benefitEndFixed'
>;
type Cancellation = Pick<
  SubscriptionSnapshot,
  'canceledAt' | 'cancellationSource'
>;

// 初回の支払いを反映する前の、一度も見ていない定期課金の値
export const EMPTY_SUBSCRIPTION_SNAPSHOT: SubscriptionSnapshot = Object.freeze({
  stripeStatus: 'incomplete',
  cancelScheduled: false,
  cancelAt: null,
  currentPeriodEnd: null,
  endedAt: null,
  startedAt: null,
  benefitEndsAt: null,
  benefitEndFixed: false,
  canceledAt: null,
  cancellationSource: null,
  pendingCancellationSource: null,
  pastDueSince: null,
});

// Stripe側で終了した状態。D1のストアは終了していない加入の検索でこの集合を除く
export const ENDED_STRIPE_STATUSES = Object.freeze([
  'canceled',
  'unpaid',
  'incomplete_expired',
  'paused',
] as const satisfies readonly StripeSubscriptionStatus[]);

const ENDED_STATUSES: ReadonlySet<StripeSubscriptionStatus> = new Set(
  ENDED_STRIPE_STATUSES,
);

// 再試行の後は解約する設定と一時停止を使わない設定のため、届いたら設定の誤りとみなす
const UNEXPECTED_STATUSES: ReadonlySet<StripeSubscriptionStatus> = new Set([
  'unpaid',
  'paused',
]);

export function isEndedStripeStatus(status: StripeSubscriptionStatus): boolean {
  return ENDED_STATUSES.has(status);
}

const isAtOrAfter = (instant: Date, threshold: Date): boolean =>
  instant.getTime() >= threshold.getTime();

function resolveBenefitEnd(
  previous: SubscriptionSnapshot,
  change: SubscriptionChangeInput,
  cancelScheduled: boolean,
  ended: boolean,
): BenefitEnd {
  if (previous.benefitEndFixed) {
    return { benefitEndsAt: previous.benefitEndsAt, benefitEndFixed: true };
  }
  const scheduledEnd = change.cancelAt ?? change.currentPeriodEnd;
  const scheduledBenefitEnd =
    scheduledEnd === null ? null : benefitEndForScheduledEnd(scheduledEnd);
  if (!ended) {
    return {
      benefitEndsAt: cancelScheduled ? scheduledBenefitEnd : null,
      benefitEndFixed: false,
    };
  }
  // 予約どおり予定時刻に終了したときだけ末日の終わりまで特典を続け、それ以外の終了はその時点で終える
  const endedAsScheduled =
    (previous.cancelScheduled || cancelScheduled) &&
    scheduledEnd !== null &&
    change.endedAt !== null &&
    isAtOrAfter(change.endedAt, scheduledEnd);
  return {
    benefitEndsAt: endedAsScheduled
      ? scheduledBenefitEnd
      : (change.endedAt ?? change.occurredAt),
    benefitEndFixed: true,
  };
}

function resolveCancellation(
  previous: SubscriptionSnapshot,
  change: SubscriptionChangeInput,
  cancelScheduled: boolean,
  ended: boolean,
): Cancellation {
  const unchanged = {
    canceledAt: previous.canceledAt,
    cancellationSource: previous.cancellationSource,
  };
  if (previous.startedAt === null) {
    return unchanged;
  }
  if (!previous.cancelScheduled && cancelScheduled) {
    return {
      canceledAt: change.occurredAt,
      cancellationSource: previous.pendingCancellationSource ?? 'user',
    };
  }
  // 予約の取り消しは課金期間の末日より前にしか起きないため、終了した加入の記録は消さない
  if (previous.cancelScheduled && !cancelScheduled && !ended) {
    return { canceledAt: null, cancellationSource: null };
  }
  return unchanged;
}

function resolvePastDueSince(
  previous: SubscriptionSnapshot,
  change: SubscriptionChangeInput,
): Date | null {
  if (change.status !== 'past_due') {
    return null;
  }
  if (previous.stripeStatus === 'past_due') {
    return previous.pastDueSince;
  }
  return previous.startedAt === null ? null : change.occurredAt;
}

function buildNotices(
  previous: SubscriptionSnapshot,
  next: SubscriptionSnapshot,
  change: SubscriptionChangeInput,
  stripeSubscriptionId: string,
  ended: boolean,
): readonly SubscriptionTransitionNotice[] {
  if (previous.startedAt === null) {
    return [];
  }
  const noticeOf = (kind: UltrasNoticeKind): SubscriptionTransitionNotice => ({
    kind,
    dedupeKey: `${kind}:${stripeSubscriptionId}:${String(change.occurredAt.getTime())}`,
    benefitEndsAt: next.benefitEndsAt,
    acceptedAt: change.occurredAt,
  });
  const becamePastDue =
    previous.stripeStatus !== 'past_due' && change.status === 'past_due';
  // 終了した加入には取り消しの案内を送れないため、終了の変化では解約の受付の依頼を作らない
  const acceptedUserCancellation =
    !ended &&
    !previous.cancelScheduled &&
    next.cancelScheduled &&
    next.cancellationSource === 'user';
  return [
    ...(becamePastDue ? [noticeOf('payment_failed')] : []),
    ...(acceptedUserCancellation ? [noticeOf('cancellation_accepted')] : []),
  ];
}

function detectAnomalies(
  change: SubscriptionChangeInput,
  cancelScheduled: boolean,
): readonly SubscriptionTransitionAnomaly[] {
  const scheduledEndMissing =
    cancelScheduled &&
    change.cancelAt === null &&
    change.currentPeriodEnd === null;
  return [
    ...(UNEXPECTED_STATUSES.has(change.status)
      ? [{ kind: 'unexpected_status' as const, status: change.status }]
      : []),
    ...(scheduledEndMissing
      ? [{ kind: 'scheduled_end_missing' as const }]
      : []),
  ];
}

export function applySubscriptionChange(
  previous: SubscriptionSnapshot,
  change: SubscriptionChangeInput,
  stripeSubscriptionId: string,
): SubscriptionTransitionResult {
  const cancelScheduled = change.cancelAtPeriodEnd || change.cancelAt !== null;
  const ended = isEndedStripeStatus(change.status);
  const next: SubscriptionSnapshot = {
    stripeStatus: change.status,
    cancelScheduled,
    cancelAt: change.cancelAt,
    currentPeriodEnd: change.currentPeriodEnd,
    endedAt: change.endedAt,
    startedAt: previous.startedAt,
    ...resolveBenefitEnd(previous, change, cancelScheduled, ended),
    ...resolveCancellation(previous, change, cancelScheduled, ended),
    pendingCancellationSource: previous.pendingCancellationSource,
    pastDueSince: resolvePastDueSince(previous, change),
  };
  return {
    next,
    notices: buildNotices(previous, next, change, stripeSubscriptionId, ended),
    anomalies: detectAnomalies(change, cancelScheduled),
  };
}
