import type {
  MatchDirectory,
  MatchEntryRecord,
  MatchRecord,
} from '../../../../lib/core/match/ports.ts';
import {
  deriveMatchPhase,
  type MatchKind,
  qualifierWindow,
} from '../../../../lib/core/match/match-model.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../../lib/core/time/business-time.ts';
import type { MatchBoardStore, PairingStore } from '../ports.ts';

export const VIEW_DATE: BusinessDate = parseBusinessDate('2027-03-03');

export const VIEW_WINDOW = qualifierWindow(VIEW_DATE);

// 業務時刻12:00
export const VIEW_NOW = fromBusinessDateTime(VIEW_DATE, {
  hour: 12,
  minute: 0,
});

export function viewMatchIdOf(index: number): string {
  return `01JF0VIEW${String(index).padStart(17, '0')}`;
}

export function viewEntryIdOf(matchIndex: number, slot: 1 | 2): string {
  return `${viewMatchIdOf(matchIndex)}-${String(slot)}`;
}

export function viewProductIdOf(matchIndex: number, slot: 1 | 2): string {
  return `product-${viewEntryIdOf(matchIndex, slot)}`;
}

export function viewOwnerIdOf(matchIndex: number, slot: 1 | 2): string {
  return `owner-${viewEntryIdOf(matchIndex, slot)}`;
}

export function entryRecordOf(
  matchIndex: number,
  slot: 1 | 2,
  overrides: Partial<MatchEntryRecord> = {},
): MatchEntryRecord {
  return {
    entryId: viewEntryIdOf(matchIndex, slot),
    slot,
    launchId: `launch-${viewEntryIdOf(matchIndex, slot)}`,
    productId: viewProductIdOf(matchIndex, slot),
    ownerUserId: viewOwnerIdOf(matchIndex, slot),
    upvoteCount: 0,
    lastUpvotedAt: null,
    lastUpvoteElapsedMs: null,
    forfeited: false,
    result: null,
    ...overrides,
  };
}

export interface MatchRecordOptions extends Partial<
  Omit<MatchRecord, 'matchId' | 'entries' | 'phase'>
> {
  // 側ごとの上書き。nullの側は作らない
  readonly entries?: readonly (Partial<MatchEntryRecord> | null)[];
  readonly now?: Date;
}

// 開始済みで2つの側を持つ当日の予選。phaseはnowから導く
export function matchRecordOf(
  index: number,
  options: MatchRecordOptions = {},
): MatchRecord {
  const { entries = [{}, {}], now = VIEW_NOW, ...overrides } = options;
  const times = {
    startsAt: VIEW_WINDOW.startsAt,
    endsAt: VIEW_WINDOW.endsAt,
    startedAt: VIEW_WINDOW.startsAt,
    decidedAt: null,
    ...overrides,
  };
  return {
    matchId: viewMatchIdOf(index),
    kind: 'qualifier',
    round: null,
    stage: null,
    matchDate: VIEW_DATE,
    decision: null,
    endedEarly: false,
    ...times,
    phase: deriveMatchPhase(times, now),
    entries: entries.flatMap((entry, position) =>
      entry === null
        ? []
        : [entryRecordOf(index, position === 0 ? 1 : 2, entry)],
    ),
  };
}

export interface FakeMatchDirectory extends MatchDirectory {
  readonly findReads: {
    readonly matchIds: readonly string[];
    readonly now: Date;
  }[];
  readonly dateReads: {
    readonly date: BusinessDate;
    readonly kinds: readonly MatchKind[];
    readonly now: Date;
  }[];
}

export function createFakeMatchDirectory(
  records: readonly MatchRecord[],
): FakeMatchDirectory {
  const findReads: FakeMatchDirectory['findReads'] = [];
  const dateReads: FakeMatchDirectory['dateReads'] = [];
  const unexpected = (name: string) => () => {
    throw new Error(`この偽物では使わない: ${name}`);
  };
  return {
    findReads,
    dateReads,
    findMatches(matchIds, now) {
      findReads.push({ matchIds, now });
      const ids = new Set(matchIds);
      return Promise.resolve(
        new Map(
          records
            .filter((record) => ids.has(record.matchId))
            .map((record) => [record.matchId, record]),
        ),
      );
    },
    listForDate(input) {
      dateReads.push(input);
      return Promise.resolve(
        records
          .filter(
            (record) =>
              record.matchDate === input.date &&
              input.kinds.includes(record.kind),
          )
          .toSorted((left, right) => (left.matchId < right.matchId ? -1 : 1)),
      );
    },
    listByLaunches: unexpected('listByLaunches'),
    findQualifierResults: unexpected('findQualifierResults'),
    summarizeDaily: unexpected('summarizeDaily'),
  };
}

export interface FakeMatchBoardStore extends MatchBoardStore {
  readonly reads: {
    readonly matchIds: readonly string[];
    readonly userId: string;
  }[];
}

// upvotesはマッチID → 閲覧者の有効なUpvoteの側のID
export function createFakeMatchBoardStore(
  upvotes: ReadonlyMap<string, string> = new Map(),
): FakeMatchBoardStore {
  const reads: FakeMatchBoardStore['reads'] = [];
  return {
    reads,
    viewerUpvotes(matchIds, userId) {
      reads.push({ matchIds, userId });
      const ids = new Set(matchIds);
      return Promise.resolve(
        new Map([...upvotes].filter(([matchId]) => ids.has(matchId))),
      );
    },
  };
}

export interface FakePairingDays extends PairingStore {
  readonly completionReads: BusinessDate[];
}

export function createFakePairingDays(
  completed: ReadonlySet<BusinessDate>,
): FakePairingDays {
  const completionReads: BusinessDate[] = [];
  const unexpected = (name: string) => () => {
    throw new Error(`この偽物では使わない: ${name}`);
  };
  return {
    completionReads,
    isDayCompleted(date) {
      completionReads.push(date);
      return Promise.resolve(completed.has(date));
    },
    beginDay: unexpected('beginDay'),
    completeDay: unexpected('completeDay'),
    pairedLaunchIds: unexpected('pairedLaunchIds'),
  };
}
