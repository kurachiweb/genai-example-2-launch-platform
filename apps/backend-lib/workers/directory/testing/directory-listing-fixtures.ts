import { directoryEntries } from '../../../../db/schema/directory/directory-entries.ts';
import type {
  EntryResult,
  MatchDecision,
} from '../../../core/match/match-model.ts';
import { qualifierWindow } from '../../../core/match/match-model.ts';
import { parseBusinessDate } from '../../../core/time/business-time.ts';
import {
  clearMatchTables,
  insertMatches,
} from '../../match/testing/match-fixtures.ts';
import { db, insertLaunches } from '../../product/testing/product-fixtures.ts';

const DECISION_DELAY_MS = 60_000;

export interface QualifierSideFixture {
  readonly product: number;
  readonly owner: number;
  // 確定前の側はnull
  readonly result: EntryResult | null;
  readonly upvotes?: number;
}

export interface QualifierFixture {
  readonly match: number;
  readonly date: string;
  readonly decision?: MatchDecision;
  readonly sides: readonly QualifierSideFixture[];
}

// ローンチと側の番号は、マッチの番号から側の位置ごとに決める
export function qualifierLaunchOf(match: number, position = 0): number {
  return match * 10 + position + 1;
}

export function qualifierDecidedAt(date: string): Date {
  return new Date(
    qualifierWindow(parseBusinessDate(date)).endsAt.getTime() +
      DECISION_DELAY_MS,
  );
}

function launchOutcomeOf(result: EntryResult | null): 'won' | 'lost' | null {
  if (result === null) {
    return null;
  }
  return result === 'lost' ? 'lost' : 'won';
}

export async function insertQualifiers(
  fixtures: readonly QualifierFixture[],
): Promise<void> {
  await insertLaunches(
    fixtures.flatMap((fixture) =>
      fixture.sides.map((side, position) => ({
        index: qualifierLaunchOf(fixture.match, position),
        productIndex: side.product,
        columns: {
          launchDate: fixture.date,
          outcome: launchOutcomeOf(side.result),
          decidedAt:
            side.result === null ? null : qualifierDecidedAt(fixture.date),
        },
      })),
    ),
  );
  await insertMatches(
    fixtures.map((fixture) => {
      const window = qualifierWindow(parseBusinessDate(fixture.date));
      const decided = fixture.sides.every((side) => side.result !== null);
      return {
        index: fixture.match,
        columns: {
          matchDate: fixture.date,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          startedAt: window.startsAt,
          decidedAt: decided ? qualifierDecidedAt(fixture.date) : null,
          decision: decided ? (fixture.decision ?? 'votes') : null,
        },
        entries: fixture.sides.map((side, position) => ({
          index: qualifierLaunchOf(fixture.match, position),
          launch: qualifierLaunchOf(fixture.match, position),
          product: side.product,
          owner: side.owner,
          columns: { upvoteCount: side.upvotes ?? 0, result: side.result },
        })),
      };
    }),
  );
}

// 1回の勝利を、相手の無い不戦勝ではなく勝敗の付いた2つの側のマッチとして作る
export function winOf(
  match: number,
  input: {
    readonly product: number;
    readonly owner: number;
    readonly date: string;
    readonly upvotes?: number;
    readonly opponent: number;
  },
): QualifierFixture {
  return {
    match,
    date: input.date,
    sides: [
      {
        product: input.product,
        owner: input.owner,
        result: 'won',
        upvotes: input.upvotes ?? 1,
      },
      { product: input.opponent, owner: input.owner, result: 'lost' },
    ],
  };
}

// 勝利したプロダクトの記録は外部キーでプロダクトを参照するため先に消す
export async function clearDirectoryTables(): Promise<void> {
  await db.delete(directoryEntries);
  await clearMatchTables();
}
