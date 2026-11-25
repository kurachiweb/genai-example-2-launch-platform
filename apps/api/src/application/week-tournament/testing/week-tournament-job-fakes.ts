import type { MatchKind } from '../../../../lib/core/match/match-model.ts';
import type {
  MatchDirectory,
  MatchRecord,
} from '../../../../lib/core/match/ports.ts';
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
  WeekDrawService,
  WeekEntryFollowUp,
  WeekEntryRecord,
  WeekEntryRegistrar,
  WeekNotificationPublisher,
  WeekProgressionService,
  WeekTournamentStore,
} from '../../../../lib/core/week-tournament/ports.ts';
import type {
  WeekTournamentIncident,
  WeekTournamentIncidentReporter,
} from '../ports.ts';

export const JOB_DATE: BusinessDate = parseBusinessDate('2027-03-01');

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

export function matchIdOf(index: number): string {
  return `01JF0WMTCH${String(index).padStart(16, '0')}`;
}

export function tournamentIdOf(index: number): string {
  return `01JF0WTRNM${String(index).padStart(16, '0')}`;
}

export function entryIdOf(index: number): string {
  return `01JF0WENTR${String(index).padStart(16, '0')}`;
}

// 側の中身はジョブが読まないため、確定の有無だけを変えた予選を作る
export function qualifierOf(
  index: number,
  decidedAt: Date | null,
): MatchRecord {
  return {
    matchId: matchIdOf(index),
    kind: 'qualifier',
    round: null,
    stage: null,
    matchDate: JOB_DATE,
    decision: decidedAt === null ? null : 'votes',
    endedEarly: false,
    startsAt: scheduledAt(JOB_DATE, { hour: 0, minute: 0 }),
    endsAt: scheduledAt(JOB_DATE, { hour: 23, minute: 40 }),
    startedAt: scheduledAt(JOB_DATE, { hour: 0, minute: 0 }),
    decidedAt,
    phase: decidedAt === null ? 'tallying' : 'finished',
    entries: [],
  };
}

export function entryRecordOf(
  index: number,
  tournamentId: string,
): WeekEntryRecord {
  return {
    entryId: entryIdOf(index),
    tournamentId,
    launchId: null,
    productId: null,
    ownerUserId: null,
    launchDate: JOB_DATE,
    qualifierUpvoteCount: 0,
    qualifierLastUpvoteElapsedMs: null,
    wonAt: scheduledAt(JOB_DATE, { hour: 23, minute: 40 }),
    status: 'forfeited',
    entitlementSource: null,
    purchaseId: null,
    closeReason: 'deleted',
    refundStatus: 'pending',
    refundNoticeStatus: 'none',
  };
}

const unused = (name: string) => (): never => {
  throw new Error(`ジョブは${name}を呼ばない`);
};

export type Failure = Error | undefined;

export interface FakeDrawService extends WeekDrawService {
  readonly nows: Date[];
}

export function createFakeDrawService(
  log: CallLog,
  result: Awaited<ReturnType<WeekDrawService['drawDue']>> = {
    drawn: [],
    failed: [],
  },
  failure?: Error,
): FakeDrawService {
  const nows: Date[] = [];
  return {
    nows,
    drawDue(now) {
      log.push('drawDue');
      nows.push(now);
      return failure === undefined
        ? Promise.resolve(result)
        : Promise.reject(failure);
    },
  };
}

export interface FakeMatchDirectory extends MatchDirectory {
  readonly dateReads: {
    readonly date: BusinessDate;
    readonly kinds: readonly MatchKind[];
    readonly now: Date;
  }[];
}

export function createFakeMatchDirectory(
  log: CallLog,
  records: readonly MatchRecord[] = [],
  failure?: Error,
): FakeMatchDirectory {
  const dateReads: FakeMatchDirectory['dateReads'] = [];
  return {
    dateReads,
    listForDate(input) {
      log.push('listForDate');
      dateReads.push(input);
      return failure === undefined
        ? Promise.resolve(records)
        : Promise.reject(failure);
    },
    findMatches: unused('findMatches'),
    listByLaunches: unused('listByLaunches'),
    findQualifierResults: unused('findQualifierResults'),
    summarizeDaily: unused('summarizeDaily'),
  };
}

export interface FakeRegistrar extends WeekEntryRegistrar {
  readonly calls: { readonly matchId: string; readonly at: Date }[];
}

// failuresに含まれるマッチのIDでは例外を投げる
export function createFakeRegistrar(
  log: CallLog,
  failures: ReadonlyMap<string, Error> = new Map(),
): FakeRegistrar {
  const calls: FakeRegistrar['calls'] = [];
  return {
    calls,
    registerFromMatch(match, at) {
      log.push(`registerFromMatch:${match.matchId}`);
      calls.push({ matchId: match.matchId, at });
      const failure = failures.get(match.matchId);
      return failure === undefined
        ? Promise.resolve([])
        : Promise.reject(failure);
    },
  };
}

export interface FakeProgressionService extends WeekProgressionService {
  readonly nows: Date[];
}

export function createFakeProgressionService(
  log: CallLog,
  result: Awaited<ReturnType<WeekProgressionService['advanceAll']>> = {
    advanced: 0,
    failed: [],
  },
  failure?: Error,
): FakeProgressionService {
  const nows: Date[] = [];
  return {
    nows,
    advanceAll(now) {
      log.push('advanceAll');
      nows.push(now);
      return failure === undefined
        ? Promise.resolve(result)
        : Promise.reject(failure);
    },
    advance: unused('advance'),
    applyResult: unused('applyResult'),
  };
}

export interface FakeNotificationPublisher extends WeekNotificationPublisher {
  readonly nights: { readonly date: BusinessDate; readonly at: Date }[];
}

export function createFakeNotificationPublisher(
  log: CallLog,
  failure?: Error,
): FakeNotificationPublisher {
  const nights: FakeNotificationPublisher['nights'] = [];
  return {
    nights,
    publishNight(input) {
      log.push('publishNight');
      nights.push(input);
      return failure === undefined
        ? Promise.resolve()
        : Promise.reject(failure);
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
  failure?: Error,
): FakeEveningDispatchGate {
  const inputs: EveningDispatchReadyInput[] = [];
  return {
    inputs,
    markReady(input) {
      log.push('markReady');
      inputs.push(input);
      return failure === undefined
        ? Promise.resolve(readiness)
        : Promise.reject(failure);
    },
  };
}

export interface LoggingIncidentReporter extends WeekTournamentIncidentReporter {
  readonly incidents: WeekTournamentIncident[];
}

export function createLoggingIncidentReporter(
  log: CallLog,
): LoggingIncidentReporter {
  const incidents: WeekTournamentIncident[] = [];
  return {
    incidents,
    report(incident) {
      log.push(`report:${incident.kind}`);
      incidents.push(incident);
    },
  };
}

export interface FakeFollowUpStore extends WeekTournamentStore {
  readonly pendingReads: {
    readonly olderThan: Date;
    readonly limit: number;
  }[];
}

export function createFakeFollowUpStore(
  log: CallLog,
  pending: readonly WeekEntryRecord[] = [],
  failure?: Error,
): FakeFollowUpStore {
  const pendingReads: FakeFollowUpStore['pendingReads'] = [];
  return {
    pendingReads,
    listPendingFollowUps(olderThan, limit) {
      log.push('listPendingFollowUps');
      pendingReads.push({ olderThan, limit });
      return failure === undefined
        ? Promise.resolve(pending)
        : Promise.reject(failure);
    },
    ensureTournament: unused('ensureTournament'),
    findTournament: unused('findTournament'),
    findTournamentByWeek: unused('findTournamentByWeek'),
    findTournamentsByWeeks: unused('findTournamentsByWeeks'),
    listDue: unused('listDue'),
    listInProgress: unused('listInProgress'),
    findEntriesByLaunch: unused('findEntriesByLaunch'),
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
    listPendingFollowUpsOf: unused('listPendingFollowUpsOf'),
    markRefundRequested: unused('markRefundRequested'),
    markRefundClosed: unused('markRefundClosed'),
    markNotice: unused('markNotice'),
    unlinkOrDeleteByProduct: unused('unlinkOrDeleteByProduct'),
  };
}

export interface FakeFollowUp extends WeekEntryFollowUp {
  readonly processed: {
    readonly entryIds: readonly string[];
    readonly now: Date;
  }[];
}

export function createFakeFollowUp(
  log: CallLog,
  failure?: Error,
): FakeFollowUp {
  const processed: FakeFollowUp['processed'] = [];
  return {
    processed,
    process(entryIds, now) {
      log.push('process');
      processed.push({ entryIds, now });
      return failure === undefined
        ? Promise.resolve()
        : Promise.reject(failure);
    },
    processTournament: unused('processTournament'),
  };
}
