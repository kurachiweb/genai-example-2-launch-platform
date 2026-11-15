import type {
  UserHandleResolution,
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../../../lib/core/profile/ports.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../../lib/core/time/business-time.ts';
import type {
  UpvoteHistoryPosition,
  UpvoteHistoryRecord,
  UpvoteHistoryStore,
} from '../ports.ts';
import { viewMatchIdOf, viewProductIdOf } from './view-fakes.ts';

export const HISTORY_USER_ID = '01JC0USER00000000000000009';

export const HISTORY_HANDLE = 'supporter';

export const historyUpvoteIdOf = (index: number): string =>
  `01JF0UPVOTE${String(index).padStart(15, '0')}`;

export const historyUserOf = (
  overrides: Partial<UserSummaryRecord> = {},
): UserSummaryRecord => ({
  userId: HISTORY_USER_ID,
  handle: HISTORY_HANDLE,
  nickname: 'サポーター',
  avatarFileId: null,
  suspended: false,
  ...overrides,
});

// マッチindexの1つ目の側へのUpvote
export function historyRecordOf(
  index: number,
  matchDate: string,
  upvotedAt: Date,
): UpvoteHistoryRecord {
  return {
    upvoteId: historyUpvoteIdOf(index),
    matchId: viewMatchIdOf(index),
    entryId: `${viewMatchIdOf(index)}-1`,
    productId: viewProductIdOf(index, 1),
    matchDate: parseBusinessDate(matchDate),
    upvotedAt,
  };
}

export interface FakeUserProfileDirectory extends UserProfileDirectory {
  readonly resolved: string[];
}

export function createFakeUserProfileDirectory(
  resolution: UserHandleResolution,
): FakeUserProfileDirectory {
  const resolved: string[] = [];
  return {
    resolved,
    findSummaries() {
      throw new Error('この偽物では使わない: findSummaries');
    },
    resolveHandle(handle) {
      resolved.push(handle);
      return Promise.resolve(resolution);
    },
  };
}

export interface FakeUpvoteHistoryStore extends UpvoteHistoryStore {
  readonly counts: string[];
  readonly lists: {
    readonly userId: string;
    readonly limit: number;
    readonly before: UpvoteHistoryPosition | undefined;
  }[];
  readonly dateCounts: {
    readonly userId: string;
    readonly dates: readonly BusinessDate[];
  }[];
}

const keyOf = (record: UpvoteHistoryRecord): string =>
  `${record.matchDate}:${String(record.upvotedAt.getTime()).padStart(15, '0')}:${record.upvoteId}`;

// D1の実装と同じく、位置のマッチの行が無ければ位置の実施日より前だけを返す
function isAfter(
  records: readonly UpvoteHistoryRecord[],
  record: UpvoteHistoryRecord,
  before: UpvoteHistoryPosition | undefined,
): boolean {
  if (before === undefined) {
    return true;
  }
  const anchor = records.find(
    (candidate) =>
      candidate.matchId === before.matchId &&
      candidate.matchDate === before.matchDate,
  );
  if (anchor === undefined) {
    return record.matchDate < before.matchDate;
  }
  return keyOf(record) < keyOf(anchor);
}

// recordsは実施日・Upvoteの日時・IDの新しい順に渡す。件数と日ごとの件数は除外を含めた総数として別に渡す
export function createFakeUpvoteHistoryStore(
  records: readonly UpvoteHistoryRecord[],
  totals: {
    readonly count: number;
    readonly byDate: ReadonlyMap<string, number>;
  },
): FakeUpvoteHistoryStore {
  const counts: string[] = [];
  const lists: FakeUpvoteHistoryStore['lists'] = [];
  const dateCounts: FakeUpvoteHistoryStore['dateCounts'] = [];
  return {
    counts,
    lists,
    dateCounts,
    count(userId) {
      counts.push(userId);
      return Promise.resolve(totals.count);
    },
    list(input) {
      lists.push(input);
      return Promise.resolve(
        records
          .filter((record) => isAfter(records, record, input.before))
          .slice(0, input.limit),
      );
    },
    countByDates(userId, dates) {
      dateCounts.push({ userId, dates });
      return Promise.resolve(
        new Map(dates.map((date) => [date, totals.byDate.get(date) ?? 0])),
      );
    },
  };
}
