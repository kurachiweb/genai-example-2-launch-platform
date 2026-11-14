import type { UltrasPlanStatus } from '../../../common-lib/ultras/plan-status.ts';
import type { StripeSubscriptionStatus } from '../payments/purchase-kind-contract.ts';
import {
  fromBusinessDateTime,
  toBusinessDateTime,
} from '../time/business-time.ts';

export type { StripeSubscriptionStatus };

export type CancellationSource = 'user' | 'suspension' | 'withdrawal';

export interface SubscriptionSnapshot {
  readonly stripeStatus: StripeSubscriptionStatus;
  // cancelAtPeriodEndまたはcancelAtがある
  readonly cancelScheduled: boolean;
  readonly cancelAt: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly endedAt: Date | null;
  // 加入が有効になった時刻。未有効はnull
  readonly startedAt: Date | null;
  // 特典の終了時刻。開いているならnull
  readonly benefitEndsAt: Date | null;
  // 終了の状態で決めた値か
  readonly benefitEndFixed: boolean;
  // 解約の操作の時刻
  readonly canceledAt: Date | null;
  readonly cancellationSource: CancellationSource | null;
  readonly pendingCancellationSource: Exclude<
    CancellationSource,
    'user'
  > | null;
  readonly pastDueSince: Date | null;
}

export type BenefitPeriod = Pick<
  SubscriptionSnapshot,
  'startedAt' | 'benefitEndsAt'
>;

const MILLISECONDS_PER_DAY = 86_400_000;
const START_OF_DAY = { hour: 0, minute: 0 } as const;

// 区間の右端として使う、その業務日付の翌日0:00。業務時刻は固定オフセットのため、0:00に1日分を足した時点が翌日の0:00になる
export function endOfBusinessDayContaining(instant: Date): Date {
  const { date } = toBusinessDateTime(instant);
  return new Date(
    fromBusinessDateTime(date, START_OF_DAY).getTime() + MILLISECONDS_PER_DAY,
  );
}

// 課金期間は終了時刻を含まないため、期間の最後の瞬間(終了の1ミリ秒前)が属する業務日付の終わりを特典の終了時刻にする
export function benefitEndForScheduledEnd(scheduledEnd: Date): Date {
  return endOfBusinessDayContaining(new Date(scheduledEnd.getTime() - 1));
}

const isBenefitOver = (benefitEndsAt: Date | null, at: Date): boolean =>
  benefitEndsAt !== null && at.getTime() >= benefitEndsAt.getTime();

export function derivePlanStatus(
  snapshot: SubscriptionSnapshot,
  now: Date,
): UltrasPlanStatus | null {
  if (snapshot.startedAt === null) {
    return null;
  }
  if (isBenefitOver(snapshot.benefitEndsAt, now)) {
    return 'ended';
  }
  if (snapshot.stripeStatus === 'past_due') {
    return 'past_due';
  }
  return snapshot.benefitEndsAt === null ? 'active' : 'canceled';
}

// 特典の継続期間は[startedAt, benefitEndsAt)で、終了時刻が無ければ右に開いている
export function isEntitledAt(snapshot: BenefitPeriod, at: Date): boolean {
  return (
    snapshot.startedAt !== null &&
    snapshot.startedAt.getTime() <= at.getTime() &&
    !isBenefitOver(snapshot.benefitEndsAt, at)
  );
}

// 両端を含む期間[from, to]と特典の継続期間の重なり
export function overlapsPeriod(
  snapshot: BenefitPeriod,
  from: Date,
  to: Date,
): boolean {
  return (
    snapshot.startedAt !== null &&
    snapshot.startedAt.getTime() <= to.getTime() &&
    !isBenefitOver(snapshot.benefitEndsAt, from)
  );
}
