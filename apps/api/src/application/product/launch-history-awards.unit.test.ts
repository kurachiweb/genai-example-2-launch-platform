import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type {
  LaunchStatus,
  QualifierOutcome,
} from '../../../lib/core/product/launch-status.ts';
import type { LaunchRecord } from '../../../lib/core/product/ports.ts';
import type { UserHandleResolution } from '../../../lib/core/profile/ports.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type {
  LaunchSummarySource,
  ProductAwardContribution,
  RegisteredDecisionSource,
} from './decision-sources.ts';
import {
  LAUNCH_HISTORY_AWARDS_PAGE_SIZE,
  StoreLaunchHistoryReader,
} from './launch-history-reader.ts';
import type { LaunchHistoryProductRecord } from './ports.ts';
import {
  createFakeAccountGuard,
  createFakeLaunchDirectory,
  createFakeLaunchHistoryStore,
  createFakeSummarySource,
  createFakeUserProfileDirectory,
  day,
  historyProductOf,
  SESSION,
  TARGET_USER_ID,
  userSummaryOf,
  viewerOf,
} from './testing/launch-history-fakes.ts';

const NOW = fromBusinessDateTime(parseBusinessDate('2026-11-10'), {
  hour: 12,
  minute: 0,
});

const OTHER_VIEWER_ID = '01JC0USER00000000000000002';

const PRODUCT_A = '01JD0PROD00000000000000001';
const PRODUCT_B = '01JD0PROD00000000000000002';

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

const launchOf = (
  launchId: string,
  productId: string,
  status: LaunchStatus,
  outcome: QualifierOutcome | null = null,
): LaunchRecord => ({
  launchId,
  productId,
  number: status === 'canceled' ? 0 : 1,
  launchDate: day('2026-11-01'),
  status,
  outcome,
  decidedAt: null,
});

const wonLaunchesOf = (
  products: readonly LaunchHistoryProductRecord[],
): ReadonlyMap<string, readonly LaunchRecord[]> =>
  new Map(
    products.map(({ productId }) => [
      productId,
      [launchOf(`l-${productId}`, productId, 'finished', 'won')],
    ]),
  );

interface SetupOptions {
  readonly resolution?: UserHandleResolution;
  readonly viewerId?: string | undefined;
  readonly owner?: readonly LaunchHistoryProductRecord[];
  readonly public?: readonly LaunchHistoryProductRecord[];
  readonly launches?: ReadonlyMap<string, readonly LaunchRecord[]>;
  readonly sources?: readonly RegisteredDecisionSource<LaunchSummarySource>[];
}

function setup(options: SetupOptions = {}) {
  const calls: string[] = [];
  const viewerId = 'viewerId' in options ? options.viewerId : undefined;
  const guard = createFakeAccountGuard(
    calls,
    viewerId === undefined ? undefined : viewerOf(viewerId),
  );
  const users = createFakeUserProfileDirectory(
    calls,
    options.resolution ?? { kind: 'current', user: userSummaryOf() },
  );
  const store = createFakeLaunchHistoryStore(calls, {
    owner: options.owner ?? [],
    public: options.public ?? [],
  });
  const launches = createFakeLaunchDirectory(
    calls,
    options.launches ?? new Map(),
  );
  const reader = new StoreLaunchHistoryReader(
    guard,
    users,
    store,
    launches.directory,
    options.sources ?? [],
    { now: () => NOW },
  );
  return { reader, calls, users, store, launches };
}

// 受け取ったローンチのプロダクトごとに、固定の受賞を1件ずつ返す
const awardPerProduct = (
  name: string,
  kind: 'week' | 'year',
  labelOf: (productId: string) => string,
) =>
  createFakeSummarySource(name, (input) =>
    Promise.resolve({
      launches: [],
      awards: [
        ...new Set(input.launches.map(({ productId }) => productId)),
      ].map((productId): ProductAwardContribution => ({
        productId,
        kind,
        label: labelOf(productId),
      })),
    }),
  );

const input = { userHandle: 'target' };

describe('LaunchHistoryReader.awards: 表示できる利用者', () => {
  test('解決できない利用者(存在しない・退会済み)はnullにして、プロダクトを読まない', async () => {
    const { reader, calls } = setup({ resolution: { kind: 'none' } });

    expect(await reader.awards(SESSION, input)).toBeNull();
    expect(calls).not.toContain('history.list');
  });

  test.each([
    ['未ログイン', undefined],
    ['他の利用者', OTHER_VIEWER_ID],
  ])('停止中の利用者は、閲覧者が%sならnullにする', async (_, viewerId) => {
    const { reader, calls } = setup({
      viewerId,
      resolution: {
        kind: 'current',
        user: userSummaryOf({ suspended: true }),
      },
    });

    expect(await reader.awards(SESSION, input)).toBeNull();
    expect(calls).not.toContain('history.list');
  });

  test('ハンドルの形式に合わない値は照会せずnullにする', async () => {
    const { reader, calls } = setup();

    expect(await reader.awards(SESSION, { userHandle: 'アリス' })).toBeNull();
    expect(calls).toEqual([]);
  });

  test('旧ハンドルはその利用者のプロダクトを対象にする', async () => {
    const { reader, users, store } = setup({
      resolution: { kind: 'previous', user: userSummaryOf() },
    });

    expect(await reader.awards(SESSION, { userHandle: 'legacy' })).toEqual([]);
    expect(users.resolved).toEqual(['legacy']);
    expect(store.listRequests[0]?.userId).toBe(TARGET_USER_ID);
  });
});

describe('LaunchHistoryReader.awards: 対象の範囲', () => {
  const listed = historyProductOf(PRODUCT_A, '2026-11-01', { name: '掲載' });
  const unlisted = historyProductOf(PRODUCT_B, '2026-11-05', {
    name: '未掲載',
    listed: false,
  });
  const scenario = (viewerId: string | undefined) =>
    setup({
      viewerId,
      owner: [listed, unlisted],
      public: [listed],
      launches: wonLaunchesOf([listed, unlisted]),
      sources: [
        awardPerProduct('spec-test.week', 'week', () => '2026年第45週')
          .registered,
      ],
    });

  test.each([
    ['未ログイン', undefined],
    ['他の利用者', OTHER_VIEWER_ID],
  ])(
    '閲覧者が%sなら掲載済みのプロダクトの受賞だけを集める',
    async (_, viewerId) => {
      const { reader, store } = scenario(viewerId);

      const awards = await reader.awards(SESSION, input);

      expect(store.listRequests.map(({ scope }) => scope)).toEqual(['public']);
      expect(awards).toEqual([
        { kind: 'week', count: 1, labels: ['掲載 2026年第45週'] },
      ]);
    },
  );

  test('本人には未掲載を含む自分のプロダクトの受賞を集める', async () => {
    const { reader, store } = scenario(TARGET_USER_ID);

    const awards = await reader.awards(SESSION, input);

    expect(store.listRequests.map(({ scope }) => scope)).toEqual(['owner']);
    expect(awards).toEqual([
      {
        kind: 'week',
        count: 2,
        labels: ['未掲載 2026年第45週', '掲載 2026年第45週'],
      },
    ]);
  });

  test('停止中の本人には自分のプロダクトの受賞を集める', async () => {
    const { reader, store } = setup({
      viewerId: TARGET_USER_ID,
      resolution: {
        kind: 'current',
        user: userSummaryOf({ suspended: true }),
      },
      owner: [unlisted],
      launches: wonLaunchesOf([unlisted]),
      sources: [
        awardPerProduct('spec-test.year', 'year', () => '2025年').registered,
      ],
    });

    expect(await reader.awards(SESSION, input)).toEqual([
      { kind: 'year', count: 1, labels: ['未掲載 2025年'] },
    ]);
    expect(store.listRequests.map(({ scope }) => scope)).toEqual(['owner']);
  });
});

describe('LaunchHistoryReader.awards: 全ページの集計', () => {
  // 最新のローンチ日が同じため、IDの降順に並ぶ
  const many = Array.from({ length: 181 }, (_, index) =>
    historyProductOf(
      `01JD0PROD${String(index + 1).padStart(17, '0')}`,
      '2026-10-01',
      { name: `P${String(index + 1)}` },
    ),
  );

  test('1ページの件数は90件である', () => {
    expect(LAUNCH_HISTORY_AWARDS_PAGE_SIZE).toBe(90);
  });

  test('91件以上の対象は最後のページまで90件ずつ読み、全ページの受賞を新しい順にまとめる', async () => {
    const source = awardPerProduct(
      'spec-test.week',
      'week',
      (productId) => `週${String(Number(productId.slice(-3)))}`,
    );
    const { reader, store, launches } = setup({
      public: many,
      launches: wonLaunchesOf(many),
      sources: [source.registered],
    });

    const awards = await reader.awards(SESSION, input);

    const newestFirst = many.toReversed();
    expect(store.listRequests).toEqual([
      {
        userId: TARGET_USER_ID,
        scope: 'public',
        limit: 90,
        before: undefined,
      },
      {
        userId: TARGET_USER_ID,
        scope: 'public',
        limit: 90,
        before: {
          latestLaunchDate: day('2026-10-01'),
          id: '01JD0PROD00000000000000092',
        },
      },
      {
        userId: TARGET_USER_ID,
        scope: 'public',
        limit: 90,
        before: {
          latestLaunchDate: day('2026-10-01'),
          id: '01JD0PROD00000000000000002',
        },
      },
    ]);
    expect(store.countRequests).toEqual([]);
    expect(launches.requests.map((ids) => ids.length)).toEqual([90, 90, 1]);
    expect(source.inputs).toHaveLength(3);
    expect(awards).toEqual([
      {
        kind: 'week',
        count: 181,
        labels: newestFirst.map(
          ({ name, productId }) =>
            `${name} 週${String(Number(productId.slice(-3)))}`,
        ),
      },
    ]);
  });

  test('対象がちょうど90件なら次のページを空として読み終える', async () => {
    const ninety = many.slice(0, 90);
    const { reader, store, launches } = setup({
      public: ninety,
      launches: wonLaunchesOf(ninety),
      sources: [
        awardPerProduct('spec-test.week', 'week', () => '週').registered,
      ],
    });

    const awards = await reader.awards(SESSION, input);

    expect(store.listRequests).toHaveLength(2);
    expect(launches.requests).toHaveLength(1);
    expect(awards?.[0]?.count).toBe(90);
  });
});

describe('LaunchHistoryReader.awards: 受賞のまとめ', () => {
  const productA = historyProductOf(PRODUCT_A, '2026-11-20', {
    name: 'Alpha',
  });
  const productB = historyProductOf(PRODUCT_B, '2026-11-01', {
    name: 'Beta',
  });

  test('ラベルはプロダクトの名称と受賞のラベルをつなぎ、Yearを先頭に種類ごとの回数と受け取った順のラベルにする', async () => {
    const tournament = createFakeSummarySource('spec-test.tournament', () =>
      Promise.resolve({
        launches: [
          { launchId: 'l-a', label: '週間1位', inMatch: false, rank: 1 },
        ],
        awards: [
          { productId: PRODUCT_A, kind: 'week', label: '2026年第40週' },
          { productId: PRODUCT_B, kind: 'week', label: '2026年第41週' },
          { productId: PRODUCT_A, kind: 'year', label: '2025年' },
          { productId: PRODUCT_A, kind: 'week', label: '2026年第44週' },
        ],
      }),
    );
    const extra = createFakeSummarySource('spec-test.extra', () =>
      Promise.resolve({
        launches: [],
        awards: [{ productId: PRODUCT_B, kind: 'year', label: '2024年' }],
      }),
    );
    const { reader } = setup({
      public: [productA, productB],
      launches: wonLaunchesOf([productA, productB]),
      sources: [tournament.registered, extra.registered],
    });

    expect(await reader.awards(SESSION, input)).toEqual([
      { kind: 'year', count: 2, labels: ['Alpha 2025年', 'Beta 2024年'] },
      {
        kind: 'week',
        count: 3,
        labels: [
          'Alpha 2026年第40週',
          'Beta 2026年第41週',
          'Alpha 2026年第44週',
        ],
      },
    ]);
  });

  test('対象でないプロダクトの受賞は除く', async () => {
    const source = createFakeSummarySource('spec-test.tournament', () =>
      Promise.resolve({
        launches: [],
        awards: [
          { productId: 'not-in-scope', kind: 'year', label: '2024年' },
          { productId: PRODUCT_A, kind: 'week', label: '2026年第40週' },
        ],
      }),
    );
    const { reader } = setup({
      public: [productA],
      launches: wonLaunchesOf([productA]),
      sources: [source.registered],
    });

    expect(await reader.awards(SESSION, input)).toEqual([
      { kind: 'week', count: 1, labels: ['Alpha 2026年第40週'] },
    ]);
  });

  test('供給元へは取消を除くローンチを時刻と共に渡し、取消だけのプロダクトは渡さない', async () => {
    const source = awardPerProduct('spec-test.week', 'week', () => '週');
    const { reader } = setup({
      viewerId: TARGET_USER_ID,
      owner: [productA, productB],
      launches: new Map([
        [
          PRODUCT_A,
          [
            launchOf('l-a2', PRODUCT_A, 'canceled'),
            launchOf('l-a1', PRODUCT_A, 'finished', 'won'),
          ],
        ],
        [PRODUCT_B, [launchOf('l-b1', PRODUCT_B, 'canceled')]],
      ]),
      sources: [source.registered],
    });

    const awards = await reader.awards(SESSION, input);

    expect(source.inputs).toEqual([
      {
        launches: [{ launchId: 'l-a1', productId: PRODUCT_A, outcome: 'won' }],
        at: NOW,
      },
    ]);
    expect(awards).toEqual([{ kind: 'week', count: 1, labels: ['Alpha 週'] }]);
  });

  test('1つの供給元の例外ではその供給元の受賞だけを除き、供給元の名前だけの警告のログを残す', async () => {
    const failing = createFakeSummarySource('spec-test.failing', () =>
      Promise.reject(new Error('利用者alice@mail.exampleの内部の値')),
    );
    const working = awardPerProduct(
      'spec-test.working',
      'year',
      () => '2025年',
    );
    const { reader } = setup({
      public: [productA],
      launches: wonLaunchesOf([productA]),
      sources: [failing.registered, working.registered],
    });

    expect(await reader.awards(SESSION, input)).toEqual([
      { kind: 'year', count: 1, labels: ['Alpha 2025年'] },
    ]);
    const warnings = records.filter(({ level }) => level === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.properties).toEqual({
      sourceName: 'spec-test.failing',
    });
  });

  test('受賞が無ければ空の配列を返す', async () => {
    const source = createFakeSummarySource('spec-test.summary', () =>
      Promise.resolve({
        launches: [
          { launchId: 'l-a', label: '週間2位', inMatch: false, rank: 1 },
        ],
        awards: [],
      }),
    );
    const { reader } = setup({
      public: [productA],
      launches: wonLaunchesOf([productA]),
      sources: [source.registered],
    });

    expect(await reader.awards(SESSION, input)).toEqual([]);
  });

  test('対象のプロダクトが無ければローンチと供給元を呼ばずに空の配列を返す', async () => {
    const source = awardPerProduct('spec-test.week', 'week', () => '週');
    const { reader, calls } = setup({ sources: [source.registered] });

    expect(await reader.awards(SESSION, input)).toEqual([]);
    expect(calls).not.toContain('directory.listLaunches');
    expect(source.inputs).toEqual([]);
  });
});
