import type { EveningSlotOpener } from '../../../../lib/core/notifications/evening-dispatch.ts';
import type { NotificationSlot } from '../../../../lib/core/notifications/notification-slots.ts';
import type {
  NotificationIncident,
  NotificationIncidentReporter,
  NotificationSlotStore,
  NotificationWorkRequester,
  SlotPhase,
  StoredSlot,
} from '../../../../lib/core/notifications/ports.ts';
import type { ScheduledJobContext } from '../../../../lib/core/scheduling/cron-registry.ts';
import {
  type BusinessDate,
  type BusinessTimeOfDay,
  fromBusinessDateTime,
  toBusinessDateTime,
  toUtcCronExpression,
} from '../../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../../lib/core/time/clock.ts';
import type {
  NotificationMaintenanceStore,
  StalePendingEvent,
} from '../ports.ts';

// 各偽物の呼び出しを1つの列に記録し、ジョブの中の順序を確かめる
export type CallLog = string[];

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

export function storedSlotOf(
  slot: NotificationSlot,
  phase: SlotPhase,
): StoredSlot {
  return {
    ...slot,
    phase,
    cursor: null,
    requiredParticipants: null,
    dispatchRequestedAt: null,
  };
}

export interface RecordingEveningSlotOpener extends EveningSlotOpener {
  readonly calls: { readonly date: BusinessDate; readonly at: Date }[];
}

export function createRecordingEveningSlotOpener(
  log: CallLog,
  requested: boolean,
): RecordingEveningSlotOpener {
  const calls: { readonly date: BusinessDate; readonly at: Date }[] = [];
  return {
    calls,
    open(date, at) {
      log.push(`open:${date}`);
      calls.push({ date, at });
      return Promise.resolve({ requested });
    },
  };
}

export interface RecordingWorkRequester extends NotificationWorkRequester {
  readonly flushes: {
    readonly slotKey: string;
    readonly delaySeconds: number;
  }[];
  readonly expansions: string[];
}

export function createRecordingWorkRequester(
  log: CallLog,
): RecordingWorkRequester {
  const flushes: { readonly slotKey: string; readonly delaySeconds: number }[] =
    [];
  const expansions: string[] = [];
  return {
    flushes,
    expansions,
    flushSlot(slotKey, delaySeconds) {
      log.push(`flush:${slotKey}`);
      flushes.push({ slotKey, delaySeconds });
      return Promise.resolve();
    },
    expandEvent(eventId) {
      log.push(`expand:${eventId}`);
      expansions.push(eventId);
      return Promise.resolve();
    },
  };
}

export interface RecordingIncidentReporter extends NotificationIncidentReporter {
  readonly incidents: NotificationIncident[];
}

export function createRecordingIncidentReporter(
  log: CallLog,
): RecordingIncidentReporter {
  const incidents: NotificationIncident[] = [];
  return {
    incidents,
    report(incident) {
      log.push(`report:${incident.kind}`);
      incidents.push(incident);
    },
  };
}

export interface FakeSlotStoreOptions {
  // ensureが返す段。キーが無ければwaiting
  readonly phases?: Readonly<Record<string, SlotPhase>>;
  readonly overdue?: readonly StoredSlot[];
  readonly doneWithPending?: readonly StoredSlot[];
}

export interface FakeSlotStore extends NotificationSlotStore {
  readonly ensured: { readonly slot: NotificationSlot; readonly at: Date }[];
  readonly overdueQueries: { readonly before: Date; readonly limit: number }[];
  readonly doneWithPendingQueries: {
    readonly before: Date;
    readonly limit: number;
  }[];
}

function unused(name: string): never {
  throw new Error(`ジョブは送信枠のストアの${name}を使わない`);
}

export function createFakeSlotStore(
  log: CallLog,
  options: FakeSlotStoreOptions = {},
): FakeSlotStore {
  const ensured: { readonly slot: NotificationSlot; readonly at: Date }[] = [];
  const overdueQueries: { readonly before: Date; readonly limit: number }[] =
    [];
  const doneWithPendingQueries: {
    readonly before: Date;
    readonly limit: number;
  }[] = [];
  return {
    ensured,
    overdueQueries,
    doneWithPendingQueries,
    ensure(slot, at) {
      log.push(`ensure:${slot.key}`);
      ensured.push({ slot, at });
      return Promise.resolve(
        storedSlotOf(slot, options.phases?.[slot.key] ?? 'waiting'),
      );
    },
    listOverdue(before, limit) {
      log.push('listOverdue');
      overdueQueries.push({ before, limit });
      return Promise.resolve(options.overdue ?? []);
    },
    listDoneWithPending(before, limit) {
      log.push('listDoneWithPending');
      doneWithPendingQueries.push({ before, limit });
      return Promise.resolve(options.doneWithPending ?? []);
    },
    find: () => unused('find'),
    acquireLease: () => unused('acquireLease'),
    releaseLease: () => unused('releaseLease'),
    advance: () => unused('advance'),
    missingParticipants: () => unused('missingParticipants'),
    markDispatchRequested: () => unused('markDispatchRequested'),
    fixParticipants: () => unused('fixParticipants'),
  };
}

export interface FakeMaintenanceStoreOptions {
  readonly staleEvents?: readonly StalePendingEvent[];
  readonly expired?: number;
  // 削除の各回が返す件数。尽きたら0
  readonly deletedNotices?: readonly number[];
  readonly deletedSlots?: readonly number[];
  readonly deletedEvents?: readonly number[];
}

export interface DeletionCall {
  readonly cutoff: Date;
  readonly limit: number;
}

export interface FakeMaintenanceStore extends NotificationMaintenanceStore {
  readonly staleQueries: {
    readonly dispatchedBefore: Date;
    readonly limit: number;
  }[];
  readonly redispatched: {
    readonly eventIds: readonly string[];
    readonly at: Date;
  }[];
  readonly expirations: { readonly dueBefore: Date; readonly at: Date }[];
  readonly noticeDeletions: DeletionCall[];
  readonly slotDeletions: DeletionCall[];
  readonly eventDeletions: DeletionCall[];
}

function countsFrom(counts: readonly number[] | undefined) {
  let index = 0;
  return () => {
    const count = counts?.[index] ?? 0;
    index += 1;
    return count;
  };
}

export function createFakeMaintenanceStore(
  log: CallLog,
  options: FakeMaintenanceStoreOptions = {},
): FakeMaintenanceStore {
  const staleQueries: {
    readonly dispatchedBefore: Date;
    readonly limit: number;
  }[] = [];
  const redispatched: {
    readonly eventIds: readonly string[];
    readonly at: Date;
  }[] = [];
  const expirations: { readonly dueBefore: Date; readonly at: Date }[] = [];
  const noticeDeletions: DeletionCall[] = [];
  const slotDeletions: DeletionCall[] = [];
  const eventDeletions: DeletionCall[] = [];
  const nextNotices = countsFrom(options.deletedNotices);
  const nextSlots = countsFrom(options.deletedSlots);
  const nextEvents = countsFrom(options.deletedEvents);
  return {
    staleQueries,
    redispatched,
    expirations,
    noticeDeletions,
    slotDeletions,
    eventDeletions,
    listStalePendingEvents(dispatchedBefore, limit) {
      log.push('listStalePendingEvents');
      staleQueries.push({ dispatchedBefore, limit });
      return Promise.resolve(options.staleEvents ?? []);
    },
    markEventsRedispatched(eventIds, at) {
      log.push('markEventsRedispatched');
      redispatched.push({ eventIds: [...eventIds], at });
      return Promise.resolve();
    },
    expirePending(dueBefore, at) {
      log.push('expirePending');
      expirations.push({ dueBefore, at });
      return Promise.resolve(options.expired ?? 0);
    },
    deleteSettledBefore(cutoff, limit) {
      log.push('deleteSettledBefore');
      noticeDeletions.push({ cutoff, limit });
      return Promise.resolve(nextNotices());
    },
    deleteCompletedSlotsBefore(cutoff, limit) {
      log.push('deleteCompletedSlotsBefore');
      slotDeletions.push({ cutoff, limit });
      return Promise.resolve(nextSlots());
    },
    deleteExpandedEventsBefore(cutoff, limit) {
      log.push('deleteExpandedEventsBefore');
      eventDeletions.push({ cutoff, limit });
      return Promise.resolve(nextEvents());
    },
  };
}
