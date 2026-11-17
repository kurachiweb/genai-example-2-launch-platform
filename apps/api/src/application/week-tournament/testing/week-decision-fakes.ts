import { weekStartOf } from '../../../../common-lib/tournament/week-period.ts';
import type { QualifierOutcome } from '../../../../lib/core/product/launch-status.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../../lib/core/time/business-time.ts';
import type {
  BracketKind,
  BracketStore,
} from '../../../../lib/core/tournament/ports.ts';
import type {
  WeekEntryRecord,
  WeekTournamentRecord,
  WeekTournamentStore,
} from '../../../../lib/core/week-tournament/ports.ts';
import type { WeekEntryStatus } from '../../../../lib/core/week-tournament/week-entry-rules.ts';
import { entryWindowFor } from '../../../../lib/core/week-tournament/week-schedule.ts';
import type { DecisionSubject } from '../../product/decision-sources.ts';

// 水曜日のローンチ。週の初日は2027-03-01、決済期限は翌週月曜日23:35(業務時刻)
export const LAUNCH_DATE: BusinessDate = parseBusinessDate('2027-03-03');

export const WEEK_START: BusinessDate = parseBusinessDate(
  weekStartOf(LAUNCH_DATE),
);

export const RULE_WINDOW = entryWindowFor(WEEK_START);

// 保存した期限が規則から求め直した値と区別できるよう、1時間ずらした行を使う
export const STORED_DEADLINE_AT = new Date(
  RULE_WINDOW.deadlineAt.getTime() + 3_600_000,
);

export const BEFORE_DEADLINE = new Date(STORED_DEADLINE_AT.getTime() - 1);

export const WON_AT = new Date('2027-03-04T07:40:00.000Z');

const OWNER_USER_ID = '01JF0WACCT0000000000000001';

export function productIdOf(index: number): string {
  return `01JF0WPRDT${String(index).padStart(16, '0')}`;
}

export function launchIdOf(index: number): string {
  return `01JF0WRNCH${String(index).padStart(16, '0')}`;
}

export function entryIdOf(index: number): string {
  return `01JF0WENTR${String(index).padStart(16, '0')}`;
}

export const TOURNAMENT_ID = '01JF0WTRNM0000000000000001';

export function subjectOf(
  index: number,
  outcome: QualifierOutcome | null = 'won',
  launchDate: BusinessDate = LAUNCH_DATE,
): DecisionSubject {
  return {
    productId: productIdOf(index),
    ownerUserId: OWNER_USER_ID,
    latestLaunch: {
      launchId: launchIdOf(index),
      launchDate,
      status: 'finished',
      outcome,
    },
  };
}

export function entryOf(
  index: number,
  status: WeekEntryStatus,
  overrides: Partial<WeekEntryRecord> = {},
): WeekEntryRecord {
  return {
    entryId: entryIdOf(index),
    tournamentId: TOURNAMENT_ID,
    launchId: launchIdOf(index),
    productId: productIdOf(index),
    ownerUserId: OWNER_USER_ID,
    launchDate: LAUNCH_DATE,
    qualifierUpvoteCount: 10,
    qualifierLastUpvoteElapsedMs: 3_600_000,
    wonAt: WON_AT,
    status,
    entitlementSource: status === 'entitled' ? 'payment' : null,
    purchaseId: null,
    closeReason: null,
    refundStatus: 'none',
    refundNoticeStatus: 'none',
    ...overrides,
  };
}

export function tournamentOf(
  overrides: Partial<WeekTournamentRecord> = {},
): WeekTournamentRecord {
  return {
    tournamentId: TOURNAMENT_ID,
    window: { ...RULE_WINDOW, deadlineAt: STORED_DEADLINE_AT },
    status: 'open',
    drawStartedAt: null,
    bracketId: null,
    outcome: null,
    championEntryId: null,
    awardedAt: null,
    ...overrides,
  };
}

export interface WeekDecisionScenario {
  readonly entries?: readonly WeekEntryRecord[];
  readonly tournaments?: readonly WeekTournamentRecord[];
  readonly aliveRefs?: readonly string[];
}

export interface WeekDecisionReads {
  readonly entryReads: (readonly string[])[];
  readonly weekReads: (readonly BusinessDate[])[];
  readonly aliveReads: {
    readonly kind: BracketKind;
    readonly refs: readonly string[];
  }[];
}

const unused = (name: string) => (): never => {
  throw new Error(`供給元は${name}を呼ばない`);
};

// 供給元が読む3つの一括の読み取りだけを応答し、渡された値を記録する
export function createWeekDecisionFakes(scenario: WeekDecisionScenario = {}): {
  readonly store: WeekTournamentStore;
  readonly brackets: BracketStore;
  readonly reads: WeekDecisionReads;
} {
  const reads: WeekDecisionReads = {
    entryReads: [],
    weekReads: [],
    aliveReads: [],
  };
  const store: WeekTournamentStore = {
    findEntriesByLaunch(launchIds) {
      reads.entryReads.push(launchIds);
      return Promise.resolve(
        new Map(
          (scenario.entries ?? []).flatMap((entry) =>
            entry.launchId !== null && launchIds.includes(entry.launchId)
              ? [[entry.launchId, entry]]
              : [],
          ),
        ),
      );
    },
    findTournamentsByWeeks(weekStarts) {
      reads.weekReads.push(weekStarts);
      return Promise.resolve(
        new Map(
          (scenario.tournaments ?? []).flatMap((tournament) =>
            weekStarts.includes(tournament.window.weekStart)
              ? [[tournament.window.weekStart, tournament]]
              : [],
          ),
        ),
      );
    },
    ensureTournament: unused('ensureTournament'),
    findTournament: unused('findTournament'),
    findTournamentByWeek: unused('findTournamentByWeek'),
    listDue: unused('listDue'),
    listInProgress: unused('listInProgress'),
    findEntry: unused('findEntry'),
    listLaunchIdsByProduct: unused('listLaunchIdsByProduct'),
    listEntriesForClassification: unused('listEntriesForClassification'),
    listDrawnEntries: unused('listDrawnEntries'),
    insertEntry: unused('insertEntry'),
    grantByUltras: unused('grantByUltras'),
    forfeitByProduct: unused('forfeitByProduct'),
    forfeitByOwner: unused('forfeitByOwner'),
    freeze: unused('freeze'),
    classify: unused('classify'),
    markDrawn: unused('markDrawn'),
    recordFinish: unused('recordFinish'),
    listAwardedBetween: unused('listAwardedBetween'),
    listPendingFollowUps: unused('listPendingFollowUps'),
    listPendingFollowUpsOf: unused('listPendingFollowUpsOf'),
    markRefundRequested: unused('markRefundRequested'),
    markRefundClosed: unused('markRefundClosed'),
    markNotice: unused('markNotice'),
    unlinkOrDeleteByProduct: unused('unlinkOrDeleteByProduct'),
  };
  const brackets: BracketStore = {
    findAliveRefs(kind, refs) {
      reads.aliveReads.push({ kind, refs });
      return Promise.resolve(
        new Set((scenario.aliveRefs ?? []).filter((ref) => refs.includes(ref))),
      );
    },
    findByTournament: unused('findByTournament'),
    findById: unused('findById'),
    findByMatchIds: unused('findByMatchIds'),
    findParticipantStandings: unused('findParticipantStandings'),
    unlinkProduct: unused('unlinkProduct'),
  };
  return { store, brackets, reads };
}
