import type { MatchScheduleInput } from '../../../core/match/ports.ts';
import { parseBusinessDate } from '../../../core/time/business-time.ts';
import {
  insertUser,
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../../product/testing/product-fixtures.ts';
import {
  minutesAfterStart,
  seedDirectoryOwners,
  settledQualifier,
} from './directory-fixtures.ts';
import {
  entryIdOf,
  insertMatch,
  insertUpvotes,
  MATCH_DATE,
  MATCH_WINDOW,
  matchIdOf,
  upvoteIdOf,
} from './match-fixtures.ts';

export const SAMPLE_MATCH_ID = matchIdOf(1);
export const SAMPLE_WINNER_LAUNCH_ID = launchIdOf(1);
export const SAMPLE_WINNER_ENTRY_ID = entryIdOf(11);
export const SAMPLE_SUPPORTER_ID = userIdOf(3);
export const SAMPLE_UPVOTE_ID = upvoteIdOf(1);
export const SAMPLE_UPVOTED_AT = minutesAfterStart(30);
export const SAMPLE_SCHEDULED_MATCH_ID = matchIdOf(2);

// ローンチ1がローンチ3に勝った確定済みの予選1件と、利用者3によるローンチ1の側への有効なUpvote1件を作る。ローンチ2・4は予定の作成に使える
export async function seedMatchPlatformSample(): Promise<void> {
  await seedDirectoryOwners();
  await insertUser(3);
  await insertMatch(settledQualifier(1));
  await insertUpvotes([
    {
      index: 1,
      match: 1,
      entry: 11,
      user: 3,
      upvotedAt: SAMPLE_UPVOTED_AT,
    },
  ]);
}

// まだマッチに入っていないローンチ2とローンチ4の予選
export function sampleQualifierInput(): MatchScheduleInput {
  return {
    matchId: SAMPLE_SCHEDULED_MATCH_ID,
    kind: 'qualifier',
    round: null,
    stage: null,
    matchDate: parseBusinessDate(MATCH_DATE),
    startsAt: MATCH_WINDOW.startsAt,
    endsAt: MATCH_WINDOW.endsAt,
    entries: [
      {
        launchId: launchIdOf(2),
        productId: productIdOf(2),
        ownerUserId: userIdOf(1),
      },
      {
        launchId: launchIdOf(4),
        productId: productIdOf(4),
        ownerUserId: userIdOf(2),
      },
    ],
  };
}
