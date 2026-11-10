import type { IdGenerator } from '../../../../lib/core/ids/id-generator.ts';
import type {
  MatchScheduleInput,
  MatchScheduler,
} from '../../../../lib/core/match/ports.ts';
import type { RandomSource } from '../../../../lib/core/match/qualifier-pairing.ts';
import type {
  ScheduledLaunch,
  ScheduledLaunchDirectory,
} from '../../../../lib/core/product/ports.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../../lib/core/time/business-time.ts';
import type { PairingCounts, PairingDayState, PairingStore } from '../ports.ts';

export const PAIRING_DATE: BusinessDate = parseBusinessDate('2027-03-03');

// 前日の業務時刻23:45の直後
export const PAIRING_NOW = new Date('2027-03-03T07:45:05.000Z');

export const COMPLETED_NOW = new Date('2027-03-03T07:45:09.000Z');

export function scheduledLaunchOf(
  index: number,
  categoryId = 'category-1',
): ScheduledLaunch {
  return {
    launchId: `launch-${String(index).padStart(4, '0')}`,
    productId: `product-${String(index).padStart(4, '0')}`,
    ownerUserId: `owner-${String(index).padStart(4, '0')}`,
    categoryId,
  };
}

export function scheduledLaunches(count: number): ScheduledLaunch[] {
  return Array.from({ length: count }, (_, index) =>
    scheduledLaunchOf(index + 1),
  );
}

export interface FakeScheduledLaunchDirectory extends ScheduledLaunchDirectory {
  readonly reads: {
    readonly launchDate: BusinessDate;
    readonly after: string | undefined;
    readonly limit: number;
  }[];
}

// ローンチのIDの昇順のページを、直前のページの最後のIDの後から返す
export function createFakeScheduledLaunchDirectory(
  launches: readonly ScheduledLaunch[],
): FakeScheduledLaunchDirectory {
  const ordered = launches.toSorted((left, right) =>
    left.launchId < right.launchId ? -1 : 1,
  );
  const reads: FakeScheduledLaunchDirectory['reads'] = [];
  return {
    reads,
    listForDate(input) {
      reads.push(input);
      const rest = ordered.filter(
        (launch) => input.after === undefined || launch.launchId > input.after,
      );
      const page = rest.slice(0, input.limit);
      return Promise.resolve({
        launches: page,
        next: rest.length > input.limit ? page.at(-1)?.launchId : undefined,
      });
    },
  };
}

export interface PairingDayRecord {
  readonly completedAt: Date | null;
  readonly launches: number;
  readonly matches: number;
}

export interface FakePairingStore extends PairingStore {
  readonly days: Map<BusinessDate, PairingDayRecord>;
  readonly calls: string[];
}

export function createFakePairingStore(
  options: {
    readonly paired?: readonly string[];
    readonly day?: PairingDayRecord;
  } = {},
): FakePairingStore {
  const days = new Map<BusinessDate, PairingDayRecord>();
  if (options.day !== undefined) {
    days.set(PAIRING_DATE, options.day);
  }
  const paired = new Set(options.paired ?? []);
  const calls: string[] = [];
  return {
    days,
    calls,
    beginDay(date): Promise<PairingDayState> {
      calls.push('beginDay');
      const day = days.get(date);
      if (day === undefined) {
        days.set(date, { completedAt: null, launches: 0, matches: 0 });
        return Promise.resolve('begun');
      }
      return Promise.resolve(
        day.completedAt === null ? 'begun' : 'already-completed',
      );
    },
    completeDay(date, counts: PairingCounts, at) {
      calls.push('completeDay');
      const day = days.get(date) ?? {
        completedAt: null,
        launches: 0,
        matches: 0,
      };
      days.set(date, {
        completedAt: day.completedAt ?? at,
        launches: day.launches + counts.launches,
        matches: day.matches + counts.matches,
      });
      return Promise.resolve();
    },
    isDayCompleted(date) {
      return Promise.resolve(days.get(date)?.completedAt != null);
    },
    pairedLaunchIds() {
      calls.push('pairedLaunchIds');
      return Promise.resolve(new Set(paired));
    },
  };
}

export interface FakeMatchScheduler extends MatchScheduler {
  readonly calls: {
    readonly inputs: readonly MatchScheduleInput[];
    readonly at: Date;
  }[];
}

// skippedLaunchesのローンチを含むマッチは、同時に組まれていた扱いで作らない
export function createFakeMatchScheduler(
  options: { readonly skippedLaunches?: ReadonlySet<string> } = {},
): FakeMatchScheduler {
  const skippedLaunches = options.skippedLaunches ?? new Set<string>();
  const calls: FakeMatchScheduler['calls'] = [];
  return {
    calls,
    schedule(inputs, at) {
      calls.push({ inputs, at });
      const isSkipped = (input: MatchScheduleInput) =>
        input.entries.some((entry) => skippedLaunches.has(entry.launchId));
      return Promise.resolve({
        created: inputs
          .filter((input) => !isSkipped(input))
          .map((input) => input.matchId),
        skipped: inputs.filter(isSkipped).map((input) => input.matchId),
      });
    },
  };
}

// 並べ替えで常に末尾の要素を残すため、入力の順のまま組まれる
export const lastIndexRandom: RandomSource = {
  nextInt: (exclusiveMax) => exclusiveMax - 1,
};

export function createPairingMatchIds(): IdGenerator {
  let serial = 0;
  return {
    generate: () => {
      serial += 1;
      return `01JF0PAIR${String(serial).padStart(17, '0')}`;
    },
  };
}
