import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type {
  DirectoryListingInput,
  DirectoryListingPage,
  DirectoryListingQuery,
  DirectoryListingRow,
} from '../../../lib/core/directory/ports.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type { EntryResult } from '../../../lib/core/match/match-model.ts';
import type {
  MatchDirectory,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import type { AwardGroup } from '../../../lib/core/product/launch-summary.ts';
import type {
  LaunchRecord,
  ProductCategoryDirectory,
  ProductCategoryRecord,
  ProductDirectory,
  ProductLookupScope,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import { ListingDirectoryReader } from './directory-reader.ts';
import type {
  LaunchHighlights,
  LaunchHighlightsReader,
} from './launch-highlights-reader.ts';
import type { ItemMetric, ItemMetricsReader } from './item-metrics-reader.ts';

const NOW = fromBusinessDateTime(parseBusinessDate('2026-11-10'), {
  hour: 0,
  minute: 30,
});

const PRODUCT_A = '01JD0PROD00000000000000001';
const PRODUCT_B = '01JD0PROD00000000000000002';
const PRODUCT_C = '01JD0PROD00000000000000003';
const OWNER_A = '01JD0USER00000000000000001';
const OWNER_B = '01JD0USER00000000000000002';
const CATEGORY_ID = '01JD0CATE00000000000000001';

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

const date = (value: string): BusinessDate => parseBusinessDate(value);

const launchIdOf = (productId: string): string => `launch-${productId}`;

const rowOf = (
  productId: string,
  matchDate = '2026-11-05',
  upvoteCount = 12,
): DirectoryListingRow => ({
  productId,
  baseWin: {
    launchId: launchIdOf(productId),
    matchDate: date(matchDate),
    upvoteCount,
  },
});

const summaryOf = (
  productId: string,
  ownerUserId: string,
): ProductSummaryRecord => ({
  productId,
  ownerUserId,
  handle: `handle-${productId.slice(-1)}`,
  name: `名称${productId.slice(-1)}`,
  tagline: 'タグライン',
  category: { id: CATEGORY_ID, name: '開発ツール', handle: 'devtools' },
  websiteUrl: 'https://product.example/',
  logoFileId: `logo-${productId}`,
  hidden: false,
  visible: true,
  listed: true,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
});

const launchOf = (
  productId: string,
  overrides: Partial<LaunchRecord> = {},
): LaunchRecord => ({
  launchId: launchIdOf(productId),
  productId,
  number: 1,
  launchDate: date('2026-11-05'),
  status: 'finished',
  outcome: 'won',
  decidedAt: new Date('2026-11-05T15:40:00.000Z'),
  ...overrides,
});

const qualifierOf = (
  productId: string,
  result: EntryResult,
  overrides: Partial<MatchRecord> = {},
): MatchRecord => ({
  matchId: `match-${productId}`,
  kind: 'qualifier',
  round: null,
  stage: null,
  matchDate: date('2026-11-05'),
  decision: result === 'bye' || result === 'walkover' ? result : 'votes',
  endedEarly: false,
  phase: 'finished',
  startsAt: new Date('2026-11-04T16:00:00.000Z'),
  endsAt: new Date('2026-11-05T15:40:00.000Z'),
  startedAt: new Date('2026-11-04T16:00:00.000Z'),
  decidedAt: new Date('2026-11-05T15:40:00.000Z'),
  entries: [
    {
      entryId: `entry-${productId}`,
      slot: 1,
      launchId: launchIdOf(productId),
      productId,
      ownerUserId: OWNER_A,
      upvoteCount: 12,
      lastUpvotedAt: null,
      lastUpvoteElapsedMs: null,
      forfeited: false,
      result,
    },
  ],
  ...overrides,
});

const categoryOf = (
  overrides: Partial<ProductCategoryRecord> = {},
): ProductCategoryRecord => ({
  id: CATEGORY_ID,
  name: '開発ツール',
  handle: 'devtools',
  systemDefault: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const viewerOf = (userId: string): CurrentUser => ({
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: userId,
    sessionId: '01JD0000000000000000SESS01',
  },
  user: {
    id: userId,
    pseudonymousId: 'pseudonymous-1',
    status: 'active',
    emailVerifiedAt: null,
    deletedAt: null,
    email: 'viewer@mail.example',
    nickname: '閲覧者',
    handle: 'viewer',
  },
});

const unexpected = (): never => {
  throw new Error('呼ばれない想定の照会');
};

interface FakeOptions {
  readonly page?: DirectoryListingPage;
  readonly categories?: readonly ProductCategoryRecord[];
  readonly summaries?: readonly ProductSummaryRecord[];
  readonly launches?: readonly LaunchRecord[];
  readonly matches?: readonly MatchRecord[];
  readonly awards?: ReadonlyMap<string, readonly AwardGroup[]>;
  readonly metrics?: ReadonlyMap<string, readonly ItemMetric[]>;
}

function setup(options: FakeOptions = {}) {
  const calls = {
    listing: [] as DirectoryListingInput[],
    findByHandle: [] as string[],
    findSummaries: [] as {
      readonly ids: readonly string[];
      readonly scope: ProductLookupScope;
    }[],
    listLaunches: [] as {
      readonly ids: readonly string[];
      readonly now: Date;
    }[],
    listByLaunches: [] as {
      readonly ids: readonly string[];
      readonly now: Date;
    }[],
    highlights: [] as Parameters<LaunchHighlightsReader['read']>[0][],
    metrics: [] as {
      readonly ids: readonly string[];
      readonly at: Date;
    }[],
  };
  const listing: DirectoryListingQuery = {
    page: (input) => {
      calls.listing.push(input);
      return Promise.resolve(options.page ?? { totalCount: 0, rows: [] });
    },
    countByCategory: unexpected,
  };
  const categories: ProductCategoryDirectory = {
    list: unexpected,
    findByHandle: (handle) => {
      calls.findByHandle.push(handle);
      return Promise.resolve(
        (options.categories ?? []).find(
          (category) => category.handle === handle.toLowerCase(),
        ),
      );
    },
  };
  const products: ProductDirectory = {
    findSummaries: (ids, scope) => {
      calls.findSummaries.push({ ids, scope });
      return Promise.resolve(
        new Map(
          (options.summaries ?? [])
            .filter(({ productId }) => ids.includes(productId))
            .map((summary) => [summary.productId, summary]),
        ),
      );
    },
    resolveHandle: unexpected,
    findDetail: unexpected,
    listLaunches: (ids, now) => {
      calls.listLaunches.push({ ids, now });
      return Promise.resolve(
        Map.groupBy(
          (options.launches ?? []).filter(({ productId }) =>
            ids.includes(productId),
          ),
          ({ productId }) => productId,
        ),
      );
    },
  };
  const matches: MatchDirectory = {
    findMatches: unexpected,
    listForDate: unexpected,
    listByLaunches: (ids, now) => {
      calls.listByLaunches.push({ ids, now });
      const byLaunch = new Map<string, MatchRecord[]>();
      for (const match of options.matches ?? []) {
        for (const entry of match.entries) {
          if (entry.launchId !== null && ids.includes(entry.launchId)) {
            byLaunch.set(entry.launchId, [
              ...(byLaunch.get(entry.launchId) ?? []),
              match,
            ]);
          }
        }
      }
      return Promise.resolve(byLaunch);
    },
    findQualifierResults: unexpected,
    summarizeDaily: unexpected,
  };
  const highlights: LaunchHighlightsReader = {
    read: (input) => {
      calls.highlights.push(input);
      const result: LaunchHighlights = {
        summaries: new Map(),
        awards: options.awards ?? new Map(),
      };
      return Promise.resolve(result);
    },
  };
  const metrics: ItemMetricsReader = {
    read: (ids, at) => {
      calls.metrics.push({ ids, at });
      return Promise.resolve(options.metrics ?? new Map());
    },
  };
  const reader = new ListingDirectoryReader(
    listing,
    products,
    categories,
    matches,
    highlights,
    metrics,
  );
  return { reader, calls };
}

const read = (
  reader: ListingDirectoryReader,
  raw: Readonly<Record<string, unknown>> = {},
  viewer?: CurrentUser,
) => reader.read({ raw, viewer, now: NOW });

const ALL_UNDEFINED = {
  q: undefined,
  category: undefined,
  from: undefined,
  to: undefined,
  sort: undefined,
  page: undefined,
};

describe('DirectoryReader.read: 条件の正規化', () => {
  test('不正な値を既定にして、正規化の後の条件をappliedに載せ一覧の照会に渡す', async () => {
    const { reader, calls } = setup();

    const view = await read(reader, {
      q: '  AI  ',
      sort: 'popular',
      from: '2026-13-01',
      page: '0',
    });

    expect(view.applied).toEqual({ ...ALL_UNDEFINED, q: 'AI' });
    expect(calls.listing).toEqual([
      {
        matchExpression: '"AI"*',
        categoryId: undefined,
        from: undefined,
        to: undefined,
        sort: 'relevance',
        page: 1,
      },
    ]);
  });

  test('期間とページと並び順を一覧の照会に渡す', async () => {
    const { reader, calls } = setup({ page: { totalCount: 45, rows: [] } });

    const view = await read(reader, {
      from: '2026-11-01',
      to: '2026-11-07',
      sort: 'upvotes',
      page: '2',
    });

    expect(view.applied).toEqual({
      ...ALL_UNDEFINED,
      from: '2026-11-01',
      to: '2026-11-07',
      sort: 'upvotes',
      page: 2,
    });
    expect(calls.listing).toEqual([
      {
        matchExpression: undefined,
        categoryId: undefined,
        from: date('2026-11-01'),
        to: date('2026-11-07'),
        sort: 'upvotes',
        page: 2,
      },
    ]);
  });

  test('業務日付の今日を返す', async () => {
    const { reader } = setup();

    const view = await read(reader);

    expect(view.businessToday).toBe(date('2026-11-10'));
  });
});

describe('DirectoryReader.read: カテゴリ', () => {
  test('ハンドルを大文字小文字を区別せずに解決し、カテゴリのIDで絞り込み、登録済みのハンドルをappliedに載せる', async () => {
    const { reader, calls } = setup({ categories: [categoryOf()] });

    const view = await read(reader, { category: 'DevTools' });

    expect(calls.findByHandle).toEqual(['DevTools']);
    expect(calls.listing[0]?.categoryId).toBe(CATEGORY_ID);
    expect(view.applied.category).toBe('devtools');
  });

  test('存在しないハンドルは外して全てのカテゴリで一覧を返す', async () => {
    const { reader, calls } = setup({ categories: [categoryOf()] });

    const view = await read(reader, { category: 'unknown', sort: 'oldest' });

    expect(calls.listing[0]?.categoryId).toBeUndefined();
    expect(view.applied).toEqual({ ...ALL_UNDEFINED, sort: 'oldest' });
  });

  test('ハンドルの形式に合わない値は照会せずに外す', async () => {
    const { reader, calls } = setup({ categories: [categoryOf()] });

    const view = await read(reader, { category: '../devtools' });

    expect(calls.findByHandle).toEqual([]);
    expect(calls.listing[0]?.categoryId).toBeUndefined();
    expect(view.applied.category).toBeUndefined();
  });
});

describe('DirectoryReader.read: 検索語', () => {
  test('検索語をNFKC正規化して空白で区切り、各語の前方一致の検索式と強調用の語を作る', async () => {
    const { reader, calls } = setup();

    const view = await read(reader, { q: 'Ａｉ　"tool' });

    expect(view.searchTerms).toEqual(['Ai', '"tool']);
    expect(calls.listing[0]?.matchExpression).toBe('"Ai"* """tool"*');
    expect(calls.listing[0]?.sort).toBe('relevance');
  });

  test('空白だけの検索語は検索語が無いものとして新しい順の一覧を返す', async () => {
    const { reader, calls } = setup();

    const view = await read(reader, { q: ' 　\t ', sort: 'relevance' });

    expect(view.searchTerms).toEqual([]);
    expect(view.applied).toEqual(ALL_UNDEFINED);
    expect(calls.listing[0]?.matchExpression).toBeUndefined();
    expect(calls.listing[0]?.sort).toBe('newest');
  });

  test('検索語があるときに指定した関連度以外の並び順を保つ', async () => {
    const { reader, calls } = setup();

    const view = await read(reader, { q: 'ai', sort: 'newest' });

    expect(view.applied.sort).toBe('newest');
    expect(calls.listing[0]?.sort).toBe('newest');
  });
});

describe('DirectoryReader.read: ページ', () => {
  test('総ページ数を超えるページは空の一覧と総件数を返し、プロダクト・マッチ・供給元を照会しない', async () => {
    const { reader, calls } = setup({ page: { totalCount: 25, rows: [] } });

    const view = await read(reader, { page: '5' });

    expect(view).toMatchObject({
      totalCount: 25,
      page: 5,
      pageCount: 2,
      items: [],
    });
    expect(calls.findSummaries).toEqual([]);
    expect(calls.listLaunches).toEqual([]);
    expect(calls.listByLaunches).toEqual([]);
    expect(calls.highlights).toEqual([]);
    expect(calls.metrics).toEqual([]);
  });

  test('掲載の無いときはページ数を0にする', async () => {
    const { reader } = setup();

    const view = await read(reader);

    expect(view).toMatchObject({
      totalCount: 0,
      page: 1,
      pageCount: 0,
      items: [],
    });
  });

  test('20件ちょうどは1ページ、21件は2ページにする', async () => {
    const twenty = await read(
      setup({ page: { totalCount: 20, rows: [] } }).reader,
    );
    const twentyOne = await read(
      setup({ page: { totalCount: 21, rows: [] } }).reader,
    );

    expect(twenty.pageCount).toBe(1);
    expect(twentyOne.pageCount).toBe(2);
  });
});

describe('DirectoryReader.read: 項目の組み立て', () => {
  const twoRows = {
    page: { totalCount: 2, rows: [rowOf(PRODUCT_A), rowOf(PRODUCT_B)] },
    summaries: [summaryOf(PRODUCT_A, OWNER_A), summaryOf(PRODUCT_B, OWNER_B)],
    launches: [launchOf(PRODUCT_A), launchOf(PRODUCT_B)],
    matches: [qualifierOf(PRODUCT_A, 'won'), qualifierOf(PRODUCT_B, 'won')],
  };

  test('ページのIDでプロダクト・ローンチ・マッチ・受賞・項目の値をそれぞれ1回ずつ照会する', async () => {
    const { reader, calls } = setup(twoRows);

    await read(reader);

    expect(calls.findSummaries).toEqual([
      { ids: [PRODUCT_A, PRODUCT_B], scope: 'visible' },
    ]);
    expect(calls.listLaunches).toEqual([
      { ids: [PRODUCT_A, PRODUCT_B], now: NOW },
    ]);
    expect(calls.listByLaunches).toEqual([
      { ids: [launchIdOf(PRODUCT_A), launchIdOf(PRODUCT_B)], now: NOW },
    ]);
    expect(calls.highlights).toHaveLength(1);
    expect(calls.metrics).toEqual([{ ids: [PRODUCT_A, PRODUCT_B], at: NOW }]);
  });

  test('問い合わせの後に可視でなくなった行を除き、総件数は問い合わせの値のままにする', async () => {
    const { reader, calls } = setup({
      ...twoRows,
      summaries: [summaryOf(PRODUCT_B, OWNER_B)],
    });

    const view = await read(reader);

    expect(view.items.map(({ product }) => product.productId)).toEqual([
      PRODUCT_B,
    ]);
    expect(view.totalCount).toBe(2);
    expect(calls.metrics).toEqual([{ ids: [PRODUCT_B], at: NOW }]);
    expect(
      calls.highlights[0]?.launches.map(({ productId }) => productId),
    ).toEqual([PRODUCT_B]);
  });

  test('一覧の照会の順を保つ', async () => {
    const { reader } = setup({
      ...twoRows,
      page: { totalCount: 2, rows: [rowOf(PRODUCT_B), rowOf(PRODUCT_A)] },
    });

    const view = await read(reader);

    expect(view.items.map(({ product }) => product.productId)).toEqual([
      PRODUCT_B,
      PRODUCT_A,
    ]);
  });

  test('閲覧者自身のプロダクトにだけ本人の印を付ける', async () => {
    const { reader } = setup(twoRows);

    const ownView = await read(reader, {}, viewerOf(OWNER_A));
    const anonymousView = await read(reader);

    expect(ownView.items.map(({ isViewerOwn }) => isViewerOwn)).toEqual([
      true,
      false,
    ]);
    expect(anonymousView.items.map(({ isViewerOwn }) => isViewerOwn)).toEqual([
      false,
      false,
    ]);
  });

  test('基準勝利の実施日とUpvote数と、予選のマッチから決めた勝利の種類を返す', async () => {
    const { reader } = setup({
      page: {
        totalCount: 3,
        rows: [
          rowOf(PRODUCT_A, '2026-11-05', 30),
          rowOf(PRODUCT_B, '2026-11-04', 0),
          rowOf(PRODUCT_C, '2026-11-03', 7),
        ],
      },
      summaries: [
        summaryOf(PRODUCT_A, OWNER_A),
        summaryOf(PRODUCT_B, OWNER_B),
        summaryOf(PRODUCT_C, OWNER_B),
      ],
      matches: [
        qualifierOf(PRODUCT_A, 'won'),
        qualifierOf(PRODUCT_B, 'bye'),
        qualifierOf(PRODUCT_C, 'walkover', { endedEarly: true }),
      ],
    });

    const view = await read(reader);

    expect(view.items.map(({ baseWin }) => baseWin)).toEqual([
      { launchDate: date('2026-11-05'), kind: 'victory', upvoteCount: 30 },
      { launchDate: date('2026-11-04'), kind: 'bye', upvoteCount: null },
      { launchDate: date('2026-11-03'), kind: 'early', upvoteCount: 7 },
    ]);
  });

  test('基準勝利のローンチのトーナメントのマッチではなく予選のマッチで種類を決める', async () => {
    const tournament: MatchRecord = {
      ...qualifierOf(PRODUCT_A, 'bye'),
      matchId: 'match-week',
      kind: 'week',
      round: 1,
      matchDate: date('2026-11-08'),
    };
    const { reader } = setup({
      page: { totalCount: 1, rows: [rowOf(PRODUCT_A)] },
      summaries: [summaryOf(PRODUCT_A, OWNER_A)],
      matches: [tournament, qualifierOf(PRODUCT_A, 'won')],
    });

    const view = await read(reader);

    expect(view.items[0]?.baseWin.kind).toBe('victory');
  });

  test('基準勝利のマッチが見つからない項目は勝利として返し、プロダクトのIDと件数だけを警告のログに残す', async () => {
    const { reader } = setup({
      page: { totalCount: 1, rows: [rowOf(PRODUCT_A, '2026-11-05', 9)] },
      summaries: [summaryOf(PRODUCT_A, OWNER_A)],
      matches: [],
    });

    const view = await read(reader, { q: '秘密の検索語' });

    expect(view.items[0]?.baseWin).toEqual({
      launchDate: date('2026-11-05'),
      kind: 'victory',
      upvoteCount: 9,
    });
    const warnings = records.filter(({ level }) => level === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.category).toEqual(['api', 'application', 'directory']);
    expect(warnings[0]?.properties).toEqual({
      count: 1,
      productIds: [PRODUCT_A],
    });
    expect(JSON.stringify(warnings[0]?.message)).not.toContain('秘密');
  });

  test('受賞は取消を除いたページのローンチで読み、プロダクトごとの受賞と項目の値を付ける', async () => {
    const canceled = launchOf(PRODUCT_A, {
      launchId: 'launch-canceled',
      number: 0,
      status: 'canceled',
      outcome: null,
      decidedAt: null,
    });
    const relaunch = launchOf(PRODUCT_A, {
      launchId: 'launch-relaunch',
      number: 2,
      launchDate: date('2026-11-12'),
      status: 'scheduled',
      outcome: null,
      decidedAt: null,
    });
    const awards: readonly AwardGroup[] = [
      { kind: 'year', count: 1, labels: ['2026年'] },
    ];
    const { reader, calls } = setup({
      ...twoRows,
      launches: [relaunch, canceled, launchOf(PRODUCT_A), launchOf(PRODUCT_B)],
      awards: new Map([
        [PRODUCT_A, awards],
        [PRODUCT_B, []],
      ]),
      metrics: new Map([
        [PRODUCT_A, [{ key: 'comments', value: 3 }]],
        [PRODUCT_B, []],
      ]),
    });

    const view = await read(reader);

    expect(calls.highlights).toEqual([
      {
        launches: [relaunch, launchOf(PRODUCT_A), launchOf(PRODUCT_B)],
        at: NOW,
      },
    ]);
    expect(view.items.map(({ awards: groups }) => groups)).toEqual([
      awards,
      [],
    ]);
    expect(view.items.map(({ metrics }) => metrics)).toEqual([
      [{ key: 'comments', value: 3 }],
      [],
    ]);
  });

  test('受賞と項目の値の無いプロダクトは空の一覧にする', async () => {
    const { reader } = setup({ ...twoRows, launches: [] });

    const view = await read(reader);

    expect(
      view.items.map(({ awards, metrics }) => ({ awards, metrics })),
    ).toEqual([
      { awards: [], metrics: [] },
      { awards: [], metrics: [] },
    ]);
  });

  test('項目にプロダクトの要約を載せる', async () => {
    const { reader } = setup(twoRows);

    const view = await read(reader);

    expect(view.items[0]?.product).toEqual(summaryOf(PRODUCT_A, OWNER_A));
  });
});
