import type {
  MatchEventDispatcher,
  MatchEventStore,
} from '../../../../lib/core/match/ports.ts';
import type { ScheduledJobContext } from '../../../../lib/core/scheduling/cron-registry.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
  type BusinessTimeOfDay,
  toBusinessDateTime,
  toUtcCronExpression,
} from '../../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../../lib/core/time/clock.ts';
import type { MatchKickoff } from '../match-kickoff.ts';
import type {
  MatchSettlement,
  SettlementSummary,
} from '../match-settlement.ts';
import type {
  MatchIncident,
  MatchIncidentReporter,
  PairingCounts,
  PairingStore,
} from '../ports.ts';
import type { QualifierPairingService } from '../qualifier-pairing-service.ts';

export const JOB_DATE: BusinessDate = parseBusinessDate('2027-03-02');

export const NEXT_DATE: BusinessDate = parseBusinessDate('2027-03-03');

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

export function fixedClock(now: Date): Clock {
  return { now: () => now };
}

// 各偽物の呼び出しを1つの列に記録し、ジョブの中の順序を確かめる
export type CallLog = string[];

export function sweptEventIdOf(index: number): string {
  return `01JF0SWEPT${String(index).padStart(16, '0')}`;
}

export interface FakeSweepEventStore extends MatchEventStore {
  readonly sweeps: {
    readonly decidedSince: Date;
    readonly at: Date;
    readonly limit: number;
  }[];
}

const unused = (name: string) => (): never => {
  throw new Error(`ジョブの掃き出しは${name}を呼ばない`);
};

// 呼ばれるたびにpagesの次の要素を作ったイベントとして返し、尽きたら空を返す
export function createFakeSweepEventStore(
  log: CallLog,
  pages: readonly (readonly string[])[] = [],
): FakeSweepEventStore {
  const sweeps: FakeSweepEventStore['sweeps'] = [];
  return {
    sweeps,
    createMissingDecidedEvents(decidedSince, at, limit) {
      log.push('sweep');
      sweeps.push({ decidedSince, at, limit });
      return Promise.resolve(pages[sweeps.length - 1] ?? []);
    },
    findEvent: unused('findEvent'),
    findOldestPending: unused('findOldestPending'),
    completedHandlers: unused('completedHandlers'),
    markHandlerCompleted: unused('markHandlerCompleted'),
    markEventCompleted: unused('markEventCompleted'),
    listStalePending: unused('listStalePending'),
    markRedispatched: unused('markRedispatched'),
    deleteCompletedBefore: unused('deleteCompletedBefore'),
  };
}

export interface LoggingDispatcher extends MatchEventDispatcher {
  readonly published: (readonly string[])[];
}

export function createLoggingDispatcher(log: CallLog): LoggingDispatcher {
  const published: (readonly string[])[] = [];
  return {
    published,
    publish(eventIds) {
      log.push('publish');
      published.push(eventIds);
      return Promise.resolve();
    },
  };
}

export interface RecordingSettlement extends MatchSettlement {
  readonly calls: { readonly now: Date; readonly deadline?: Date }[];
}

export function createRecordingSettlement(
  log: CallLog,
  summary: SettlementSummary = { settled: 0, truncated: false },
): RecordingSettlement {
  const calls: RecordingSettlement['calls'] = [];
  return {
    calls,
    settleDue(now, deadline) {
      log.push('settle');
      calls.push(deadline === undefined ? { now } : { now, deadline });
      return Promise.resolve(summary);
    },
  };
}

export interface RecordingPairingService extends QualifierPairingService {
  readonly dates: BusinessDate[];
}

export function createRecordingPairingService(
  log: CallLog,
  counts: PairingCounts = { launches: 0, matches: 0 },
): RecordingPairingService {
  const dates: BusinessDate[] = [];
  return {
    dates,
    pair(date) {
      log.push('pair');
      dates.push(date);
      return Promise.resolve(counts);
    },
  };
}

export interface RecordingKickoff extends MatchKickoff {
  readonly nows: Date[];
}

export function createRecordingKickoff(log: CallLog): RecordingKickoff {
  const nows: Date[] = [];
  return {
    nows,
    kickoffDue(now) {
      log.push('kickoff');
      nows.push(now);
      return Promise.resolve({ started: 3, decided: 1 });
    },
  };
}

export interface FakeCompletionStore extends PairingStore {
  readonly checked: BusinessDate[];
}

// 完了済みの実施日だけを持ち、ジョブが使う完了の有無の照会だけに答える
export function createFakeCompletionStore(
  log: CallLog,
  completed: readonly BusinessDate[],
): FakeCompletionStore {
  const checked: BusinessDate[] = [];
  return {
    checked,
    isDayCompleted(date) {
      log.push('isDayCompleted');
      checked.push(date);
      return Promise.resolve(completed.includes(date));
    },
    beginDay: unused('beginDay'),
    completeDay: unused('completeDay'),
    pairedLaunchIds: unused('pairedLaunchIds'),
  };
}

export interface LoggingIncidentReporter extends MatchIncidentReporter {
  readonly incidents: MatchIncident[];
}

export function createLoggingIncidentReporter(
  log: CallLog,
): LoggingIncidentReporter {
  const incidents: MatchIncident[] = [];
  return {
    incidents,
    report(incident) {
      log.push(`report:${incident.kind}`);
      incidents.push(incident);
    },
  };
}
