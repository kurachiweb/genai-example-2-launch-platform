import type {
  MatchEventStore,
  StoredMatchEvent,
} from '../../../../lib/core/match/ports.ts';
import type { SettlementStore } from '../ports.ts';
import type { CallLog } from './match-job-fakes.ts';

export function staleEventIdOf(index: number): string {
  return `01JF0STALE${String(index).padStart(16, '0')}`;
}

export function staleEventOf(
  index: number,
  lastDispatchedAt: Date,
): StoredMatchEvent {
  return {
    id: staleEventIdOf(index),
    matchId: `01JF0MATCH${String(index).padStart(16, '0')}`,
    kind: 'qualifier',
    type: 'decided',
    occurredAt: lastDispatchedAt,
    status: 'pending',
    dispatchCount: 1,
    lastDispatchedAt,
  };
}

function unused(name: string): never {
  throw new Error(`4:21のジョブは${name}を呼ばない`);
}

export interface FakeMaintenanceEventStore extends MatchEventStore {
  readonly sweeps: { readonly decidedSince: Date; readonly at: Date }[];
  readonly staleReads: {
    readonly dispatchedBefore: Date;
    readonly limit: number;
  }[];
  readonly redispatched: {
    readonly eventIds: readonly string[];
    readonly at: Date;
  }[];
  readonly deletions: {
    readonly completedBefore: Date;
    readonly limit: number;
  }[];
}

export interface FakeMaintenanceEventStoreOptions {
  // 送り直しの対象の候補。照会の上限で先頭から切る
  readonly stale?: readonly StoredMatchEvent[];
  // 削除の1回ごとに消した件数。尽きたら0件を返す
  readonly deletedPerCall?: readonly number[];
}

export function createFakeMaintenanceEventStore(
  log: CallLog,
  options: FakeMaintenanceEventStoreOptions = {},
): FakeMaintenanceEventStore {
  const sweeps: FakeMaintenanceEventStore['sweeps'] = [];
  const staleReads: FakeMaintenanceEventStore['staleReads'] = [];
  const redispatched: FakeMaintenanceEventStore['redispatched'] = [];
  const deletions: FakeMaintenanceEventStore['deletions'] = [];
  return {
    sweeps,
    staleReads,
    redispatched,
    deletions,
    createMissingDecidedEvents(decidedSince, at) {
      log.push('sweep');
      sweeps.push({ decidedSince, at });
      return Promise.resolve([]);
    },
    listStalePending(dispatchedBefore, limit) {
      log.push('listStalePending');
      staleReads.push({ dispatchedBefore, limit });
      return Promise.resolve((options.stale ?? []).slice(0, limit));
    },
    markRedispatched(eventIds, at) {
      log.push('markRedispatched');
      redispatched.push({ eventIds, at });
      return Promise.resolve();
    },
    deleteCompletedBefore(completedBefore, limit) {
      log.push('deleteCompletedBefore');
      deletions.push({ completedBefore, limit });
      return Promise.resolve(
        options.deletedPerCall?.[deletions.length - 1] ?? 0,
      );
    },
    findEvent: () => unused('findEvent'),
    findOldestPending: () => unused('findOldestPending'),
    completedHandlers: () => unused('completedHandlers'),
    markHandlerCompleted: () => unused('markHandlerCompleted'),
    markEventCompleted: () => unused('markEventCompleted'),
  };
}

export interface FakeOverdueSettlementStore extends SettlementStore {
  readonly overdueQueries: Date[];
}

export function createFakeOverdueSettlementStore(
  log: CallLog,
  overdue: number,
): FakeOverdueSettlementStore {
  const overdueQueries: Date[] = [];
  return {
    overdueQueries,
    countOverdue(endedBefore) {
      log.push('countOverdue');
      overdueQueries.push(endedBefore);
      return Promise.resolve(overdue);
    },
    listDue: () => unused('listDue'),
    writeOutcomes: () => unused('writeOutcomes'),
  };
}
