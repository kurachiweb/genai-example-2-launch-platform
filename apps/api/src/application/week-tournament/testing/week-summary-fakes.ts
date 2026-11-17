import {
  deriveMatchPhase,
  type EntryResult,
  matchWindow,
} from '../../../../lib/core/match/match-model.ts';
import type {
  MatchDirectory,
  MatchRecord,
} from '../../../../lib/core/match/ports.ts';
import type { BusinessDate } from '../../../../lib/core/time/business-time.ts';
import { bracketShape } from '../../../../lib/core/tournament/bracket-shape.ts';
import type {
  BracketKind,
  BracketParticipantStanding,
  BracketStore,
} from '../../../../lib/core/tournament/ports.ts';
import type { WeekTournamentStore } from '../../../../lib/core/week-tournament/ports.ts';
import {
  createWeekDecisionFakes,
  launchIdOf,
  type WeekDecisionReads,
  type WeekDecisionScenario,
} from './week-decision-fakes.ts';

export const BRACKET_ID = '01JF0WBRKT0000000000000001';

const OPPONENT_LAUNCH_ID = '01JF0WRNCH9999999999999999';

export function weekMatchIdOf(index: number): string {
  return `01JF0WMTCH${String(index).padStart(16, '0')}`;
}

export function standingOf(
  participantCount: number,
  overrides: Partial<BracketParticipantStanding> = {},
): BracketParticipantStanding {
  return {
    bracketId: BRACKET_ID,
    shape: bracketShape(participantCount),
    status: 'active',
    participantNo: participantCount,
    eliminatedRound: null,
    champion: false,
    ...overrides,
  };
}

export interface WeekMatchFixture {
  readonly index: number;
  readonly launch: number;
  readonly round: number;
  readonly date: BusinessDate;
  // 照会の時点。マッチの状態はこの時点から導く
  readonly now: Date;
  readonly started?: boolean;
  // 確定したマッチの、ローンチの側の結果
  readonly result?: EntryResult;
}

export function weekMatchOf(fixture: WeekMatchFixture): MatchRecord {
  const window = matchWindow(fixture.date);
  const decided = fixture.result !== undefined;
  const times = {
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    startedAt: decided || fixture.started === true ? window.startsAt : null,
    decidedAt: decided ? window.endsAt : null,
  };
  const opponentResult: EntryResult | null =
    fixture.result === undefined
      ? null
      : fixture.result === 'lost'
        ? 'won'
        : 'lost';
  const side = (
    slot: 1 | 2,
    launchId: string,
    result: EntryResult | null,
  ): MatchRecord['entries'][number] => ({
    entryId: `01JF0WMENT${String(fixture.index * 10 + slot).padStart(16, '0')}`,
    slot,
    launchId,
    productId: null,
    ownerUserId: null,
    upvoteCount: 0,
    lastUpvotedAt: null,
    lastUpvoteElapsedMs: null,
    forfeited: false,
    result,
  });
  return {
    matchId: weekMatchIdOf(fixture.index),
    kind: 'week',
    round: fixture.round,
    stage: null,
    matchDate: fixture.date,
    decision: decided ? 'votes' : null,
    endedEarly: false,
    ...times,
    phase: deriveMatchPhase(times, fixture.now),
    entries: [
      side(1, launchIdOf(fixture.launch), fixture.result ?? null),
      side(2, OPPONENT_LAUNCH_ID, opponentResult),
    ],
  };
}

export interface WeekSummaryScenario extends WeekDecisionScenario {
  // 枠のIDごとのブラケットの参加者の状態
  readonly standings?: ReadonlyMap<string, BracketParticipantStanding>;
  // ローンチごとのマッチ(実施日の新しい順)
  readonly matches?: ReadonlyMap<string, readonly MatchRecord[]>;
}

export interface WeekSummaryReads extends WeekDecisionReads {
  readonly standingReads: {
    readonly kind: BracketKind;
    readonly refs: readonly string[];
  }[];
  readonly matchReads: {
    readonly launchIds: readonly string[];
    readonly now: Date;
  }[];
}

const unused = (name: string) => (): never => {
  throw new Error(`供給元は${name}を呼ばない`);
};

// 判定の供給元の偽物に、ブラケットの参加者の状態とローンチのマッチの一括の読み取りを加える
export function createWeekSummaryFakes(scenario: WeekSummaryScenario = {}): {
  readonly store: WeekTournamentStore;
  readonly brackets: BracketStore;
  readonly matches: MatchDirectory;
  readonly reads: WeekSummaryReads;
} {
  const decision = createWeekDecisionFakes(scenario);
  const reads: WeekSummaryReads = {
    ...decision.reads,
    standingReads: [],
    matchReads: [],
  };
  const brackets: BracketStore = {
    ...decision.brackets,
    findAliveRefs: unused('findAliveRefs'),
    findParticipantStandings(kind, refs) {
      reads.standingReads.push({ kind, refs });
      return Promise.resolve(
        new Map(
          [...(scenario.standings ?? [])].filter(([ref]) => refs.includes(ref)),
        ),
      );
    },
  };
  const matches: MatchDirectory = {
    listByLaunches(launchIds, now) {
      reads.matchReads.push({ launchIds, now });
      return Promise.resolve(
        new Map(
          [...(scenario.matches ?? [])].filter(([launchId]) =>
            launchIds.includes(launchId),
          ),
        ),
      );
    },
    findMatches: unused('findMatches'),
    listForDate: unused('listForDate'),
    findQualifierResults: unused('findQualifierResults'),
    summarizeDaily: unused('summarizeDaily'),
  };
  return { store: decision.store, brackets, matches, reads };
}
