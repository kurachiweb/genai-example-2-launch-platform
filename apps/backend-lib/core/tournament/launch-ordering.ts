import type { BusinessDate } from '../time/business-time.ts';
import type { Comparator } from './bracket-draw-rules.ts';

export interface LaunchOrderingKey {
  readonly launchDate: BusinessDate;
  readonly upvoteCount: number;
  // 勝利した予選の開始からの経過。Upvote数0ならnull
  readonly lastUpvoteElapsedMs: number | null;
}

function byUpvoteCountDescending(
  a: LaunchOrderingKey,
  b: LaunchOrderingKey,
): number {
  return b.upvoteCount - a.upvoteCount;
}

function byLastUpvoteAscending(
  a: LaunchOrderingKey,
  b: LaunchOrderingKey,
): number {
  if (a.lastUpvoteElapsedMs === b.lastUpvoteElapsedMs) {
    return 0;
  }
  if (a.lastUpvoteElapsedMs === null) {
    return 1;
  }
  if (b.lastUpvoteElapsedMs === null) {
    return -1;
  }
  return a.lastUpvoteElapsedMs - b.lastUpvoteElapsedMs;
}

function byLaunchDateAscending(
  a: LaunchOrderingKey,
  b: LaunchOrderingKey,
): number {
  if (a.launchDate === b.launchDate) {
    return 0;
  }
  return a.launchDate < b.launchDate ? -1 : 1;
}

export const launchSeedOrder: Comparator<LaunchOrderingKey> = (a, b) =>
  byUpvoteCountDescending(a, b) || byLastUpvoteAscending(a, b);

export const launchNonSeedOrder: Comparator<LaunchOrderingKey> = (a, b) =>
  byLaunchDateAscending(a, b) ||
  byUpvoteCountDescending(a, b) ||
  byLastUpvoteAscending(a, b);
