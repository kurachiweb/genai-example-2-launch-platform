import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type { MatchRecord } from '../../../lib/core/match/ports.ts';
import type { ProductSummaryRecord } from '../../../lib/core/product/ports.ts';
import type { UserHandleResolution } from '../../../lib/core/profile/ports.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import type { UpvoteHistoryRecord } from './ports.ts';
import {
  createFakeKickoffProductDirectory,
  productSummaryOf,
} from './testing/kickoff-fakes.ts';
import {
  createFakeUpvoteHistoryStore,
  createFakeUserProfileDirectory,
  HISTORY_HANDLE,
  HISTORY_USER_ID,
  historyRecordOf,
  historyUpvoteIdOf,
  historyUserOf,
} from './testing/upvote-history-fakes.ts';
import { voterOf } from './testing/upvote-fakes.ts';
import {
  createFakeMatchDirectory,
  matchRecordOf,
  VIEW_NOW,
  VIEW_WINDOW,
  viewMatchIdOf,
  viewOwnerIdOf,
  viewProductIdOf,
} from './testing/view-fakes.ts';
import {
  decodeUpvoteHistoryCursor,
  encodeUpvoteHistoryCursor,
} from './upvote-history-cursor.ts';
import {
  StoreUpvoteHistoryReader,
  UPVOTE_HISTORY_PAGE_MAX,
} from './upvote-history-reader.ts';

const TODAY = '2027-03-03';

const YESTERDAY = '2027-03-02';

const secondsBeforeNow = (seconds: number): Date =>
  new Date(VIEW_NOW.getTime() - seconds * 1000);

const AFTER_FULL_TIME = new Date(VIEW_WINDOW.endsAt.getTime() + 60_000);

// 1: 当日のマッチ中の予選 / 2: 当日の集計中の予選 / 3: 前日のWeek準決勝 / 4: 前日の確定した予選
const RECORDS: readonly UpvoteHistoryRecord[] = [
  historyRecordOf(1, TODAY, secondsBeforeNow(10)),
  historyRecordOf(2, TODAY, secondsBeforeNow(20)),
  historyRecordOf(3, YESTERDAY, secondsBeforeNow(86_400)),
  historyRecordOf(4, YESTERDAY, secondsBeforeNow(86_500)),
];

const MATCHES: readonly MatchRecord[] = [
  matchRecordOf(1),
  matchRecordOf(2, { now: AFTER_FULL_TIME }),
  matchRecordOf(3, {
    kind: 'week',
    round: 2,
    stage: 'semifinal',
    matchDate: parseBusinessDate(YESTERDAY),
  }),
  matchRecordOf(4, {
    matchDate: parseBusinessDate(YESTERDAY),
    decidedAt: secondsBeforeNow(80_000),
  }),
];

const TOTALS = {
  count: 9,
  byDate: new Map([
    [TODAY, 5],
    [YESTERDAY, 4],
  ]),
};

const summariesOf = (
  indexes: readonly number[],
): readonly ProductSummaryRecord[] =>
  indexes.map((index) =>
    productSummaryOf(viewProductIdOf(index, 1), {
      ownerUserId: viewOwnerIdOf(index, 1),
      listed: index % 2 === 1,
    }),
  );

interface ReaderOptions {
  readonly resolution?: UserHandleResolution;
  readonly records?: readonly UpvoteHistoryRecord[];
  readonly matches?: readonly MatchRecord[];
  readonly summaries?: readonly ProductSummaryRecord[];
}

function readerOf(options: ReaderOptions = {}) {
  const users = createFakeUserProfileDirectory(
    options.resolution ?? { kind: 'current', user: historyUserOf() },
  );
  const store = createFakeUpvoteHistoryStore(
    options.records ?? RECORDS,
    TOTALS,
  );
  const matches = createFakeMatchDirectory(options.matches ?? MATCHES);
  const products = createFakeKickoffProductDirectory(
    options.summaries ?? summariesOf([1, 2, 3, 4]),
    [],
  );
  return {
    users,
    store,
    matches,
    products,
    reader: new StoreUpvoteHistoryReader(users, store, matches, products),
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('拒否されませんでした');
}

const inputOf = (
  overrides: Partial<{
    readonly userHandle: string;
    readonly viewer: CurrentUser | undefined;
    readonly first: number;
    readonly after: string | undefined;
  }> = {},
) => ({
  userHandle: HISTORY_HANDLE,
  viewer: undefined,
  first: UPVOTE_HISTORY_PAGE_MAX,
  after: undefined,
  now: VIEW_NOW,
  ...overrides,
});

describe('StoreUpvoteHistoryReader.read の対象の利用者', () => {
  test.each<[string, ReaderOptions, CurrentUser | undefined]>([
    [
      '退会済みまたは存在しない利用者',
      { resolution: { kind: 'none' } },
      undefined,
    ],
    [
      '未ログインの閲覧者から見た停止中の利用者',
      {
        resolution: {
          kind: 'current',
          user: historyUserOf({ suspended: true }),
        },
      },
      undefined,
    ],
    [
      '本人以外から見た停止中の利用者',
      {
        resolution: {
          kind: 'current',
          user: historyUserOf({ suspended: true }),
        },
      },
      voterOf(),
    ],
  ])('%sはnullを返し、履歴を読まない', async (_label, options, viewer) => {
    const { reader, store } = readerOf(options);

    const page = await reader.read(inputOf({ viewer }));

    expect(page).toBeNull();
    expect(store.counts).toEqual([]);
    expect(store.lists).toEqual([]);
  });

  test('ハンドルの形式に合わない値は利用者を引かずにnullを返す', async () => {
    const { reader, users } = readerOf();

    const page = await reader.read(inputOf({ userHandle: '-supporter' }));

    expect(page).toBeNull();
    expect(users.resolved).toEqual([]);
  });

  test('停止中の本人には自分の履歴を返す', async () => {
    const { reader, store } = readerOf({
      resolution: { kind: 'current', user: historyUserOf({ suspended: true }) },
    });

    const page = await reader.read(
      inputOf({
        viewer: voterOf({ id: HISTORY_USER_ID, status: 'suspended' }),
      }),
    );

    expect(page?.totalCount).toBe(TOTALS.count);
    expect(store.counts).toEqual([HISTORY_USER_ID]);
  });

  test('旧ハンドルはその利用者の履歴として返す', async () => {
    const { reader, store } = readerOf({
      resolution: { kind: 'previous', user: historyUserOf() },
    });

    const page = await reader.read(inputOf({ userHandle: 'old-supporter' }));

    expect(page?.entries).toHaveLength(RECORDS.length);
    expect(store.lists.map((list) => list.userId)).toEqual([HISTORY_USER_ID]);
  });
});

describe('StoreUpvoteHistoryReader.read の項目', () => {
  test('有効なUpvoteを新しい順に、種別・ラウンド・段階・実施日・マッチ中の印・プロダクト・投稿者と組み立てる', async () => {
    const { reader } = readerOf();

    const page = await reader.read(inputOf());

    expect(page?.entries).toEqual([
      {
        upvoteId: historyUpvoteIdOf(1),
        matchId: viewMatchIdOf(1),
        kind: 'qualifier',
        round: null,
        stage: null,
        matchDate: parseBusinessDate(TODAY),
        live: true,
        product: {
          productId: viewProductIdOf(1, 1),
          handle: `handle-${viewProductIdOf(1, 1)}`,
          name: `名称${viewProductIdOf(1, 1)}`,
          tagline: `タグライン${viewProductIdOf(1, 1)}`,
          categoryId: 'category-1',
          websiteUrl: 'https://product.example/',
          logoFileId: `logo-${viewProductIdOf(1, 1)}`,
          listed: true,
        },
        ownerUserId: viewOwnerIdOf(1, 1),
      },
      expect.objectContaining({
        upvoteId: historyUpvoteIdOf(2),
        live: false,
      }),
      expect.objectContaining({
        upvoteId: historyUpvoteIdOf(3),
        kind: 'week',
        round: 2,
        stage: 'semifinal',
        matchDate: parseBusinessDate(YESTERDAY),
        live: true,
      }),
      expect.objectContaining({
        upvoteId: historyUpvoteIdOf(4),
        live: false,
      }),
    ]);
    expect(page?.entries.map((entry) => entry.product.listed)).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  test('マッチ中の印は受け付け中のマッチだけに付け、予定・集計中・確定済みには付けない', async () => {
    const { reader } = readerOf({
      matches: [
        matchRecordOf(1, { startedAt: null }),
        matchRecordOf(2, { now: AFTER_FULL_TIME }),
        matchRecordOf(3, { matchDate: parseBusinessDate(YESTERDAY) }),
        matchRecordOf(4, { decidedAt: secondsBeforeNow(80_000) }),
      ],
    });

    const page = await reader.read(inputOf());

    expect(page?.entries.map((entry) => entry.live)).toEqual([
      false,
      false,
      true,
      false,
    ]);
  });

  test('マッチとプロダクトの照会をページのIDで1回ずつ呼び、プロダクトは可視のものだけを引く', async () => {
    const { reader, matches, products } = readerOf();

    await reader.read(inputOf());

    expect(matches.findReads).toEqual([
      { matchIds: [1, 2, 3, 4].map(viewMatchIdOf), now: VIEW_NOW },
    ]);
    expect(products.summaryReads).toEqual([
      {
        productIds: [1, 2, 3, 4].map((index) => viewProductIdOf(index, 1)),
        scope: 'visible',
      },
    ]);
  });

  test('照会の間に表示できなくなったプロダクトや見つからないマッチの項目を除き、続きの位置はページの最後の行から作る', async () => {
    const { reader } = readerOf({
      matches: MATCHES.filter(({ matchId }) => matchId !== viewMatchIdOf(2)),
      summaries: [
        ...summariesOf([1, 3]),
        productSummaryOf(viewProductIdOf(4, 1), { visible: false }),
      ],
    });

    const page = await reader.read(inputOf({ first: 4 }));

    expect(page?.entries.map((entry) => entry.upvoteId)).toEqual([
      historyUpvoteIdOf(1),
      historyUpvoteIdOf(3),
    ]);
    expect(page?.dateTotals).toEqual([
      { date: parseBusinessDate(TODAY), count: 5 },
      { date: parseBusinessDate(YESTERDAY), count: 4 },
    ]);
    expect(page?.endCursor).toBe(
      encodeUpvoteHistoryCursor({
        matchDate: parseBusinessDate(YESTERDAY),
        matchId: viewMatchIdOf(4),
      }),
    );
  });
});

describe('StoreUpvoteHistoryReader.read のページ', () => {
  test('件数と、ページ内の実施日ごとの総数を新しい日の順に返し、日ごとの件数を1回で数える', async () => {
    const { reader, store } = readerOf();

    const page = await reader.read(inputOf());

    expect(page?.totalCount).toBe(TOTALS.count);
    expect(page?.dateTotals).toEqual([
      { date: parseBusinessDate(TODAY), count: 5 },
      { date: parseBusinessDate(YESTERDAY), count: 4 },
    ]);
    expect(store.dateCounts).toEqual([
      {
        userId: HISTORY_USER_ID,
        dates: [parseBusinessDate(TODAY), parseBusinessDate(YESTERDAY)],
      },
    ]);
  });

  test('続きの有無を知るためfirstより1件多く読み、firstを超えた分は返さずに続きの位置を返す', async () => {
    const { reader, store } = readerOf();

    const page = await reader.read(inputOf({ first: 2 }));

    expect(store.lists).toEqual([
      { userId: HISTORY_USER_ID, limit: 3, before: undefined },
    ]);
    expect(page?.entries.map((entry) => entry.upvoteId)).toEqual([
      historyUpvoteIdOf(1),
      historyUpvoteIdOf(2),
    ]);
    expect(page?.dateTotals).toEqual([
      { date: parseBusinessDate(TODAY), count: 5 },
    ]);
    expect(page?.hasNextPage).toBe(true);
    expect(decodeUpvoteHistoryCursor(page?.endCursor ?? 'missing')).toEqual({
      matchDate: parseBusinessDate(TODAY),
      matchId: viewMatchIdOf(2),
    });
  });

  test('続きの位置を渡すとその位置より後から読み、最後のページでは続きが無いと返す', async () => {
    const { reader, store } = readerOf();
    const after = encodeUpvoteHistoryCursor({
      matchDate: parseBusinessDate(TODAY),
      matchId: viewMatchIdOf(2),
    });

    const page = await reader.read(inputOf({ first: 2, after }));

    expect(store.lists[0]?.before).toEqual(decodeUpvoteHistoryCursor(after));
    expect(page?.entries.map((entry) => entry.upvoteId)).toEqual([
      historyUpvoteIdOf(3),
      historyUpvoteIdOf(4),
    ]);
    expect(page?.hasNextPage).toBe(false);
  });

  test('Upvoteが無ければ照会を追加せずに空のページを返す', async () => {
    const { reader, store, matches, products } = readerOf({ records: [] });

    const page = await reader.read(inputOf());

    expect(page).toEqual({
      totalCount: TOTALS.count,
      dateTotals: [],
      entries: [],
      hasNextPage: false,
      endCursor: null,
    });
    expect(store.dateCounts).toEqual([]);
    expect(matches.findReads).toEqual([]);
    expect(products.summaryReads).toEqual([]);
  });

  test('壊れた続きの位置はinvalid_cursorで拒否する', async () => {
    const { reader } = readerOf();

    const error = await rejectionOf(reader.read(inputOf({ after: '!!!!' })));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'invalid_cursor' });
  });

  test.each([0, UPVOTE_HISTORY_PAGE_MAX + 1, 1.5])(
    '件数%pは範囲外としてRangeErrorで拒否する',
    async (first) => {
      const { reader } = readerOf();

      const error = await rejectionOf(reader.read(inputOf({ first })));

      expect(error).toBeInstanceOf(RangeError);
    },
  );
});
