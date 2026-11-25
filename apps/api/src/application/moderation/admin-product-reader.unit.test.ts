import { describe, expect, test } from 'bun:test';

import {
  NOW,
  PRODUCT_ID,
  OTHER_PRODUCT_ID,
  OPPONENT_PRODUCT_ID,
  DELETED_OPPONENT_PRODUCT_ID,
  OWNER_ID,
  OTHER_OWNER_ID,
  CATEGORY_ID,
  LOGO_ID,
  OTHER_LOGO_ID,
  SCREENSHOT_ID,
  QUARANTINED_SCREENSHOT_ID,
  MISSING_SCREENSHOT_ID,
  LAUNCH_ID,
  OLD_LAUNCH_ID,
  CANCELED_LAUNCH_ID,
  OPPONENT_LAUNCH_ID,
  QUALIFIER_MATCH_ID,
  WEEK_MATCH_ID,
  BYE_MATCH_ID,
  NEXT_CURSOR,
  dateOf,
  summaryOf,
  adminRecordOf,
  userOf,
  fileOf,
  launchOf,
  entryOf,
  matchOf,
  createHarness,
} from './testing/admin-product-reader-fakes.ts';

const PUBLIC_LOGO = fileOf(LOGO_ID);

const HIDDEN_LOGO = fileOf(OTHER_LOGO_ID, {
  location: 'quarantine',
  quarantined: true,
  quarantineReasons: ['product_hidden'],
});

const QUARANTINED_LOGO = fileOf(LOGO_ID, {
  location: 'quarantine',
  quarantined: true,
  quarantineReasons: ['product_hidden'],
});

const SCREENSHOT = fileOf(SCREENSHOT_ID, { purpose: 'product-screenshot' });

const QUARANTINED_SCREENSHOT = fileOf(QUARANTINED_SCREENSHOT_ID, {
  purpose: 'product-screenshot',
  location: 'quarantine',
  quarantined: true,
  quarantineReasons: ['auto', 'product_hidden'],
});

describe('DefaultAdminProductReader.list', () => {
  test('絞り込みとページと照会の時刻を上流の一覧へ渡し、投稿者とロゴをそれぞれ1回の照会でまとめて読む', async () => {
    const { reader, calls } = createHarness({
      searchResult: {
        products: [
          adminRecordOf(),
          adminRecordOf({
            productId: OTHER_PRODUCT_ID,
            ownerUserId: OTHER_OWNER_ID,
            handle: 'other-tool',
            name: '別の道具',
            logoFileId: OTHER_LOGO_ID,
            hiddenAt: new Date('2026-11-10T00:00:00.000Z'),
            visibility: 'hidden',
            latestLaunch: null,
          }),
          adminRecordOf({
            productId: OPPONENT_PRODUCT_ID,
            handle: 'third-tool',
            name: '三つ目の道具',
            visibility: 'owner_suspended',
          }),
        ],
        nextCursor: NEXT_CURSOR,
      },
      users: [
        userOf({ suspended: true }),
        userOf({
          userId: OTHER_OWNER_ID,
          handle: 'other-owner',
          nickname: '別の投稿者',
        }),
      ],
      files: [PUBLIC_LOGO, HIDDEN_LOGO],
    });

    const page = await reader.list({
      filter: {
        name: '道具',
        handle: 'tool',
        categoryId: CATEGORY_ID,
        launchState: 'won',
        visibility: 'hidden',
      },
      first: 50,
      after: 'cursor-before',
      now: NOW,
    });

    expect(calls.resolveHandle).toEqual([]);
    expect(calls.search).toEqual([
      {
        filter: {
          name: '道具',
          handle: 'tool',
          categoryId: CATEGORY_ID,
          launchState: 'won',
          visibility: 'hidden',
        },
        page: { after: 'cursor-before', limit: 50 },
        now: NOW,
      },
    ]);
    expect(calls.userSummaries).toEqual([
      { ids: [OWNER_ID, OTHER_OWNER_ID], scope: 'not-withdrawn' },
    ]);
    expect(calls.findMany).toEqual([[LOGO_ID, OTHER_LOGO_ID]]);
    expect(page.nextCursor).toBe(NEXT_CURSOR);
    expect(page.products).toEqual([
      {
        productId: PRODUCT_ID,
        handle: 'launch-stadium-tool',
        name: '試合を見守る道具',
        logo: PUBLIC_LOGO,
        owner: {
          userId: OWNER_ID,
          handle: 'owner-handle',
          nickname: '投稿者のなまえ',
          suspended: true,
        },
        category: { id: CATEGORY_ID, name: '開発' },
        latestLaunch: {
          launchId: LAUNCH_ID,
          launchDate: dateOf('2026-11-19'),
          state: 'won',
        },
        visibility: 'visible',
      },
      {
        productId: OTHER_PRODUCT_ID,
        handle: 'other-tool',
        name: '別の道具',
        logo: HIDDEN_LOGO,
        owner: {
          userId: OTHER_OWNER_ID,
          handle: 'other-owner',
          nickname: '別の投稿者',
          suspended: false,
        },
        category: { id: CATEGORY_ID, name: '開発' },
        latestLaunch: null,
        visibility: 'hidden',
      },
      {
        productId: OPPONENT_PRODUCT_ID,
        handle: 'third-tool',
        name: '三つ目の道具',
        logo: PUBLIC_LOGO,
        owner: {
          userId: OWNER_ID,
          handle: 'owner-handle',
          nickname: '投稿者のなまえ',
          suspended: true,
        },
        category: { id: CATEGORY_ID, name: '開発' },
        latestLaunch: {
          launchId: LAUNCH_ID,
          launchDate: dateOf('2026-11-19'),
          state: 'won',
        },
        visibility: 'owner_suspended',
      },
    ]);
  });

  test('投稿者のハンドルを利用者のIDに解決して絞り込みに使う', async () => {
    const { reader, calls } = createHarness({
      handleResolution: { kind: 'current', user: userOf() },
    });

    await reader.list({
      filter: { ownerHandle: 'owner-handle', visibility: 'visible' },
      first: 20,
      now: NOW,
    });

    expect(calls.resolveHandle).toEqual(['owner-handle']);
    expect(calls.search).toEqual([
      {
        filter: { ownerUserId: OWNER_ID, visibility: 'visible' },
        page: { limit: 20 },
        now: NOW,
      },
    ]);
  });

  test('投稿者の旧ハンドルはその利用者として絞り込む', async () => {
    const { reader, calls } = createHarness({
      handleResolution: {
        kind: 'previous',
        user: userOf({ handle: 'renamed-owner' }),
      },
    });

    await reader.list({
      filter: { ownerHandle: 'old-owner' },
      first: 50,
      now: NOW,
    });

    expect(calls.search.map(({ filter }) => filter)).toEqual([
      { ownerUserId: OWNER_ID },
    ]);
  });

  test('投稿者のハンドルに該当する利用者がいなければ、上流の一覧を読まずに空の結果を返す', async () => {
    const { reader, calls } = createHarness({
      handleResolution: { kind: 'none' },
    });

    const page = await reader.list({
      filter: { ownerHandle: 'nobody', name: '道具' },
      first: 50,
      after: 'cursor-before',
      now: NOW,
    });

    expect(page).toEqual({ products: [], nextCursor: null });
    expect(calls.search).toEqual([]);
    expect(calls.userSummaries).toEqual([]);
    expect(calls.findMany).toEqual([]);
  });

  test('結果が空なら表示名とロゴを読まない', async () => {
    const { reader, calls } = createHarness({
      searchResult: { products: [], nextCursor: null },
    });

    const page = await reader.list({ filter: {}, first: 50, now: NOW });

    expect(page).toEqual({ products: [], nextCursor: null });
    expect(calls.search).toHaveLength(1);
    expect(calls.userSummaries).toEqual([]);
    expect(calls.findMany).toEqual([]);
  });

  test('照会で返らない投稿者とロゴの記録はnullにする', async () => {
    const { reader } = createHarness({ users: [], files: [] });

    const page = await reader.list({ filter: {}, first: 50, now: NOW });

    expect(page.products.map(({ owner, logo }) => ({ owner, logo }))).toEqual([
      { owner: null, logo: null },
    ]);
  });

  test('上流の一覧の失敗(不正なカーソルなど)はそのまま投げる', async () => {
    const failure = new Error('ページの位置の指定が正しくありません。');
    const { reader, calls } = createHarness({ searchError: failure });

    const rejection = await reader
      .list({ filter: {}, first: 50, after: 'broken', now: NOW })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(rejection).toBe(failure);
    expect(calls.userSummaries).toEqual([]);
  });
});

describe('DefaultAdminProductReader.detail', () => {
  const HIDDEN_AT = new Date('2026-11-18T09:30:00.000Z');

  const fullHarness = () =>
    createHarness({
      summaries: [
        summaryOf({ hidden: true, visible: false }),
        summaryOf({
          productId: OPPONENT_PRODUCT_ID,
          ownerUserId: OTHER_OWNER_ID,
          handle: 'rival-tool',
          name: '好敵手の道具',
          hidden: true,
          visible: false,
        }),
      ],
      detail: {
        productId: PRODUCT_ID,
        descriptionMarkdown: '## 説明\n\n本文',
        screenshotFileIds: [
          SCREENSHOT_ID,
          QUARANTINED_SCREENSHOT_ID,
          MISSING_SCREENSHOT_ID,
        ],
      },
      launches: [
        launchOf(),
        launchOf({
          launchId: CANCELED_LAUNCH_ID,
          number: 0,
          launchDate: dateOf('2026-11-12'),
          status: 'canceled',
          outcome: null,
          decidedAt: null,
        }),
        launchOf({
          launchId: OLD_LAUNCH_ID,
          number: 1,
          launchDate: dateOf('2026-11-05'),
          status: 'finished',
          outcome: 'lost',
        }),
      ],
      matches: new Map([
        [
          LAUNCH_ID,
          [
            matchOf({
              matchId: WEEK_MATCH_ID,
              kind: 'week',
              round: 1,
              stage: 'quarterfinal',
              matchDate: dateOf('2026-11-21'),
              decision: null,
              phase: 'scheduled',
              entries: [
                entryOf({
                  slot: 1,
                  launchId: OPPONENT_LAUNCH_ID,
                  productId: OPPONENT_PRODUCT_ID,
                  ownerUserId: OTHER_OWNER_ID,
                  upvoteCount: 0,
                  result: null,
                }),
                entryOf({ slot: 2, upvoteCount: 0, result: null }),
              ],
            }),
            matchOf({
              entries: [
                entryOf({ upvoteCount: 12, result: 'won' }),
                entryOf({
                  slot: 2,
                  launchId: null,
                  productId: DELETED_OPPONENT_PRODUCT_ID,
                  ownerUserId: null,
                  upvoteCount: 7,
                  result: 'lost',
                }),
              ],
            }),
          ],
        ],
        [
          OLD_LAUNCH_ID,
          [
            matchOf({
              matchId: BYE_MATCH_ID,
              matchDate: dateOf('2026-11-05'),
              decision: 'bye',
              entries: [
                entryOf({
                  launchId: OLD_LAUNCH_ID,
                  upvoteCount: 0,
                  result: 'bye',
                }),
              ],
            }),
          ],
        ],
      ]),
      users: [userOf({ suspended: true })],
      files: [QUARANTINED_LOGO, SCREENSHOT, QUARANTINED_SCREENSHOT],
      ratingSummary: { average: 4.25, count: 4 },
      latest: {
        action: 'product.hide',
        reason: '規約に反する内容を掲載していたため',
        occurredAt: HIDDEN_AT,
      },
    });

  test('情報・スクリーンショット・ローンチ履歴とマッチ結果と対戦相手・画像の隔離理由・評価・非公開化の最新の理由を組み立てる', async () => {
    const { reader } = fullHarness();

    const detail = await reader.detail({ productId: PRODUCT_ID, now: NOW });

    expect(detail).toEqual({
      product: {
        productId: PRODUCT_ID,
        handle: 'launch-stadium-tool',
        name: '試合を見守る道具',
        logo: QUARANTINED_LOGO,
        owner: {
          userId: OWNER_ID,
          handle: 'owner-handle',
          nickname: '投稿者のなまえ',
          suspended: true,
        },
        category: { id: CATEGORY_ID, name: '開発' },
        latestLaunch: {
          launchId: LAUNCH_ID,
          launchDate: dateOf('2026-11-19'),
          state: 'won',
        },
        visibility: 'hidden',
      },
      tagline: '投票の行方を見守る',
      descriptionMarkdown: '## 説明\n\n本文',
      websiteUrl: 'https://product.example/',
      screenshots: [SCREENSHOT, QUARANTINED_SCREENSHOT],
      hiddenAt: HIDDEN_AT,
      latestHide: {
        reason: '規約に反する内容を掲載していたため',
        occurredAt: HIDDEN_AT,
      },
      ratingSummary: { average: 4.25, count: 4 },
      launches: [
        {
          launchId: LAUNCH_ID,
          number: 2,
          launchDate: dateOf('2026-11-19'),
          state: 'won',
          matches: [
            {
              matchId: WEEK_MATCH_ID,
              kind: 'week',
              round: 1,
              stage: 'quarterfinal',
              matchDate: dateOf('2026-11-21'),
              upvoteCount: 0,
              result: null,
              phase: 'scheduled',
              decision: null,
              opponentName: '好敵手の道具',
            },
            {
              matchId: QUALIFIER_MATCH_ID,
              kind: 'qualifier',
              round: null,
              stage: null,
              matchDate: dateOf('2026-11-19'),
              upvoteCount: 12,
              result: 'won',
              phase: 'finished',
              decision: 'votes',
              opponentName: null,
            },
          ],
        },
        {
          launchId: CANCELED_LAUNCH_ID,
          number: 0,
          launchDate: dateOf('2026-11-12'),
          state: 'canceled',
          matches: [],
        },
        {
          launchId: OLD_LAUNCH_ID,
          number: 1,
          launchDate: dateOf('2026-11-05'),
          state: 'lost',
          matches: [
            {
              matchId: BYE_MATCH_ID,
              kind: 'qualifier',
              round: null,
              stage: null,
              matchDate: dateOf('2026-11-05'),
              upvoteCount: 0,
              result: 'bye',
              phase: 'finished',
              decision: 'bye',
              opponentName: null,
            },
          ],
        },
      ],
    });
  });

  test('各照会を1回ずつ行い、ローンチとマッチの照会に照会の時刻を渡す', async () => {
    const { reader, calls } = fullHarness();

    await reader.detail({ productId: PRODUCT_ID, now: NOW });

    expect(calls.findSummaries).toEqual([
      { ids: [PRODUCT_ID], scope: 'not-deleted' },
      {
        ids: [OPPONENT_PRODUCT_ID, DELETED_OPPONENT_PRODUCT_ID],
        scope: 'not-deleted',
      },
    ]);
    expect(calls.findDetail).toEqual([PRODUCT_ID]);
    expect(calls.listLaunches).toEqual([{ ids: [PRODUCT_ID], now: NOW }]);
    expect(calls.listByLaunches).toEqual([
      { ids: [LAUNCH_ID, CANCELED_LAUNCH_ID, OLD_LAUNCH_ID], now: NOW },
    ]);
    expect(calls.userSummaries).toEqual([
      { ids: [OWNER_ID], scope: 'not-withdrawn' },
    ]);
    expect(calls.findMany).toEqual([
      [
        LOGO_ID,
        SCREENSHOT_ID,
        QUARANTINED_SCREENSHOT_ID,
        MISSING_SCREENSHOT_ID,
      ],
    ]);
    expect(calls.ratingSummaries).toEqual([[PRODUCT_ID]]);
    expect(calls.latestFor).toEqual([
      { targetIds: [PRODUCT_ID], actions: ['product.hide'] },
    ]);
  });

  test('ローンチの状態を管理画面の5値にする(組み合わせの後も明日以降の未確定は予約中)', async () => {
    const { reader } = createHarness({
      launches: [
        launchOf({
          launchId: '01JQ0LCH000000000000000011',
          launchDate: dateOf('2026-11-22'),
          status: 'scheduled',
          outcome: null,
          decidedAt: null,
        }),
        launchOf({
          launchId: '01JQ0LCH000000000000000012',
          launchDate: dateOf('2026-11-21'),
          status: 'paired',
          outcome: null,
          decidedAt: null,
        }),
        launchOf({
          launchId: '01JQ0LCH000000000000000013',
          launchDate: dateOf('2026-11-20'),
          status: 'in_progress',
          outcome: null,
          decidedAt: null,
        }),
      ],
    });

    const detail = await reader.detail({ productId: PRODUCT_ID, now: NOW });

    expect(detail?.launches.map(({ state }) => state)).toEqual([
      'scheduled',
      'scheduled',
      'in_progress',
    ]);
    expect(detail?.product.latestLaunch).toEqual({
      launchId: '01JQ0LCH000000000000000011',
      launchDate: dateOf('2026-11-22'),
      state: 'scheduled',
    });
  });

  test('公開中のプロダクトは非公開化の理由を読まず、ローンチが無ければマッチと対戦相手を読まない', async () => {
    const { reader, calls } = createHarness({ users: [userOf()] });

    const detail = await reader.detail({ productId: PRODUCT_ID, now: NOW });

    expect(detail).toMatchObject({
      product: { visibility: 'visible', latestLaunch: null },
      hiddenAt: null,
      latestHide: null,
      ratingSummary: { average: null, count: 0 },
      launches: [],
    });
    expect(calls.latestFor).toEqual([]);
    expect(calls.listByLaunches).toEqual([]);
    expect(calls.findSummaries).toEqual([
      { ids: [PRODUCT_ID], scope: 'not-deleted' },
    ]);
  });

  test('非公開化されておらず投稿者が停止中なら投稿者が停止中の公開状態にする', async () => {
    const { reader } = createHarness({
      summaries: [summaryOf({ visible: false })],
      users: [userOf({ suspended: true })],
    });

    const detail = await reader.detail({ productId: PRODUCT_ID, now: NOW });

    expect(detail?.product.visibility).toBe('owner_suspended');
  });

  test('非公開化中でも措置の記録が無ければ非公開化した日時と理由をnullにする', async () => {
    const { reader } = createHarness({
      summaries: [summaryOf({ hidden: true, visible: false })],
    });

    const detail = await reader.detail({ productId: PRODUCT_ID, now: NOW });

    expect(detail).toMatchObject({
      product: { visibility: 'hidden' },
      hiddenAt: null,
      latestHide: null,
    });
  });

  test('存在しない・論理削除済みのプロダクトはnullを返し、他の照会をしない', async () => {
    const { reader, calls } = createHarness({ summaries: [] });

    const detail = await reader.detail({ productId: PRODUCT_ID, now: NOW });

    expect(detail).toBeNull();
    expect(calls.findDetail).toEqual([]);
    expect(calls.listLaunches).toEqual([]);
    expect(calls.findMany).toEqual([]);
    expect(calls.ratingSummaries).toEqual([]);
    expect(calls.userSummaries).toEqual([]);
  });

  test('要約の照会の後に論理削除されて詳細が読めなければnullを返す', async () => {
    const { reader } = createHarness({ summaries: [summaryOf()] });
    const other = createHarness({
      summaries: [summaryOf({ productId: OTHER_PRODUCT_ID })],
    });

    expect(
      await other.reader.detail({ productId: OTHER_PRODUCT_ID, now: NOW }),
    ).toBeNull();
    expect(
      await reader.detail({ productId: PRODUCT_ID, now: NOW }),
    ).not.toBeNull();
  });
});

describe('DefaultAdminProductReader.categories', () => {
  test('カテゴリの一覧の順のまま、選択肢に要るIDと名称だけを返す', async () => {
    const { reader, calls } = createHarness({
      categories: [
        {
          id: CATEGORY_ID,
          name: '開発',
          handle: 'dev',
          systemDefault: false,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          id: '01JQ0CAT000000000000000099',
          name: 'その他',
          handle: 'others',
          systemDefault: true,
          createdAt: new Date('2025-12-01T00:00:00.000Z'),
        },
      ],
    });

    expect(await reader.categories()).toEqual([
      { id: CATEGORY_ID, name: '開発' },
      { id: '01JQ0CAT000000000000000099', name: 'その他' },
    ]);
    expect(calls.categories).toBe(1);
  });
});
