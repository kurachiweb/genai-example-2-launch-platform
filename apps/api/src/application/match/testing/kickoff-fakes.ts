import { qualifierWindow } from '../../../../lib/core/match/match-model.ts';
import type {
  LaunchRecord,
  ProductDirectory,
  ProductLookupScope,
  ProductSummaryRecord,
} from '../../../../lib/core/product/ports.ts';
import { parseBusinessDate } from '../../../../lib/core/time/business-time.ts';
import type {
  DueKickoff,
  EntryEligibilityChecker,
  KickoffEntry,
  KickoffStore,
  KickoffWrite,
  MatchIncident,
  MatchIncidentReporter,
} from '../ports.ts';

export const KICKOFF_DATE = parseBusinessDate('2027-03-03');

// 業務時刻0:00
export const KICKOFF_AT = qualifierWindow(KICKOFF_DATE).startsAt;

// 前日の業務時刻23:59:59
export const JUST_BEFORE_KICKOFF = new Date(KICKOFF_AT.getTime() - 1000);

export function afterKickoff(milliseconds: number): Date {
  return new Date(KICKOFF_AT.getTime() + milliseconds);
}

export function kickoffMatchIdOf(index: number): string {
  return `01JF0KICK${String(index).padStart(17, '0')}`;
}

export function kickoffEntryOf(
  matchIndex: number,
  slot: 1 | 2,
  overrides: Partial<KickoffEntry> = {},
): KickoffEntry {
  const id = `${kickoffMatchIdOf(matchIndex)}-${String(slot)}`;
  return {
    entryId: id,
    launchId: `launch-${id}`,
    productId: `product-${id}`,
    forfeited: false,
    ...overrides,
  };
}

// 側が2つで、どちらも該当しない予選
export function dueKickoffOf(
  index: number,
  entries?: readonly KickoffEntry[],
  overrides: Partial<Omit<DueKickoff, 'matchId' | 'entries'>> = {},
): DueKickoff {
  return {
    matchId: kickoffMatchIdOf(index),
    kind: 'qualifier',
    startsAt: KICKOFF_AT,
    entries: entries ?? [kickoffEntryOf(index, 1), kickoffEntryOf(index, 2)],
    ...overrides,
  };
}

export interface FakeKickoffStore extends KickoffStore {
  readonly reads: { readonly now: Date; readonly limit: number }[];
  readonly writes: {
    readonly items: readonly KickoffWrite[];
    readonly at: Date;
  }[];
}

// 書き込んだマッチを一覧から除く。refusedは書き込みを拒んで一覧に残し、refusedOnceは1回目だけ拒み、concurrentは別の実行が先に書いた扱いで拒んで一覧から除く
export function createFakeKickoffStore(
  due: readonly DueKickoff[],
  options: {
    readonly refused?: ReadonlySet<string>;
    readonly refusedOnce?: ReadonlySet<string>;
    readonly concurrent?: ReadonlySet<string>;
  } = {},
): FakeKickoffStore {
  const done = new Set<string>();
  const refusedOnce = new Set(options.refusedOnce);
  const reads: FakeKickoffStore['reads'] = [];
  const writes: FakeKickoffStore['writes'] = [];
  return {
    reads,
    writes,
    listDue(now, limit) {
      reads.push({ now, limit });
      return Promise.resolve(
        due
          .filter(
            (match) =>
              !done.has(match.matchId) &&
              match.startsAt.getTime() <= now.getTime(),
          )
          .slice(0, limit),
      );
    },
    writeKickoffs(items, at) {
      writes.push({ items, at });
      const eventIds = items.flatMap((item) => {
        if (done.has(item.matchId) || options.refused?.has(item.matchId)) {
          return [];
        }
        if (refusedOnce.delete(item.matchId)) {
          return [];
        }
        done.add(item.matchId);
        return options.concurrent?.has(item.matchId) ? [] : [item.eventId];
      });
      return Promise.resolve(eventIds);
    },
  };
}

export interface FakeEntryEligibilityChecker extends EntryEligibilityChecker {
  readonly calls: {
    readonly items: readonly Pick<DueKickoff, 'kind' | 'entries'>[];
    readonly now: Date;
  }[];
}

// 記録された該当の側と、開始の時点の状態で該当するとした側を返す
export function createFakeEntryEligibilityChecker(
  currentlyForfeited: ReadonlySet<string> = new Set(),
): FakeEntryEligibilityChecker {
  const calls: FakeEntryEligibilityChecker['calls'] = [];
  return {
    calls,
    forfeitedEntries(items, now) {
      calls.push({ items, now });
      return Promise.resolve(
        new Set(
          items.flatMap((item) =>
            item.entries
              .filter(
                (entry) =>
                  entry.forfeited || currentlyForfeited.has(entry.entryId),
              )
              .map((entry) => entry.entryId),
          ),
        ),
      );
    },
  };
}

export interface RecordingMatchIncidentReporter extends MatchIncidentReporter {
  readonly incidents: MatchIncident[];
}

export function createRecordingMatchIncidentReporter(): RecordingMatchIncidentReporter {
  const incidents: MatchIncident[] = [];
  return {
    incidents,
    report(incident) {
      incidents.push(incident);
    },
  };
}

export function productSummaryOf(
  productId: string,
  overrides: Partial<ProductSummaryRecord> = {},
): ProductSummaryRecord {
  return {
    productId,
    ownerUserId: `owner-${productId}`,
    handle: `handle-${productId}`,
    name: `名称${productId}`,
    tagline: `タグライン${productId}`,
    category: {
      id: 'category-1',
      name: '開発ツール',
      handle: 'developer-tools',
    },
    websiteUrl: 'https://product.example/',
    logoFileId: `logo-${productId}`,
    hidden: false,
    visible: true,
    listed: false,
    createdAt: new Date('2027-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function launchRecordOf(
  launchId: string,
  productId: string,
  overrides: Partial<LaunchRecord> = {},
): LaunchRecord {
  return {
    launchId,
    productId,
    number: 1,
    launchDate: KICKOFF_DATE,
    status: 'paired',
    outcome: null,
    decidedAt: null,
    ...overrides,
  };
}

export interface FakeKickoffProductDirectory extends ProductDirectory {
  readonly summaryReads: {
    readonly productIds: readonly string[];
    readonly scope: ProductLookupScope;
  }[];
  readonly launchReads: {
    readonly productIds: readonly string[];
    readonly now: Date;
  }[];
}

export function createFakeKickoffProductDirectory(
  summaries: readonly ProductSummaryRecord[],
  launches: readonly LaunchRecord[],
): FakeKickoffProductDirectory {
  const summaryReads: FakeKickoffProductDirectory['summaryReads'] = [];
  const launchReads: FakeKickoffProductDirectory['launchReads'] = [];
  const unexpected = (name: string) => () => {
    throw new Error(`この偽物では使わない: ${name}`);
  };
  return {
    summaryReads,
    launchReads,
    findSummaries(productIds, scope) {
      summaryReads.push({ productIds, scope });
      const ids = new Set(productIds);
      return Promise.resolve(
        new Map(
          summaries
            .filter((summary) => ids.has(summary.productId))
            .map((summary) => [summary.productId, summary]),
        ),
      );
    },
    listLaunches(productIds, now) {
      launchReads.push({ productIds, now });
      const ids = new Set(productIds);
      return Promise.resolve(
        Map.groupBy(
          launches.filter((launch) => ids.has(launch.productId)),
          (launch) => launch.productId,
        ),
      );
    },
    resolveHandle: unexpected('resolveHandle'),
    findDetail: unexpected('findDetail'),
  };
}
