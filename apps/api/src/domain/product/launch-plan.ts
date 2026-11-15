import {
  deriveLaunchStatus,
  type LaunchFacts,
  type LaunchStatus,
} from '../../../lib/core/product/launch-status.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';
import type { LaunchBasis } from './launch-date-rules.ts';

export interface IdentifiedLaunch extends LaunchFacts {
  readonly id: string;
}

export interface PlanBlock {
  // 'launch_scheduled'・'qualifier_in_progress'・'product_hidden'・供給元の値
  readonly code: string;
  readonly message: string;
  readonly releaseAt: Date | null;
}

export interface PlanLock {
  // 'qualifier_match'・供給元の値
  readonly code: string;
  readonly message: string;
}

export type LaunchPlan =
  | { readonly mode: 'new'; readonly basis: LaunchBasis | null }
  | {
      readonly mode: 'reschedule';
      readonly launchId: string;
      readonly current: BusinessDate;
      readonly basis: LaunchBasis | null;
    }
  | { readonly mode: 'blocked'; readonly blocks: readonly PlanBlock[] }
  | { readonly mode: 'unknown' };

export interface LaunchLocks {
  readonly locked: boolean;
  readonly locks: readonly PlanLock[];
  readonly unknown: boolean;
}

export const LAUNCH_PLAN_MESSAGES = Object.freeze({
  launch_scheduled:
    'このプロダクトはローンチ予定があるため再ローンチできません。',
  qualifier_in_progress:
    'このプロダクトは予選マッチに参加中のため再ローンチできません。',
  product_hidden:
    'このプロダクトは公開が停止されているため、ローンチを予約できません。',
  qualifier_match:
    'マッチ直前・マッチ中のため、ローンチ日・カテゴリの変更と削除はできません。',
} as const);

type OwnBlockCode = Exclude<
  keyof typeof LAUNCH_PLAN_MESSAGES,
  'qualifier_match'
>;

interface StatusedLaunch {
  readonly launch: IdentifiedLaunch;
  readonly status: Exclude<LaunchStatus, 'canceled'>;
}

const ownBlock = (code: OwnBlockCode): PlanBlock => ({
  code,
  message: LAUNCH_PLAN_MESSAGES[code],
  releaseAt: null,
});

const QUALIFIER_MATCH_LOCK: PlanLock = Object.freeze({
  code: 'qualifier_match',
  message: LAUNCH_PLAN_MESSAGES.qualifier_match,
});

// launchesはローンチ日の新しい順で渡される
const activeLaunchesOf = (
  launches: readonly IdentifiedLaunch[],
  now: Date,
): readonly StatusedLaunch[] =>
  launches.flatMap((launch) => {
    const status = deriveLaunchStatus(launch, now);
    return status === 'canceled' ? [] : [{ launch, status }];
  });

const basisOf = (launch: StatusedLaunch | undefined): LaunchBasis | null =>
  launch?.status === 'finished' && launch.launch.outcome !== null
    ? { launchDate: launch.launch.launchDate, outcome: launch.launch.outcome }
    : null;

const isQualifierLocked = (latest: StatusedLaunch | undefined): boolean =>
  latest?.status === 'paired' || latest?.status === 'in_progress';

export function decideLaunchPlan(input: {
  readonly now: Date;
  readonly hidden: boolean;
  readonly launches: readonly IdentifiedLaunch[];
  readonly sourceBlocks: readonly PlanBlock[] | 'unavailable';
}): LaunchPlan {
  const [latest, previous] = activeLaunchesOf(input.launches, input.now);
  switch (latest?.status) {
    case 'scheduled':
      return {
        mode: 'reschedule',
        launchId: latest.launch.id,
        current: latest.launch.launchDate,
        basis: basisOf(previous),
      };
    case 'paired':
      return { mode: 'blocked', blocks: [ownBlock('launch_scheduled')] };
    case 'in_progress':
      return { mode: 'blocked', blocks: [ownBlock('qualifier_in_progress')] };
    default:
      break;
  }
  if (input.hidden) {
    return { mode: 'blocked', blocks: [ownBlock('product_hidden')] };
  }
  if (input.sourceBlocks === 'unavailable') {
    return { mode: 'unknown' };
  }
  if (input.sourceBlocks.length > 0) {
    return { mode: 'blocked', blocks: input.sourceBlocks };
  }
  return { mode: 'new', basis: basisOf(latest) };
}

export function decideLocks(input: {
  readonly now: Date;
  readonly launches: readonly IdentifiedLaunch[];
  readonly sourceLocks: readonly PlanLock[] | 'unavailable';
}): LaunchLocks {
  const [latest] = activeLaunchesOf(input.launches, input.now);
  const unknown = input.sourceLocks === 'unavailable';
  const locks = [
    ...(isQualifierLocked(latest) ? [QUALIFIER_MATCH_LOCK] : []),
    ...(input.sourceLocks === 'unavailable' ? [] : input.sourceLocks),
  ];
  return { locked: locks.length > 0, locks, unknown };
}
