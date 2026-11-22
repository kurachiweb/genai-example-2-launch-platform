import { describe, expect, test } from 'bun:test';

import type {
  CommentExport,
  CommentExportRecord,
  RatingExport,
  RatingExportRecord,
} from '../../../../lib/core/engagement/ports.ts';
import type {
  MatchExport,
  MatchExportRecord,
  UpvoteExport,
  UpvoteExportRecord,
} from '../../../../lib/core/match/ports.ts';
import type {
  LaunchExport,
  LaunchExportRecord,
  ProductDirectory,
  ProductExport,
  ProductExportRecord,
  ProductLookupScope,
  ProductSummaryRecord,
} from '../../../../lib/core/product/ports.ts';
import type { BusinessDate } from '../../../../lib/core/time/business-time.ts';
import type {
  WeekAward,
  WeekAwardExport,
} from '../../../../lib/core/week-tournament/ports.ts';
import type {
  YearAward,
  YearAwardExport,
} from '../../../../lib/core/year-tournament/ports.ts';
import { ProductActivitySourceReader } from './product-activity-source-reader.ts';

const USER_ID = '01JD0USER00000000000000001';
const NOW = new Date('2026-11-22T00:00:00.000Z');
const AT = new Date('2026-11-01T00:00:00.000Z');

function businessDate(value: string): BusinessDate {
  return value as BusinessDate;
}

function idOf(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(4, '0')}`;
}

function productRecord(
  overrides: Partial<ProductExportRecord> = {},
): ProductExportRecord {
  return {
    id: 'P-OWN-1',
    handle: 'own-one',
    name: '自分のプロダクト',
    tagline: 'キャッチコピー',
    categoryName: 'ツール',
    websiteUrl: 'https://own.example/',
    descriptionMarkdown: '# 説明',
    logoFileId: 'F-LOGO-1',
    screenshotFileIds: ['F-SHOT-1', 'F-SHOT-2'],
    createdAt: AT,
    updatedAt: AT,
    deletedAt: null,
    hiddenByAdmin: false,
    ...overrides,
  };
}

function launchRecord(
  overrides: Partial<LaunchExportRecord> = {},
): LaunchExportRecord {
  return {
    id: 'L-1',
    productId: 'P-OWN-1',
    launchDate: businessDate('2026-11-10'),
    status: 'finished',
    ...overrides,
  };
}

function matchRecord(
  overrides: Partial<MatchExportRecord> = {},
): MatchExportRecord {
  return {
    matchId: 'M-1',
    launchId: 'L-1',
    kind: 'qualifier',
    round: null,
    date: businessDate('2026-11-10'),
    upvoteCount: 5,
    opponentUpvoteCount: 3,
    lastUpvotedAt: AT,
    result: 'won',
    ...overrides,
  };
}

function commentRecord(
  overrides: Partial<CommentExportRecord> = {},
): CommentExportRecord {
  return {
    id: 'C-1',
    productId: 'P-OWN-1',
    launchId: 'L-1',
    parentId: null,
    bodyMarkdown: '本文',
    createdAt: AT,
    editedAt: null,
    deletedAt: null,
    hiddenByAdmin: false,
    ...overrides,
  };
}

function ratingRecord(
  overrides: Partial<RatingExportRecord> = {},
): RatingExportRecord {
  return {
    productId: 'P-OWN-1',
    score: 4,
    invalidatedByAdmin: false,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function upvoteRecord(
  overrides: Partial<UpvoteExportRecord> = {},
): UpvoteExportRecord {
  return {
    matchId: 'M-1',
    matchKind: 'qualifier',
    matchDate: businessDate('2026-11-10'),
    productId: 'P-OWN-1',
    upvotedAt: AT,
    ...overrides,
  };
}

function summaryRecord(
  productId: string,
  handle: string,
  name: string,
): ProductSummaryRecord {
  return { productId, handle, name } as ProductSummaryRecord;
}

interface FakeData {
  readonly products?: readonly ProductExportRecord[];
  readonly launches?: readonly LaunchExportRecord[];
  readonly matches?: ReadonlyMap<string, readonly MatchExportRecord[]>;
  readonly weekAwards?: ReadonlyMap<string, readonly WeekAward[]>;
  readonly yearAwards?: ReadonlyMap<string, readonly YearAward[]>;
  readonly comments?: readonly CommentExportRecord[];
  readonly ratings?: readonly RatingExportRecord[];
  readonly upvotes?: readonly UpvoteExportRecord[];
  readonly summaries?: ReadonlyMap<string, ProductSummaryRecord>;
}

interface SummaryCall {
  readonly ids: readonly string[];
  readonly scope: ProductLookupScope;
}

function subMap<T>(
  source: ReadonlyMap<string, T> | undefined,
  ids: readonly string[],
): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const id of ids) {
    const value = source?.get(id);
    if (value !== undefined) {
      result.set(id, value);
    }
  }
  return result;
}

function createReader(data: FakeData = {}): {
  readonly reader: ProductActivitySourceReader;
  readonly matchCalls: (readonly string[])[];
  readonly weekCalls: (readonly string[])[];
  readonly yearCalls: (readonly string[])[];
  readonly summaryCalls: SummaryCall[];
  readonly userCalls: { readonly name: string; readonly args: unknown[] }[];
} {
  const matchCalls: (readonly string[])[] = [];
  const weekCalls: (readonly string[])[] = [];
  const yearCalls: (readonly string[])[] = [];
  const summaryCalls: SummaryCall[] = [];
  const userCalls: { readonly name: string; readonly args: unknown[] }[] = [];

  const productExport: ProductExport = {
    listByUser: (userId) => {
      userCalls.push({ name: 'ProductExport', args: [userId] });
      return Promise.resolve(data.products ?? []);
    },
  };
  const launchExport: LaunchExport = {
    listByUser: (userId, now) => {
      userCalls.push({ name: 'LaunchExport', args: [userId, now] });
      return Promise.resolve(data.launches ?? []);
    },
  };
  const matchExport: MatchExport = {
    listForLaunches: (ids) => {
      matchCalls.push(ids);
      return Promise.resolve(subMap(data.matches, ids));
    },
  };
  const weekAwardExport: WeekAwardExport = {
    listForLaunches: (ids) => {
      weekCalls.push(ids);
      return Promise.resolve(subMap(data.weekAwards, ids));
    },
  };
  const yearAwardExport: YearAwardExport = {
    listForLaunches: (ids) => {
      yearCalls.push(ids);
      return Promise.resolve(subMap(data.yearAwards, ids));
    },
  };
  const commentExport: CommentExport = {
    listByUser: (userId) => {
      userCalls.push({ name: 'CommentExport', args: [userId] });
      return Promise.resolve(data.comments ?? []);
    },
  };
  const ratingExport: RatingExport = {
    listByUser: (userId) => {
      userCalls.push({ name: 'RatingExport', args: [userId] });
      return Promise.resolve(data.ratings ?? []);
    },
  };
  const upvoteExport: UpvoteExport = {
    listByUser: (userId) => {
      userCalls.push({ name: 'UpvoteExport', args: [userId] });
      return Promise.resolve(data.upvotes ?? []);
    },
  };
  const productDirectory = {
    findSummaries: (ids: readonly string[], scope: ProductLookupScope) => {
      summaryCalls.push({ ids, scope });
      return Promise.resolve(subMap(data.summaries, ids));
    },
  } as unknown as ProductDirectory;

  return {
    reader: new ProductActivitySourceReader(
      productExport,
      launchExport,
      matchExport,
      weekAwardExport,
      yearAwardExport,
      commentExport,
      ratingExport,
      upvoteExport,
      productDirectory,
    ),
    matchCalls,
    weekCalls,
    yearCalls,
    summaryCalls,
    userCalls,
  };
}

describe('ProductActivitySourceReader', () => {
  describe('プロダクトとローンチ', () => {
    test('プロダクトの項目をそのまま写し、論理削除済みと管理者による非表示の印も保つ', async () => {
      const deleted = productRecord({
        id: 'P-OWN-2',
        handle: 'own-two',
        deletedAt: NOW,
        hiddenByAdmin: true,
      });
      const { reader } = createReader({
        products: [productRecord(), deleted],
      });

      const result = await reader.read(USER_ID, NOW);

      expect(result.products).toEqual([productRecord(), deleted]);
    });

    test('上流の記録に余分な項目があっても、スナップショットのプロダクトには定めた項目だけを写す', async () => {
      const withExtras = {
        ...productRecord(),
        ownerUserId: USER_ID,
        internalMemo: '出力してはならない',
      };
      const { reader } = createReader({ products: [withExtras] });

      const result = await reader.read(USER_ID, NOW);

      expect(result.products).toEqual([productRecord()]);
      expect(Object.keys(result.products[0] ?? {}).toSorted()).toEqual(
        Object.keys(productRecord()).toSorted(),
      );
    });

    test('ローンチにマッチと週間・年間の受賞を結び付け、マッチのIDとローンチのIDの項目名を写す', async () => {
      const { reader } = createReader({
        launches: [
          launchRecord(),
          launchRecord({ id: 'L-2', status: 'scheduled' }),
        ],
        matches: new Map([
          [
            'L-1',
            [
              matchRecord(),
              matchRecord({
                matchId: 'M-2',
                kind: 'week',
                round: 2,
                result: null,
                lastUpvotedAt: null,
              }),
            ],
          ],
        ]),
        weekAwards: new Map([
          ['L-1', [{ kind: 'product_of_the_week', period: '2026-W46' }]],
        ]),
        yearAwards: new Map([
          ['L-1', [{ kind: 'product_of_the_year', period: '2026' }]],
        ]),
      });

      const result = await reader.read(USER_ID, NOW);

      expect(result.launches).toEqual([
        {
          id: 'L-1',
          productId: 'P-OWN-1',
          launchDate: '2026-11-10',
          status: 'finished',
          matches: [
            {
              id: 'M-1',
              kind: 'qualifier',
              round: null,
              date: '2026-11-10',
              upvoteCount: 5,
              opponentUpvoteCount: 3,
              lastUpvotedAt: AT,
              result: 'won',
            },
            {
              id: 'M-2',
              kind: 'week',
              round: 2,
              date: '2026-11-10',
              upvoteCount: 5,
              opponentUpvoteCount: 3,
              lastUpvotedAt: null,
              result: null,
            },
          ],
          awards: [
            { kind: 'product_of_the_week', period: '2026-W46' },
            { kind: 'product_of_the_year', period: '2026' },
          ],
        },
        {
          id: 'L-2',
          productId: 'P-OWN-1',
          launchDate: '2026-11-10',
          status: 'scheduled',
          matches: [],
          awards: [],
        },
      ]);
    });

    test('ローンチのIDを90件ずつに分けて3つの部品へ渡し、全ての結果を元のローンチへ結び付ける', async () => {
      const launches = Array.from({ length: 200 }, (_, index) =>
        launchRecord({ id: idOf('L', index) }),
      );
      const { reader, matchCalls, weekCalls, yearCalls } = createReader({
        launches,
        matches: new Map(
          launches.map((launch) => [
            launch.id,
            [matchRecord({ matchId: `M-${launch.id}`, launchId: launch.id })],
          ]),
        ),
        weekAwards: new Map([
          [
            idOf('L', 199),
            [{ kind: 'product_of_the_week', period: '2026-W1' }],
          ],
        ]),
        yearAwards: new Map([
          [idOf('L', 95), [{ kind: 'product_of_the_year', period: '2026' }]],
        ]),
      });

      const result = await reader.read(USER_ID, NOW);

      for (const calls of [matchCalls, weekCalls, yearCalls]) {
        expect(calls.map((ids) => ids.length)).toEqual([90, 90, 20]);
        expect(calls.flat()).toEqual(launches.map((launch) => launch.id));
      }
      expect(result.launches).toHaveLength(200);
      expect(result.launches.map((launch) => launch.matches[0]?.id)).toEqual(
        launches.map((launch) => `M-${launch.id}`),
      );
      expect(result.launches[199]?.awards).toEqual([
        { kind: 'product_of_the_week', period: '2026-W1' },
      ]);
      expect(result.launches[95]?.awards).toEqual([
        { kind: 'product_of_the_year', period: '2026' },
      ]);
      expect(result.launches[0]?.awards).toEqual([]);
    });

    test('ローンチが無ければマッチと受賞の部品を呼ばない', async () => {
      const { reader, matchCalls, weekCalls, yearCalls } = createReader();

      const result = await reader.read(USER_ID, NOW);

      expect(result.launches).toEqual([]);
      expect(matchCalls).toEqual([]);
      expect(weekCalls).toEqual([]);
      expect(yearCalls).toEqual([]);
    });
  });

  describe('コメント・評価・Upvote', () => {
    test('自分のプロダクトへの活動は論理削除済みを含む自分のプロダクトの名称とハンドルを使い、照会しない', async () => {
      const deleted = productRecord({
        id: 'P-OWN-2',
        handle: 'own-two',
        name: '削除済みの自分のプロダクト',
        deletedAt: NOW,
      });
      const { reader, summaryCalls } = createReader({
        products: [productRecord(), deleted],
        comments: [
          commentRecord(),
          commentRecord({ id: 'C-2', productId: 'P-OWN-2', parentId: 'C-1' }),
        ],
        ratings: [ratingRecord({ productId: 'P-OWN-2' })],
        upvotes: [upvoteRecord({ productId: 'P-OWN-2' })],
      });

      const result = await reader.read(USER_ID, NOW);

      expect(result.comments.map((comment) => comment.product)).toEqual([
        { name: '自分のプロダクト', handle: 'own-one' },
        { name: '削除済みの自分のプロダクト', handle: 'own-two' },
      ]);
      expect(result.ratings[0]?.product).toEqual({
        name: '削除済みの自分のプロダクト',
        handle: 'own-two',
      });
      expect(result.upvotes[0]?.product).toEqual({
        name: '削除済みの自分のプロダクト',
        handle: 'own-two',
      });
      expect(summaryCalls).toEqual([]);
    });

    test('コメントの項目を写し、親のコメントのIDを親コメントのIDの項目名にする', async () => {
      const edited = commentRecord({
        id: 'C-2',
        parentId: 'C-1',
        bodyMarkdown: '編集後',
        editedAt: NOW,
        deletedAt: NOW,
        hiddenByAdmin: true,
      });
      const { reader } = createReader({
        products: [productRecord()],
        comments: [commentRecord(), edited],
      });

      const result = await reader.read(USER_ID, NOW);

      expect(result.comments).toEqual([
        {
          id: 'C-1',
          launchId: 'L-1',
          product: { name: '自分のプロダクト', handle: 'own-one' },
          parentCommentId: null,
          bodyMarkdown: '本文',
          createdAt: AT,
          editedAt: null,
          deletedAt: null,
          hiddenByAdmin: false,
        },
        {
          id: 'C-2',
          launchId: 'L-1',
          product: { name: '自分のプロダクト', handle: 'own-one' },
          parentCommentId: 'C-1',
          bodyMarkdown: '編集後',
          createdAt: AT,
          editedAt: NOW,
          deletedAt: NOW,
          hiddenByAdmin: true,
        },
      ]);
    });

    test('評価は点数と無効化の印と日時を写し、入力の順を保つ', async () => {
      const { reader } = createReader({
        products: [productRecord()],
        ratings: [
          ratingRecord({ score: 5, invalidatedByAdmin: true, updatedAt: NOW }),
          ratingRecord({ score: 1 }),
        ],
      });

      const result = await reader.read(USER_ID, NOW);

      expect(result.ratings).toEqual([
        {
          product: { name: '自分のプロダクト', handle: 'own-one' },
          score: 5,
          invalidatedByAdmin: true,
          createdAt: AT,
          updatedAt: NOW,
        },
        {
          product: { name: '自分のプロダクト', handle: 'own-one' },
          score: 1,
          invalidatedByAdmin: false,
          createdAt: AT,
          updatedAt: AT,
        },
      ]);
    });

    test('Upvoteはマッチの項目とUpvoteの日時を写す', async () => {
      const { reader } = createReader({
        products: [productRecord()],
        upvotes: [
          upvoteRecord({ matchId: 'M-9', matchKind: 'year', upvotedAt: NOW }),
        ],
      });

      const result = await reader.read(USER_ID, NOW);

      expect(result.upvotes).toEqual([
        {
          matchId: 'M-9',
          matchKind: 'year',
          matchDate: '2026-11-10',
          product: { name: '自分のプロダクト', handle: 'own-one' },
          upvotedAt: NOW,
        },
      ]);
    });
  });

  describe('他者のプロダクトの名称の照会', () => {
    test('自分のプロダクトに無いプロダクトのIDだけを重複なく論理削除を除く範囲で1回に引く', async () => {
      const { reader, summaryCalls } = createReader({
        products: [productRecord()],
        comments: [
          commentRecord({ productId: 'P-OTHER-1' }),
          commentRecord({ id: 'C-2', productId: 'P-OWN-1' }),
        ],
        ratings: [
          ratingRecord({ productId: 'P-OTHER-1' }),
          ratingRecord({ productId: 'P-OTHER-2' }),
        ],
        upvotes: [
          upvoteRecord({ productId: 'P-OTHER-2' }),
          upvoteRecord({ productId: null }),
          upvoteRecord({ productId: 'P-OWN-1' }),
        ],
        summaries: new Map([
          ['P-OTHER-1', summaryRecord('P-OTHER-1', 'other-one', '他者の一')],
          ['P-OTHER-2', summaryRecord('P-OTHER-2', 'other-two', '他者の二')],
        ]),
      });

      const result = await reader.read(USER_ID, NOW);

      expect(summaryCalls).toEqual([
        { ids: ['P-OTHER-1', 'P-OTHER-2'], scope: 'not-deleted' },
      ]);
      expect(result.comments[0]?.product).toEqual({
        name: '他者の一',
        handle: 'other-one',
      });
      expect(result.ratings.map((rating) => rating.product)).toEqual([
        { name: '他者の一', handle: 'other-one' },
        { name: '他者の二', handle: 'other-two' },
      ]);
      expect(result.upvotes[0]?.product).toEqual({
        name: '他者の二',
        handle: 'other-two',
      });
    });

    test('他者のプロダクトの数が増えても照会は1回のまま', async () => {
      const ids = Array.from({ length: 500 }, (_, index) => idOf('P-X', index));
      const { reader, summaryCalls } = createReader({
        ratings: ids.map((productId) => ratingRecord({ productId })),
        comments: ids.map((productId, index) =>
          commentRecord({ id: idOf('C', index), productId }),
        ),
        upvotes: ids.map((productId) => upvoteRecord({ productId })),
        summaries: new Map(
          ids.map((id) => [id, summaryRecord(id, `h-${id}`, `n-${id}`)]),
        ),
      });

      const result = await reader.read(USER_ID, NOW);

      expect(summaryCalls).toHaveLength(1);
      expect(summaryCalls[0]?.ids).toEqual(ids);
      expect(result.ratings).toHaveLength(500);
      expect(result.ratings[499]?.product).toEqual({
        name: 'n-P-X0499',
        handle: 'h-P-X0499',
      });
    });

    test('照会で見つからない(論理削除済み・存在しない)プロダクトはnullにする', async () => {
      const { reader } = createReader({
        comments: [commentRecord({ productId: 'P-GONE' })],
        ratings: [ratingRecord({ productId: 'P-GONE' })],
        upvotes: [upvoteRecord({ productId: 'P-GONE' })],
      });

      const result = await reader.read(USER_ID, NOW);

      expect(result.comments[0]?.product).toBeNull();
      expect(result.ratings[0]?.product).toBeNull();
      expect(result.upvotes[0]?.product).toBeNull();
    });

    test('紐付けを解除済みのUpvoteはプロダクトをnullにし、照会の対象に含めない', async () => {
      const { reader, summaryCalls } = createReader({
        upvotes: [upvoteRecord({ productId: null })],
      });

      const result = await reader.read(USER_ID, NOW);

      expect(result.upvotes[0]?.product).toBeNull();
      expect(summaryCalls).toEqual([]);
    });

    test('活動が無ければ全て空で、照会もしない', async () => {
      const { reader, summaryCalls } = createReader();

      const result = await reader.read(USER_ID, NOW);

      expect(result).toEqual({
        products: [],
        launches: [],
        comments: [],
        upvotes: [],
        ratings: [],
      });
      expect(summaryCalls).toEqual([]);
    });
  });

  describe('上流の部品の呼び出し', () => {
    test('利用者のIDと現在の日時を上流の部品へ渡す', async () => {
      const { reader, userCalls } = createReader();

      await reader.read(USER_ID, NOW);

      expect(userCalls).toEqual([
        { name: 'ProductExport', args: [USER_ID] },
        { name: 'LaunchExport', args: [USER_ID, NOW] },
        { name: 'CommentExport', args: [USER_ID] },
        { name: 'RatingExport', args: [USER_ID] },
        { name: 'UpvoteExport', args: [USER_ID] },
      ]);
    });

    test('部品の例外はそのまま投げる', async () => {
      const failure = new Error('マッチの読み取りに失敗');
      const failing = new ProductActivitySourceReader(
        { listByUser: () => Promise.resolve([]) },
        { listByUser: () => Promise.resolve([launchRecord()]) },
        { listForLaunches: () => Promise.reject(failure) },
        { listForLaunches: () => Promise.resolve(new Map()) },
        { listForLaunches: () => Promise.resolve(new Map()) },
        { listByUser: () => Promise.resolve([]) },
        { listByUser: () => Promise.resolve([]) },
        { listByUser: () => Promise.resolve([]) },
        {
          findSummaries: () => Promise.resolve(new Map()),
        } as unknown as ProductDirectory,
      );

      const caught = await failing
        .read(USER_ID, NOW)
        .catch((error: unknown) => error);

      expect(caught).toBe(failure);
    });
  });
});
