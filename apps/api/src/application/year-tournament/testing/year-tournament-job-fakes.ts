import type {
  EveningDispatchGate,
  EveningDispatchReadiness,
  EveningDispatchReadyInput,
} from '../../../../lib/core/notifications/evening-dispatch.ts';
import type { ScheduledJobContext } from '../../../../lib/core/scheduling/cron-registry.ts';
import {
  type BusinessDate,
  type BusinessTimeOfDay,
  fromBusinessDateTime,
  parseBusinessDate,
  toBusinessDateTime,
  toUtcCronExpression,
} from '../../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../../lib/core/time/clock.ts';
import type {
  YearCalendar,
  YearDrawService,
  YearEntryFollowUp,
  YearEntryRecord,
  YearEntryRegistrar,
  YearEntryStore,
  YearNotificationPublisher,
  YearProgressionService,
  YearTournamentRecord,
} from '../../../../lib/core/year-tournament/ports.ts';
import {
  defaultFinalDate,
  yearScheduleFor,
} from '../../../../lib/core/year-tournament/year-schedule.ts';
import type {
  YearTournamentIncident,
  YearTournamentIncidentReporter,
} from '../ports.ts';

export const JOB_DATE: BusinessDate = parseBusinessDate('2027-05-10');

export function scheduledAt(
  date: BusinessDate,
  time: BusinessTimeOfDay,
  extraMs = 0,
): Date {
  return new Date(fromBusinessDateTime(date, time).getTime() + extraMs);
}

export function jobContextOf(scheduledTime: Date): ScheduledJobContext {
  const business = toBusinessDateTime(scheduledTime);
  return {
    scheduledTime,
    cron: toUtcCronExpression(business),
    business,
  };
}

export const CLOCK_STEP_MS = 1000;

export interface SteppingClock extends Clock {
  readonly reads: Date[];
}

// 読むたびに1秒進み、ジョブがどの時点の時刻を各処理へ渡したかを確かめる
export function createSteppingClock(start: Date): SteppingClock {
  const reads: Date[] = [];
  return {
    reads,
    now() {
      const now = new Date(start.getTime() + reads.length * CLOCK_STEP_MS);
      reads.push(now);
      return now;
    },
  };
}

// 各偽物の呼び出しを1つの列に記録し、ジョブの中の順序を確かめる
export type CallLog = string[];

export type Failure = Error | undefined;

export function entryIdOf(index: number): string {
  return `01JF0YENTR${String(index).padStart(16, '0')}`;
}

const unused = (name: string) => (): never => {
  throw new Error(`ジョブは${name}を呼ばない`);
};

function settle<T>(value: T, failure: Failure): Promise<T> {
  return failure === undefined
    ? Promise.resolve(value)
    : Promise.reject(failure);
}

function upcomingRecordOf(year: number): YearTournamentRecord {
  return {
    yearTournamentId: `01JF0YTRNM${String(year).padStart(16, '0')}`,
    year,
    schedule: yearScheduleFor(year, defaultFinalDate(year)),
    source: 'default',
    version: 0,
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
  };
}

export interface FakeYearCalendar extends YearCalendar {
  readonly ensureNows: Date[];
  readonly openPeriodNows: Date[];
}

export function createFakeYearCalendar(
  log: CallLog,
  options: {
    readonly openPeriodStart?: Date | null;
    readonly ensureFailure?: Failure;
    readonly openPeriodFailure?: Failure;
  } = {},
): FakeYearCalendar {
  const ensureNows: Date[] = [];
  const openPeriodNows: Date[] = [];
  return {
    ensureNows,
    openPeriodNows,
    ensureUpcoming(now) {
      log.push('ensureUpcoming');
      ensureNows.push(now);
      return settle(upcomingRecordOf(2027), options.ensureFailure);
    },
    openPeriodStart(now) {
      log.push('openPeriodStart');
      openPeriodNows.push(now);
      return settle(options.openPeriodStart ?? null, options.openPeriodFailure);
    },
    describe: unused('describe'),
    resolveAward: unused('resolveAward'),
    upcoming: unused('upcoming'),
  };
}

type SyncResult = Awaited<ReturnType<YearEntryRegistrar['syncChampions']>>;

export interface FakeYearEntryRegistrar extends YearEntryRegistrar {
  readonly inputs: { readonly awardedFrom: Date | null; readonly now: Date }[];
}

export function createFakeYearEntryRegistrar(
  log: CallLog,
  result: SyncResult = { created: [], late: [], skipped: 0 },
  failure?: Failure,
): FakeYearEntryRegistrar {
  const inputs: FakeYearEntryRegistrar['inputs'] = [];
  return {
    inputs,
    syncChampions(input) {
      log.push('syncChampions');
      inputs.push(input);
      return settle(result, failure);
    },
  };
}

export interface FakeYearDrawService extends YearDrawService {
  readonly nows: Date[];
}

export function createFakeYearDrawService(
  log: CallLog,
  result: Awaited<ReturnType<YearDrawService['drawDue']>> = {
    drawn: [],
    failed: [],
  },
  failure?: Failure,
): FakeYearDrawService {
  const nows: Date[] = [];
  return {
    nows,
    drawDue(now) {
      log.push('drawDue');
      nows.push(now);
      return settle(result, failure);
    },
  };
}

export interface FakeYearProgressionService extends YearProgressionService {
  readonly nows: Date[];
}

export function createFakeYearProgressionService(
  log: CallLog,
  result: Awaited<ReturnType<YearProgressionService['advanceAll']>> = {
    advanced: 0,
    failed: [],
  },
  failure?: Failure,
): FakeYearProgressionService {
  const nows: Date[] = [];
  return {
    nows,
    advanceAll(now) {
      log.push('advanceAll');
      nows.push(now);
      return settle(result, failure);
    },
    advance: unused('advance'),
    applyResult: unused('applyResult'),
  };
}

export interface FakeYearNotificationPublisher extends YearNotificationPublisher {
  readonly evenings: { readonly date: BusinessDate; readonly at: Date }[];
}

export function createFakeYearNotificationPublisher(
  log: CallLog,
  failure?: Failure,
): FakeYearNotificationPublisher {
  const evenings: FakeYearNotificationPublisher['evenings'] = [];
  return {
    evenings,
    publishEvening(input) {
      log.push('publishEvening');
      evenings.push(input);
      return settle(undefined, failure);
    },
    publishRound: unused('publishRound'),
    publishAward: unused('publishAward'),
  };
}

export interface FakeEveningDispatchGate extends EveningDispatchGate {
  readonly inputs: EveningDispatchReadyInput[];
}

export function createFakeEveningDispatchGate(
  log: CallLog,
  readiness: EveningDispatchReadiness = { kind: 'dispatch-requested' },
  failure?: Failure,
): FakeEveningDispatchGate {
  const inputs: EveningDispatchReadyInput[] = [];
  return {
    inputs,
    markReady(input) {
      log.push('markReady');
      inputs.push(input);
      return settle(readiness, failure);
    },
  };
}

export interface LoggingIncidentReporter extends YearTournamentIncidentReporter {
  readonly incidents: YearTournamentIncident[];
}

export function createLoggingIncidentReporter(
  log: CallLog,
): LoggingIncidentReporter {
  const incidents: YearTournamentIncident[] = [];
  return {
    incidents,
    report(incident) {
      log.push(`report:${incident.kind}`);
      incidents.push(incident);
    },
  };
}

export function pendingEntryOf(
  index: number,
  classifiedYear: number | null,
): YearEntryRecord {
  return {
    entryId: entryIdOf(index),
    weekTournamentId: `01JF0WTRNM${String(index).padStart(16, '0')}`,
    weekPeriod: '2027-W10',
    launchId: null,
    productId: null,
    ownerUserId: null,
    launchDate: parseBusinessDate('2027-03-01'),
    qualifierUpvoteCount: 0,
    qualifierLastUpvoteElapsedMs: null,
    awardedAt: scheduledAt(parseBusinessDate('2027-03-07'), {
      hour: 23,
      minute: 40,
    }),
    awardedDate: parseBusinessDate('2027-03-07'),
    status: classifiedYear === null ? 'forfeited' : 'excluded',
    entitlementSource: null,
    purchaseId: null,
    closeReason: classifiedYear === null ? 'deleted' : 'over_capacity',
    classifiedYear,
    refundStatus: 'pending',
    refundNoticeStatus: 'none',
  };
}

export interface FakeFollowUpEntryStore extends YearEntryStore {
  readonly pendingReads: {
    readonly olderThan: Date;
    readonly limit: number;
  }[];
}

export function createFakeFollowUpEntryStore(
  log: CallLog,
  pending: readonly YearEntryRecord[] = [],
  failure?: Failure,
): FakeFollowUpEntryStore {
  const pendingReads: FakeFollowUpEntryStore['pendingReads'] = [];
  return {
    pendingReads,
    listPendingFollowUps(olderThan, limit) {
      log.push('listPendingFollowUps');
      pendingReads.push({ olderThan, limit });
      return settle(pending, failure);
    },
    insertFromChampion: unused('insertFromChampion'),
    findByWeekTournaments: unused('findByWeekTournaments'),
    findByLaunches: unused('findByLaunches'),
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
    markRefundRequested: unused('markRefundRequested'),
    markRefundClosed: unused('markRefundClosed'),
    markNotice: unused('markNotice'),
    unlinkOrDeleteByProduct: unused('unlinkOrDeleteByProduct'),
  };
}

export interface FakeYearEntryFollowUp extends YearEntryFollowUp {
  readonly processed: {
    readonly entryIds: readonly string[];
    readonly now: Date;
  }[];
}

export function createFakeYearEntryFollowUp(
  log: CallLog,
  failure?: Failure,
): FakeYearEntryFollowUp {
  const processed: FakeYearEntryFollowUp['processed'] = [];
  return {
    processed,
    process(entryIds, now) {
      log.push('process');
      processed.push({ entryIds, now });
      return settle(undefined, failure);
    },
    processYear: unused('processYear'),
  };
}
