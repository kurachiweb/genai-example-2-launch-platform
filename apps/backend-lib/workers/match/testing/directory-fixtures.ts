import {
  insertLaunch,
  insertProduct,
  insertUser,
} from '../../product/testing/product-fixtures.ts';
import {
  clearMatchTables,
  MATCH_DATE,
  MATCH_WINDOW,
  type MatchFixture,
} from './match-fixtures.ts';

export const STARTS_AT = MATCH_WINDOW.startsAt;

export const ENDS_AT = MATCH_WINDOW.endsAt;

export const DECIDED_AT = new Date(ENDS_AT.getTime() + 60_000);

export const DURING_MATCH = new Date(STARTS_AT.getTime() + 3_600_000);

export const AFTER_DECISION = new Date(DECIDED_AT.getTime() + 60_000);

export function minutesAfterStart(minutes: number): Date {
  return new Date(STARTS_AT.getTime() + minutes * 60_000);
}

// 利用者1・2と、利用者1のプロダクト1・2、利用者2のプロダクト3・4を、同じ番号のローンチ付きで作る
export async function seedDirectoryOwners(): Promise<void> {
  await clearMatchTables();
  await insertUser(1);
  await insertUser(2);
  for (const index of [1, 2, 3, 4]) {
    await insertProduct(index, index <= 2 ? 1 : 2);
    await insertLaunch(index, index, { launchDate: MATCH_DATE });
  }
}

// ローンチ1(勝利、12票)とローンチ3(敗北、9票)の確定した予選
export function settledQualifier(index: number): MatchFixture {
  return {
    index,
    columns: {
      startedAt: STARTS_AT,
      decidedAt: DECIDED_AT,
      decision: 'votes',
    },
    entries: [
      {
        index: index * 10 + 1,
        launch: 1,
        product: 1,
        owner: 1,
        columns: {
          upvoteCount: 12,
          lastUpvotedAt: minutesAfterStart(842),
          lastUpvoteSeq: 20,
          result: 'won',
        },
      },
      {
        index: index * 10 + 2,
        launch: 3,
        product: 3,
        owner: 2,
        columns: {
          upvoteCount: 9,
          lastUpvotedAt: minutesAfterStart(1110),
          lastUpvoteSeq: 21,
          result: 'lost',
        },
      },
    ],
  };
}
