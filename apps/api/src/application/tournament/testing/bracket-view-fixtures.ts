import type { EntryResult } from '../../../../lib/core/match/match-model.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../../lib/core/time/business-time.ts';
import { bracketShape } from '../../../../lib/core/tournament/bracket-shape.ts';
import type {
  BracketKind,
  BracketMatchRecord,
  BracketRecord,
} from '../../../../lib/core/tournament/ports.ts';
import type {
  MatchProductView,
  MatchView,
} from '../../match/match-view-reader.ts';
import { matchRecordOf } from '../../match/testing/view-fakes.ts';
import type { BracketSlotView } from '../bracket-view-builder.ts';

export const date = (value: string): BusinessDate => parseBusinessDate(value);

export const noonOf = (value: BusinessDate): Date =>
  fromBusinessDateTime(value, { hour: 12, minute: 0 });

export const FIRST_ROUND_DATE = date('2027-03-09');

const pad = (value: number): string => String(value).padStart(15, '0');

const refOf = (participantNo: number): string =>
  `01JF0BRKREF${pad(participantNo)}`;

export const matchIdOf = (round: number, position: number): string =>
  `01JF0BRKMCH${pad(round * 100 + position)}`;

export function productOf(participantNo: number): MatchProductView {
  return {
    productId: `01JF0BRKPRD${pad(participantNo)}`,
    handle: `product-${String(participantNo)}`,
    name: `プロダクト${String(participantNo)}`,
    tagline: `プロダクト${String(participantNo)}の紹介`,
    categoryId: '01JF0BRKCAT000000000000001',
    websiteUrl: `https://product-${String(participantNo)}.example`,
    logoFileId: `01JF0BRKL0G${pad(participantNo)}`,
    listed: true,
  };
}

export interface MatchFixture {
  readonly round: number;
  readonly position: number;
  readonly participantNos: readonly [number] | readonly [number, number];
  readonly matchDate?: BusinessDate;
  readonly status?: BracketMatchRecord['status'];
  readonly winnerNo?: number | null;
}

function bracketMatchOf(fixture: MatchFixture): BracketMatchRecord {
  return {
    matchId: matchIdOf(fixture.round, fixture.position),
    round: fixture.round,
    position: fixture.position,
    matchDate: fixture.matchDate ?? FIRST_ROUND_DATE,
    participantNos: fixture.participantNos,
    status: fixture.status ?? 'scheduled',
    winnerNo: fixture.winnerNo ?? null,
  };
}

export interface RecordFixture {
  readonly participantCount: number;
  readonly kind?: BracketKind;
  readonly firstRoundDate?: BusinessDate | null;
  readonly status?: BracketRecord['status'];
  readonly outcome?: BracketRecord['outcome'];
  readonly championNo?: number;
  readonly matches?: readonly MatchFixture[];
}

export function recordOf(fixture: RecordFixture): BracketRecord {
  return {
    bracketId: '01JF0BRKBRK000000000000001',
    kind: fixture.kind ?? 'week',
    tournamentId: '01JF0BRKTRN000000000000001',
    shape: bracketShape(fixture.participantCount),
    firstRoundDate:
      fixture.firstRoundDate === undefined
        ? FIRST_ROUND_DATE
        : fixture.firstRoundDate,
    status: fixture.status ?? 'active',
    outcome: fixture.outcome ?? null,
    championRef:
      fixture.championNo === undefined ? null : refOf(fixture.championNo),
    participants: Array.from(
      { length: fixture.participantCount },
      (_, index) => ({
        participantNo: index + 1,
        ref: refOf(index + 1),
        productId: productOf(index + 1).productId,
        launchId: `01JF0BRKLCH${pad(index + 1)}`,
        ownerUserId: `01JF0BRKUSR${pad(index + 1)}`,
        eliminatedRound: null,
      }),
    ),
    matches: (fixture.matches ?? []).map(bracketMatchOf),
  };
}

export interface SideFixture {
  readonly upvoteCount: number;
  readonly result?: EntryResult | null;
  readonly hidden?: boolean;
}

function matchViewOf(
  match: BracketMatchRecord,
  sides: readonly SideFixture[],
): MatchView {
  const record = matchRecordOf(1, {
    kind: 'week',
    round: match.round,
    matchDate: match.matchDate,
    entries: sides.map(({ upvoteCount, result }) => ({
      upvoteCount,
      result: result ?? null,
    })),
  });
  return {
    record: { ...record, matchId: match.matchId },
    entries: sides.map((side, index) => {
      const participantNo = match.participantNos[index] ?? 0;
      return {
        entryId: `${match.matchId}-${String(index + 1)}`,
        product: side.hidden === true ? null : productOf(participantNo),
        isViewerOwn: false,
        upvoteCount: side.upvoteCount,
        result: side.result ?? null,
        colorIndex: index,
      };
    }),
    viewerUpvotedEntryId: null,
    viewerRestriction: null,
  };
}

// 側を返さないマッチは表示を作らない(予定を作る前の位置)
export function viewsOf(
  record: BracketRecord,
  sidesOf: (match: BracketMatchRecord) => readonly SideFixture[] | undefined,
): ReadonlyMap<string, MatchView> {
  return new Map(
    record.matches.flatMap((match) => {
      const sides = sidesOf(match);
      return sides === undefined
        ? []
        : [[match.matchId, matchViewOf(match, sides)] as const];
    }),
  );
}

export const EMPTY_SLOT: BracketSlotView = {
  participantNo: null,
  seed: null,
  feedLabel: null,
  product: null,
  upvoteCount: null,
  result: null,
};

export const seedSlot = (participantNo: number): BracketSlotView => ({
  ...EMPTY_SLOT,
  participantNo,
  seed: participantNo,
  feedLabel: `シード${String(participantNo)}`,
});

export const pendingSlot = (feedLabel: string): BracketSlotView => ({
  ...EMPTY_SLOT,
  feedLabel,
});

// 13人のブラケットはシード3・1回戦5試合で、準々決勝の位置1〜4にシード1・2・3が入る
export const N13_FIRST_ROUND: readonly MatchFixture[] = [
  { round: 1, position: 1, participantNos: [4, 5] },
  { round: 1, position: 2, participantNos: [6, 7] },
  { round: 1, position: 3, participantNos: [8, 9] },
  { round: 1, position: 4, participantNos: [10, 11] },
  { round: 1, position: 5, participantNos: [12, 13] },
];

// 位置ごとの勝者(nullは勝者なし)を渡したマッチを確定にする
export const decided = (
  fixtures: readonly MatchFixture[],
  winners: ReadonlyMap<number, number | null>,
): readonly MatchFixture[] =>
  fixtures.map((fixture) => {
    const winnerNo = winners.get(fixture.position);
    return winnerNo === undefined
      ? fixture
      : { ...fixture, status: 'decided', winnerNo };
  });
