import type { QualifierOutcome } from '../../../../lib/core/product/launch-status.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../../lib/core/time/business-time.ts';
import type {
  BracketKind,
  BracketStore,
} from '../../../../lib/core/tournament/ports.ts';
import type {
  WeekChampion,
  WeekChampionDirectory,
} from '../../../../lib/core/week-tournament/ports.ts';
import type {
  YearCalendar,
  YearCalendarEntry,
  YearEntryRecord,
  YearEntryStore,
  YearTournamentRecord,
} from '../../../../lib/core/year-tournament/ports.ts';
import type { YearEntryStatus } from '../../../../lib/core/year-tournament/year-entry-rules.ts';
import {
  defaultFinalDate,
  type YearSchedule,
  yearScheduleFor,
} from '../../../../lib/core/year-tournament/year-schedule.ts';
import type { DecisionSubject } from '../../product/decision-sources.ts';

export const YEAR = 2027;

// 既定の決勝日は2027-05-30、決済期限日は2027-05-24
export const DEFAULT_SCHEDULE: YearSchedule = yearScheduleFor(
  YEAR,
  defaultFinalDate(YEAR),
);

// 保存した期限が既定の日から求めた値と区別できるよう、決勝日を2週後にした行を使う
export const STORED_SCHEDULE: YearSchedule = yearScheduleFor(
  YEAR,
  parseBusinessDate('2027-06-13'),
);

export const BEFORE_DEADLINE = new Date(
  STORED_SCHEDULE.deadlineAt.getTime() - 1,
);

export const AFTER_DRAW = new Date(
  STORED_SCHEDULE.drawAt.getTime() + 86_400_000,
);

// 前年(2026)の決済期限日より後のWeek優勝は2027年を対象にする
export const AWARDED_DATE: BusinessDate = parseBusinessDate('2026-09-13');

export const AWARDED_AT = fromBusinessDateTime(AWARDED_DATE, {
  hour: 22,
  minute: 0,
});

export const OPEN_PERIOD_START = fromBusinessDateTime(
  parseBusinessDate('2026-05-25'),
  { hour: 0, minute: 0 },
);

const OWNER_USER_ID = '01JF0YACCT0000000000000001';

export function productIdOf(index: number): string {
  return `01JF0YPRDT${String(index).padStart(16, '0')}`;
}

export function launchIdOf(index: number): string {
  return `01JF0YRNCH${String(index).padStart(16, '0')}`;
}

export function entryIdOf(index: number): string {
  return `01JF0YENTR${String(index).padStart(16, '0')}`;
}

function weekTournamentIdOf(index: number): string {
  return `01JF0YWEEK${String(index).padStart(16, '0')}`;
}

export const YEAR_TOURNAMENT_ID = '01JF0YTRNM0000000000000001';

export function subjectOf(
  index: number,
  outcome: QualifierOutcome | null = 'won',
): DecisionSubject {
  return {
    productId: productIdOf(index),
    ownerUserId: OWNER_USER_ID,
    latestLaunch: {
      launchId: launchIdOf(index),
      launchDate: parseBusinessDate('2026-09-09'),
      status: 'finished',
      outcome,
    },
  };
}

export function entryOf(
  index: number,
  status: YearEntryStatus,
  overrides: Partial<YearEntryRecord> = {},
): YearEntryRecord {
  return {
    entryId: entryIdOf(index),
    weekTournamentId: weekTournamentIdOf(index),
    weekPeriod: '2026-W37',
    launchId: launchIdOf(index),
    productId: productIdOf(index),
    ownerUserId: OWNER_USER_ID,
    launchDate: parseBusinessDate('2026-09-09'),
    qualifierUpvoteCount: 10,
    qualifierLastUpvoteElapsedMs: 3_600_000,
    awardedAt: AWARDED_AT,
    awardedDate: AWARDED_DATE,
    status,
    entitlementSource: status === 'entitled' ? 'payment' : null,
    purchaseId: null,
    closeReason: null,
    classifiedYear:
      status === 'awaiting_payment' || status === 'entitled' ? null : YEAR,
    refundStatus: 'none',
    refundNoticeStatus: 'none',
    ...overrides,
  };
}

export function yearRowOf(
  overrides: Partial<YearTournamentRecord> = {},
): YearTournamentRecord {
  return {
    yearTournamentId: YEAR_TOURNAMENT_ID,
    year: YEAR,
    schedule: STORED_SCHEDULE,
    source: 'explicit',
    version: 1,
    updatedAt: null,
    updatedByAdminId: null,
    status: 'open',
    drawStartedAt: null,
    bracketId: null,
    firstRoundDate: null,
    participantCount: null,
    outcome: null,
    championEntryId: null,
    awardedAt: null,
    ...overrides,
  };
}

export const DRAWING_YEAR_ROW = yearRowOf({
  status: 'drawing',
  drawStartedAt: STORED_SCHEDULE.drawAt,
});

export function championOf(
  index: number,
  awardedAt: Date = AWARDED_AT,
): WeekChampion {
  return {
    tournamentId: weekTournamentIdOf(index),
    weekStart: parseBusinessDate('2026-09-07'),
    productId: productIdOf(index),
    launchId: launchIdOf(index),
    ownerUserId: OWNER_USER_ID,
    awardedAt,
  };
}

export interface YearDecisionScenario {
  readonly entries?: readonly YearEntryRecord[];
  readonly years?: readonly YearTournamentRecord[];
  readonly aliveRefs?: readonly string[];
  readonly champions?: readonly WeekChampion[];
  readonly openPeriodStart?: Date | null;
}

export interface YearDecisionReads {
  readonly entryReads: (readonly string[])[];
  readonly aliveReads: {
    readonly kind: BracketKind;
    readonly refs: readonly string[];
  }[];
  readonly calendarReads: {
    readonly years: readonly number[];
    readonly now: Date;
  }[];
  readonly openPeriodReads: Date[];
  readonly championReads: {
    readonly awardedFrom: Date | null;
    readonly awardedBefore: Date;
  }[];
}

const unused = (name: string) => (): never => {
  throw new Error(`供給元は${name}を呼ばない`);
};

// 行の無い年は既定の日から求め、組み合わせ決定の時刻を過ぎていれば開催しなかった年とする(YearCalendarの契約)
function calendarEntryOf(
  rows: readonly YearTournamentRecord[],
  year: number,
  now: Date,
): YearCalendarEntry {
  const record = rows.find((row) => row.year === year);
  if (record !== undefined) {
    return {
      year,
      schedule: record.schedule,
      source: record.source,
      state: record.drawStartedAt === null ? 'open' : 'frozen',
      record,
    };
  }
  const schedule = yearScheduleFor(year, defaultFinalDate(year));
  return {
    year,
    schedule,
    source: 'default',
    state: schedule.drawAt.getTime() > now.getTime() ? 'planned' : 'not_held',
    record: null,
  };
}

function createEntryStore(
  scenario: YearDecisionScenario,
  reads: YearDecisionReads,
): YearEntryStore {
  return {
    findByLaunches(launchIds) {
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
    insertFromChampion: unused('insertFromChampion'),
    findByWeekTournaments: unused('findByWeekTournaments'),
    findEntry: unused('findEntry'),
    listOpenByOwner: unused('listOpenByOwner'),
    listLaunchIdsByProduct: unused('listLaunchIdsByProduct'),
    listCandidates: unused('listCandidates'),
    listDrawn: unused('listDrawn'),
    grantByUltras: unused('grantByUltras'),
    forfeitByProduct: unused('forfeitByProduct'),
    forfeitByOwner: unused('forfeitByOwner'),
    classify: unused('classify'),
    excludeOverCapacity: unused('excludeOverCapacity'),
    listPendingFollowUps: unused('listPendingFollowUps'),
    markRefundRequested: unused('markRefundRequested'),
    markRefundClosed: unused('markRefundClosed'),
    markNotice: unused('markNotice'),
    unlinkOrDeleteByProduct: unused('unlinkOrDeleteByProduct'),
  };
}

function createCalendar(
  scenario: YearDecisionScenario,
  reads: YearDecisionReads,
): YearCalendar {
  return {
    describe(years, now) {
      reads.calendarReads.push({ years, now });
      return Promise.resolve(
        new Map(
          [...new Set(years)].map((year) => [
            year,
            calendarEntryOf(scenario.years ?? [], year, now),
          ]),
        ),
      );
    },
    openPeriodStart(now) {
      reads.openPeriodReads.push(now);
      return Promise.resolve(scenario.openPeriodStart ?? null);
    },
    resolveAward: unused('resolveAward'),
    upcoming: unused('upcoming'),
    ensureUpcoming: unused('ensureUpcoming'),
  };
}

// 供給元が読む一括の読み取りだけを応答し、渡された値を記録する
export function createYearDecisionFakes(scenario: YearDecisionScenario = {}): {
  readonly entries: YearEntryStore;
  readonly brackets: BracketStore;
  readonly calendar: YearCalendar;
  readonly champions: WeekChampionDirectory;
  readonly reads: YearDecisionReads;
} {
  const reads: YearDecisionReads = {
    entryReads: [],
    aliveReads: [],
    calendarReads: [],
    openPeriodReads: [],
    championReads: [],
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
  const champions: WeekChampionDirectory = {
    listChampions(input) {
      reads.championReads.push(input);
      return Promise.resolve(
        (scenario.champions ?? []).filter(
          ({ awardedAt }) =>
            (input.awardedFrom === null ||
              awardedAt.getTime() >= input.awardedFrom.getTime()) &&
            awardedAt.getTime() < input.awardedBefore.getTime(),
        ),
      );
    },
  };
  return {
    entries: createEntryStore(scenario, reads),
    brackets,
    calendar: createCalendar(scenario, reads),
    champions,
    reads,
  };
}

export const NO_READS: YearDecisionReads = Object.freeze({
  entryReads: [],
  aliveReads: [],
  calendarReads: [],
  openPeriodReads: [],
  championReads: [],
});
