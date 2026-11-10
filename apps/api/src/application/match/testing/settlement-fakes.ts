import type { IdGenerator } from '../../../../lib/core/ids/id-generator.ts';
import type { EntryTally } from '../../../../lib/core/match/match-decision.ts';
import type { MatchEventDispatcher } from '../../../../lib/core/match/ports.ts';
import type { Clock } from '../../../../lib/core/time/clock.ts';
import type {
  DueSettlement,
  SettlementStore,
  SettlementWrite,
} from '../ports.ts';

// 予選の終了の日時(業務時刻23:40)の直後
export const SETTLEMENT_NOW = new Date('2027-03-02T14:40:05.000Z');

export function dueMatchIdOf(index: number): string {
  return `01JF0DUE${String(index).padStart(18, '0')}`;
}

export function tallyOf(
  entryId: string,
  upvoteCount: number,
  lastUpvotedAt: string | null = null,
  lastUpvoteSeq: number | null = null,
): EntryTally {
  return {
    entryId,
    upvoteCount,
    lastUpvotedAt: lastUpvotedAt === null ? null : new Date(lastUpvotedAt),
    lastUpvoteSeq,
  };
}

// 側1が3票・側2が0票で、側1が勝つマッチ
export function dueMatchOf(
  index: number,
  entries?: readonly EntryTally[],
): DueSettlement {
  const matchId = dueMatchIdOf(index);
  const sides = entries ?? [
    tallyOf(`${matchId}-1`, 3, '2027-03-02T05:00:00.000Z', 3),
    tallyOf(`${matchId}-2`, 0),
  ];
  return {
    matchId,
    entries: sides,
    entryCount: sides.length === 1 ? 1 : 2,
  };
}

export interface FakeSettlementStore extends SettlementStore {
  readonly reads: { readonly now: Date; readonly limit: number }[];
  readonly writes: {
    readonly outcomes: readonly SettlementWrite[];
    readonly at: Date;
  }[];
}

// 書き込んだマッチを未確定の一覧から除く。decidedConcurrentlyのマッチは読み取りの後に即時の終了が先に確定した扱いで、書き込みでイベントのIDを返さない
export function createFakeSettlementStore(
  due: readonly DueSettlement[],
  options: { readonly decidedConcurrently?: ReadonlySet<string> } = {},
): FakeSettlementStore {
  const concurrent = options.decidedConcurrently ?? new Set<string>();
  const decided = new Set<string>();
  const reads: FakeSettlementStore['reads'] = [];
  const writes: FakeSettlementStore['writes'] = [];
  return {
    reads,
    writes,
    listDue(now, limit) {
      reads.push({ now, limit });
      return Promise.resolve(
        due.filter((match) => !decided.has(match.matchId)).slice(0, limit),
      );
    },
    writeOutcomes(outcomes, at) {
      writes.push({ outcomes, at });
      const eventIds = outcomes.flatMap((item) => {
        if (decided.has(item.matchId)) {
          return [];
        }
        decided.add(item.matchId);
        return concurrent.has(item.matchId) ? [] : [item.eventId];
      });
      return Promise.resolve(eventIds);
    },
  };
}

export interface RecordingMatchEventDispatcher extends MatchEventDispatcher {
  readonly published: (readonly string[])[];
}

export function createRecordingMatchEventDispatcher(): RecordingMatchEventDispatcher {
  const published: (readonly string[])[] = [];
  return {
    published,
    publish(eventIds) {
      published.push(eventIds);
      return Promise.resolve();
    },
  };
}

export function createSettlementIds(): IdGenerator {
  let serial = 0;
  return {
    generate: () => {
      serial += 1;
      return `01JF0EVENT${String(serial).padStart(16, '0')}`;
    },
  };
}

// 呼ばれるたびに次の時刻を返し、尽きたら最後の時刻を返し続ける
export function createSteppingClock(
  times: readonly Date[],
): Clock & { readonly calls: () => number } {
  let count = 0;
  return {
    now() {
      const time = times[Math.min(count, times.length - 1)];
      count += 1;
      if (time === undefined) {
        throw new Error('時計の時刻がありません');
      }
      return time;
    },
    calls: () => count,
  };
}

export const unusedClock: Clock = {
  now() {
    throw new Error('打ち切りの時刻を渡さない確定は時計を読まない');
  },
};
