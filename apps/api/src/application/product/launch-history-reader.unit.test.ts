import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import { AppError } from '../../../lib/core/errors/app-error.ts';
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
  RegisteredDecisionSource,
} from './decision-sources.ts';
import {
  LAUNCH_HISTORY_PAGE_MAX,
  StoreLaunchHistoryReader,
} from './launch-history-reader.ts';
import { encodeMyProductsCursor } from './my-products-cursor.ts';
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
  number: number,
  launchDate: string,
  status: LaunchStatus,
  outcome: QualifierOutcome | null = null,
): LaunchRecord => ({
  launchId,
  productId,
  number,
  launchDate: day(launchDate),
  status,
  outcome,
  decidedAt:
    outcome === null
      ? null
      : fromBusinessDateTime(day(launchDate), { hour: 23, minute: 50 }),
});

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

const firstPage = { userHandle: 'target', first: 20, after: undefined };

describe('LaunchHistoryReader.list: 表示できる利用者', () => {
  test('解決できない利用者(存在しない・退会済み)はnullにして、プロダクトを読まない', async () => {
    const { reader, calls } = setup({ resolution: { kind: 'none' } });

    expect(await reader.list(SESSION, firstPage)).toBeNull();
    expect(calls).not.toContain('history.list');
    expect(calls).not.toContain('history.count');
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

    expect(await reader.list(SESSION, firstPage)).toBeNull();
    expect(calls).not.toContain('history.list');
  });

  test('ハンドルの形式に合わない値は照会せずnullにする', async () => {
    const { reader, calls } = setup();

    expect(
      await reader.list(SESSION, { ...firstPage, userHandle: 'アリス' }),
    ).toBeNull();
    expect(calls).toEqual([]);
  });

  test('旧ハンドルはその利用者の現在のプロダクトを対象にする', async () => {
    const { reader, users, store } = setup({
      resolution: { kind: 'previous', user: userSummaryOf() },
      public: [historyProductOf(PRODUCT_A, '2026-11-01')],
    });

    const page = await reader.list(SESSION, {
      ...firstPage,
      userHandle: 'legacy',
    });

    expect(users.resolved).toEqual(['legacy']);
    expect(store.listRequests[0]?.userId).toBe(TARGET_USER_ID);
    expect(page?.totalCount).toBe(1);
  });
});

describe('LaunchHistoryReader.list: 対象の範囲と本人の印', () => {
  const owner = [
    historyProductOf(PRODUCT_A, '2026-11-01'),
    historyProductOf(PRODUCT_B, '2026-11-05', { listed: false }),
  ];
  const publicRecords = [historyProductOf(PRODUCT_A, '2026-11-01')];

  test('他人(未ログインを含む)には掲載済みの範囲を読み、本人の印を付けない', async () => {
    const { reader, store } = setup({
      viewerId: OTHER_VIEWER_ID,
      owner,
      public: publicRecords,
    });

    const page = await reader.list(SESSION, firstPage);

    expect(store.listRequests.map(({ scope }) => scope)).toEqual(['public']);
    expect(store.countRequests).toEqual([
      { userId: TARGET_USER_ID, scope: 'public' },
    ]);
    expect(page).toMatchObject({
      viewerIsOwner: false,
      ownerSuspended: false,
      totalCount: 1,
    });
    expect(page?.nodes.map(({ product }) => product.productId)).toEqual([
      PRODUCT_A,
    ]);
  });

  test('本人には未掲載を含む自分のプロダクトの範囲を読み、本人の印を付ける', async () => {
    const { reader, store } = setup({
      viewerId: TARGET_USER_ID,
      owner,
      public: publicRecords,
    });

    const page = await reader.list(SESSION, firstPage);

    expect(store.listRequests.map(({ scope }) => scope)).toEqual(['owner']);
    expect(page).toMatchObject({
      viewerIsOwner: true,
      ownerSuspended: false,
      totalCount: 2,
    });
    expect(page?.nodes.map(({ product }) => product.productId)).toEqual([
      PRODUCT_B,
      PRODUCT_A,
    ]);
  });

  test('停止中の本人には自分のプロダクトの範囲を返し、停止中の印を付ける', async () => {
    const { reader, store } = setup({
      viewerId: TARGET_USER_ID,
      resolution: {
        kind: 'current',
        user: userSummaryOf({ suspended: true }),
      },
      owner,
    });

    const page = await reader.list(SESSION, firstPage);

    expect(store.listRequests.map(({ scope }) => scope)).toEqual(['owner']);
    expect(page).toMatchObject({
      viewerIsOwner: true,
      ownerSuspended: true,
      totalCount: 2,
    });
  });

  test('項目のプロダクトは、並びの位置の値を除いたプロダクトの要約にする', async () => {
    const { reader } = setup({ public: publicRecords });

    const page = await reader.list(SESSION, firstPage);

    const { latestLaunchDate, ...summary } = historyProductOf(
      PRODUCT_A,
      '2026-11-01',
    );

    expect(latestLaunchDate).toEqual(day('2026-11-01'));
    expect(page?.nodes[0]?.product).toStrictEqual(summary);
  });
});

describe('LaunchHistoryReader.list: ページ', () => {
  const many = Array.from({ length: 21 }, (_, index) =>
    historyProductOf(
      `01JD0PROD${String(index + 1).padStart(17, '0')}`,
      `2026-10-${String(index + 1).padStart(2, '0')}`,
    ),
  );

  test('1件多く読み、先頭のfirst件と続きの有無と最後の項目の位置のカーソルを返す', async () => {
    const { reader, store } = setup({ public: many });

    const page = await reader.list(SESSION, firstPage);

    expect(store.listRequests[0]).toEqual({
      userId: TARGET_USER_ID,
      scope: 'public',
      limit: 21,
      before: undefined,
    });
    expect(page?.nodes).toHaveLength(20);
    expect(page?.hasNextPage).toBe(true);
    expect(page?.totalCount).toBe(21);
    expect(page?.endCursor).toBe(
      encodeMyProductsCursor({
        latestLaunchDate: day('2026-10-02'),
        id: '01JD0PROD00000000000000002',
      }),
    );
  });

  test('カーソルの位置より後から続きを返し、最後のページは続きが無い', async () => {
    const { reader, store } = setup({ public: many });
    const after = encodeMyProductsCursor({
      latestLaunchDate: day('2026-10-02'),
      id: '01JD0PROD00000000000000002',
    });

    const page = await reader.list(SESSION, { ...firstPage, after });

    expect(store.listRequests[0]?.before).toEqual({
      latestLaunchDate: day('2026-10-02'),
      id: '01JD0PROD00000000000000002',
    });
    expect(page?.nodes.map(({ product }) => product.productId)).toEqual([
      '01JD0PROD00000000000000001',
    ]);
    expect(page?.hasNextPage).toBe(false);
  });

  test('0件は空の一覧でカーソルがnullになり、ローンチと供給元を呼ばない', async () => {
    const source = createFakeSummarySource('spec-test.summary', () =>
      Promise.resolve({ launches: [], awards: [] }),
    );
    const { reader, calls } = setup({ sources: [source.registered] });

    const page = await reader.list(SESSION, firstPage);

    expect(page).toEqual({
      viewerIsOwner: false,
      ownerSuspended: false,
      totalCount: 0,
      nodes: [],
      hasNextPage: false,
      endCursor: null,
    });
    expect(calls).not.toContain('directory.listLaunches');
    expect(source.inputs).toEqual([]);
  });

  test('不正なカーソルはinvalid_cursorにして読まない', async () => {
    const { reader, calls } = setup();

    const error = await reader
      .list(SESSION, { ...firstPage, after: 'not-a-cursor' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'invalid_cursor' });
    expect(calls).toEqual([]);
  });

  test.each([0, LAUNCH_HISTORY_PAGE_MAX + 1, 1.5])(
    '件数%pは1〜20の範囲外のためRangeErrorにする',
    async (first) => {
      const { reader, calls } = setup();
      let rejection: unknown;

      try {
        await reader.list(SESSION, { ...firstPage, first });
      } catch (error: unknown) {
        rejection = error;
      }

      expect(rejection).toBeInstanceOf(RangeError);
      expect(calls).toEqual([]);
    },
  );

  test('1ページの上限は20件である', () => {
    expect(LAUNCH_HISTORY_PAGE_MAX).toBe(20);
  });
});

describe('LaunchHistoryReader.list: ローンチと要約', () => {
  const product = [historyProductOf(PRODUCT_A, '2026-11-20')];

  test('ローンチを1回でまとめて読み、取消を除いて番号付きで新しい順に返す', async () => {
    const { reader, launches } = setup({
      public: [...product, historyProductOf(PRODUCT_B, '2026-11-01')],
      launches: new Map([
        [
          PRODUCT_A,
          [
            launchOf('l-a3', PRODUCT_A, 2, '2026-11-20', 'scheduled'),
            launchOf('l-a2', PRODUCT_A, 0, '2026-11-15', 'canceled'),
            launchOf('l-a1', PRODUCT_A, 1, '2026-11-01', 'finished', 'won'),
          ],
        ],
      ]),
    });

    const page = await reader.list(SESSION, firstPage);

    expect(launches.requests).toEqual([[PRODUCT_A, PRODUCT_B]]);
    expect(
      page?.nodes[0]?.launches.map(({ launchId, number }) => [
        launchId,
        number,
      ]),
    ).toEqual([
      ['l-a3', 2],
      ['l-a1', 1],
    ]);
    expect(page?.nodes[1]?.launches).toEqual([]);
  });

  test('供給の無いローンチは予選の結果から要約を作る(キックオフ予定・予選マッチ中・ディレクトリ掲載・予選敗北)', async () => {
    const { reader } = setup({
      public: product,
      launches: new Map([
        [
          PRODUCT_A,
          [
            launchOf('l-5', PRODUCT_A, 5, '2026-11-20', 'scheduled'),
            launchOf('l-4', PRODUCT_A, 4, '2026-11-11', 'paired'),
            launchOf('l-3', PRODUCT_A, 3, '2026-11-10', 'in_progress'),
            launchOf('l-2', PRODUCT_A, 2, '2026-11-05', 'finished', 'won'),
            launchOf('l-1', PRODUCT_A, 1, '2026-11-01', 'finished', 'lost'),
          ],
        ],
      ]),
    });

    const page = await reader.list(SESSION, firstPage);

    expect(page?.nodes[0]?.launches.map(({ summary }) => summary)).toEqual([
      { label: 'キックオフ予定', inMatch: false },
      { label: 'キックオフ予定', inMatch: false },
      { label: '予選マッチ中', inMatch: true },
      { label: 'ディレクトリ掲載', inMatch: false },
      { label: '予選敗北', inMatch: false },
    ]);
    expect(page?.nodes[0]?.awards).toEqual([]);
  });

  test('供給元へは取消を除くローンチを時刻と共に渡し、複数の供給元の要約は順位の大きい方を採る', async () => {
    const low = createFakeSummarySource('spec-test.low', () =>
      Promise.resolve({
        launches: [
          { launchId: 'l-2', label: '低い要約', inMatch: false, rank: 1 },
          { launchId: 'l-1', label: '低い要約1', inMatch: false, rank: 5 },
        ],
        awards: [],
      }),
    );
    const high = createFakeSummarySource('spec-test.high', () =>
      Promise.resolve({
        launches: [
          { launchId: 'l-2', label: '週間2位', inMatch: true, rank: 10 },
          { launchId: 'l-1', label: '高い要約1', inMatch: false, rank: 2 },
        ],
        awards: [],
      }),
    );
    const { reader } = setup({
      public: product,
      sources: [low.registered, high.registered],
      launches: new Map([
        [
          PRODUCT_A,
          [
            launchOf('l-3', PRODUCT_A, 0, '2026-11-25', 'canceled'),
            launchOf('l-2', PRODUCT_A, 2, '2026-11-10', 'in_progress'),
            launchOf('l-1', PRODUCT_A, 1, '2026-11-01', 'finished', 'won'),
          ],
        ],
      ]),
    });

    const page = await reader.list(SESSION, firstPage);

    const expectedInput = {
      launches: [
        { launchId: 'l-2', productId: PRODUCT_A, outcome: null },
        { launchId: 'l-1', productId: PRODUCT_A, outcome: 'won' as const },
      ],
      at: NOW,
    };
    expect(low.inputs).toEqual([expectedInput]);
    expect(high.inputs).toEqual([expectedInput]);
    expect(page?.nodes[0]?.launches.map(({ summary }) => summary)).toEqual([
      { label: '週間2位', inMatch: true },
      { label: '低い要約1', inMatch: false },
    ]);
  });

  test('同じ順位の要約は登録の先の供給元のものを採る', async () => {
    const first = createFakeSummarySource('spec-test.first', () =>
      Promise.resolve({
        launches: [{ launchId: 'l-1', label: '先', inMatch: false, rank: 3 }],
        awards: [],
      }),
    );
    const second = createFakeSummarySource('spec-test.second', () =>
      Promise.resolve({
        launches: [{ launchId: 'l-1', label: '後', inMatch: false, rank: 3 }],
        awards: [],
      }),
    );
    const { reader } = setup({
      public: product,
      sources: [first.registered, second.registered],
      launches: new Map([
        [
          PRODUCT_A,
          [launchOf('l-1', PRODUCT_A, 1, '2026-11-01', 'finished', 'won')],
        ],
      ]),
    });

    const page = await reader.list(SESSION, firstPage);

    expect(page?.nodes[0]?.launches[0]?.summary.label).toBe('先');
  });

  test('供給元の例外ではその供給元を除き、要約の無いローンチは予選の結果から作って警告のログを残す', async () => {
    const failing = createFakeSummarySource('spec-test.failing', () =>
      Promise.reject(new Error('利用者alice@mail.exampleの内部の値')),
    );
    const partial = createFakeSummarySource('spec-test.partial', () =>
      Promise.resolve({
        launches: [
          { launchId: 'l-2', label: '週間1位', inMatch: false, rank: 1 },
        ],
        awards: [{ productId: PRODUCT_A, kind: 'week', label: '2026年第45週' }],
      }),
    );
    const { reader } = setup({
      public: product,
      sources: [failing.registered, partial.registered],
      launches: new Map([
        [
          PRODUCT_A,
          [
            launchOf('l-2', PRODUCT_A, 2, '2026-11-05', 'finished', 'won'),
            launchOf('l-1', PRODUCT_A, 1, '2026-11-01', 'finished', 'lost'),
          ],
        ],
      ]),
    });

    const page = await reader.list(SESSION, firstPage);

    expect(page?.nodes[0]?.launches.map(({ summary }) => summary)).toEqual([
      { label: '週間1位', inMatch: false },
      { label: '予選敗北', inMatch: false },
    ]);
    expect(page?.nodes[0]?.awards).toEqual([
      { kind: 'week', count: 1, labels: ['2026年第45週'] },
    ]);
    const warnings = records.filter(({ level }) => level === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.properties).toEqual({
      sourceName: 'spec-test.failing',
    });
  });

  test('受賞はプロダクトごとに種類でまとめ、Yearを先頭にしてラベルは受け取った順にする', async () => {
    const tournament = createFakeSummarySource('spec-test.tournament', () =>
      Promise.resolve({
        launches: [],
        awards: [
          { productId: PRODUCT_A, kind: 'week', label: '2026年第40週' },
          { productId: PRODUCT_B, kind: 'week', label: '2026年第41週' },
          { productId: PRODUCT_A, kind: 'year', label: '2025年' },
          { productId: PRODUCT_A, kind: 'week', label: '2026年第44週' },
          { productId: 'not-in-page', kind: 'year', label: '2024年' },
        ],
      }),
    );
    const extra = createFakeSummarySource('spec-test.extra', () =>
      Promise.resolve({
        launches: [],
        awards: [{ productId: PRODUCT_A, kind: 'week', label: '2026年第45週' }],
      }),
    );
    const { reader } = setup({
      public: [
        historyProductOf(PRODUCT_A, '2026-11-20'),
        historyProductOf(PRODUCT_B, '2026-11-01'),
      ],
      sources: [tournament.registered, extra.registered],
      launches: new Map([
        [
          PRODUCT_A,
          [launchOf('l-a', PRODUCT_A, 1, '2026-11-01', 'finished', 'won')],
        ],
        [
          PRODUCT_B,
          [launchOf('l-b', PRODUCT_B, 1, '2026-11-01', 'finished', 'won')],
        ],
      ]),
    });

    const page = await reader.list(SESSION, firstPage);

    expect(page?.nodes[0]?.awards).toEqual([
      { kind: 'year', count: 1, labels: ['2025年'] },
      {
        kind: 'week',
        count: 3,
        labels: ['2026年第40週', '2026年第44週', '2026年第45週'],
      },
    ]);
    expect(page?.nodes[1]?.awards).toEqual([
      { kind: 'week', count: 1, labels: ['2026年第41週'] },
    ]);
  });

  test('ページのローンチが取消だけなら供給元を呼ばない', async () => {
    const source = createFakeSummarySource('spec-test.summary', () =>
      Promise.resolve({ launches: [], awards: [] }),
    );
    const { reader } = setup({
      viewerId: TARGET_USER_ID,
      owner: product,
      sources: [source.registered],
      launches: new Map([
        [PRODUCT_A, [launchOf('l-1', PRODUCT_A, 0, '2026-11-20', 'canceled')]],
      ]),
    });

    const page = await reader.list(SESSION, firstPage);

    expect(source.inputs).toEqual([]);
    expect(page?.nodes[0]?.launches).toEqual([]);
  });
});
