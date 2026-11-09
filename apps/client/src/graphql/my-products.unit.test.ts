import { describe, expect, test } from 'bun:test';
import { type InfiniteData, QueryClient } from '@tanstack/react-query';

import {
  graphqlResponse,
  htmlResponse,
  recordingApi,
  renderContextOf,
  runInStartRequest,
} from '../../lib/test/start-request-fixtures.ts';
import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientLaunchHistoryDocument,
  ClientMyProductDocument,
  type ClientMyProductQuery,
  ClientMyProductsDocument,
  type ClientMyProductsQuery,
  ClientNewProductLaunchWindowDocument,
  ClientProductCategoriesDocument,
  ClientProductHandleAvailabilityDocument,
  ClientProfileAwardsDocument,
  type ClientRegisterProductMutation,
} from './generated/graphql.ts';
import {
  fetchProductHandleAvailability,
  invalidateMyProductQueries,
  loadMyProducts,
  loadProductRegistration,
  MY_PRODUCTS_PAGE_SIZE,
  myProductQueryOptions,
  myProductsQueryOptions,
  newProductLaunchWindowQueryOptions,
  productCategoriesQueryOptions,
  toLaunchDateWindowView,
  toLaunchPlanView,
  toMyProductCards,
  toMyProductEditView,
  toMyProductLookup,
  toProductCategoryViews,
} from './my-products.ts';
import type { ClientViewer } from './viewer.ts';

const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

const OTHER_VIEWER_ID = '01JC0VIEWER0000000000000001';

type MyProductsPage = ClientMyProductsQuery['myProducts'];
type MyProductNode = MyProductsPage['nodes'][number];
type MyProductFields = ClientRegisterProductMutation['registerProduct'];

const CATEGORY = {
  id: '01JD0CATEGORY0000000000001',
  name: '開発ツール',
  handle: 'dev-tools',
  systemDefault: false,
};

const LOGO = {
  id: '01JD0FILE00000000000000001',
  objectKey: '0123456789abcdef'.repeat(2),
  fallbackFormat: 'PNG' as const,
  width: 512,
  height: 512,
};

const WINDOW = {
  earliest: '2026-11-12',
  latest: '2027-02-07',
  unavailable: [
    {
      from: '2026-11-12',
      to: '2026-11-13',
      reason: 'RELAUNCH_INTERVAL' as const,
    },
  ],
  relaunchIntervalDays: 7,
};

const RESCHEDULE_PLAN: MyProductNode['plan'] = {
  mode: 'RESCHEDULE',
  currentLaunchDate: '2026-11-20',
  window: WINDOW,
  blocks: [],
  locked: false,
  locks: [],
  lockUnknown: false,
  ultrasEntitled: false,
};

const BLOCKED_PLAN: MyProductNode['plan'] = {
  mode: 'BLOCKED',
  currentLaunchDate: null,
  window: null,
  blocks: [
    {
      code: 'tournament_entry',
      message: 'トーナメントに参加中のため予約できません。',
      releaseAt: '2026-11-30T15:00:00.000Z',
    },
  ],
  locked: true,
  locks: [
    {
      code: 'match_imminent',
      message: 'マッチ直前のため変更できません。',
    },
  ],
  lockUnknown: false,
  ultrasEntitled: true,
};

const LAUNCH: NonNullable<MyProductNode['latestLaunch']> = {
  id: '01JD0LAUNCH000000000000001',
  number: 1,
  launchDate: '2026-11-20',
  kickoffAt: '2026-11-19T15:00:00.000Z',
  status: 'SCHEDULED',
  outcome: null,
  summary: { label: 'キックオフ予定', inMatch: false },
};

const NODE: MyProductNode = {
  handle: 'pitch-deck',
  name: 'ピッチデッキ',
  category: CATEGORY,
  logo: LOGO,
  hidden: false,
  listed: false,
  latestLaunch: LAUNCH,
  plan: RESCHEDULE_PLAN,
};

const HIDDEN_NODE: MyProductNode = {
  ...NODE,
  handle: 'old-tool',
  name: '古いツール',
  logo: null,
  hidden: true,
  listed: true,
  latestLaunch: null,
  plan: BLOCKED_PLAN,
};

const pageOf = (
  nodes: readonly MyProductNode[],
  endCursor: string | null,
  hasNextPage: boolean,
): ClientMyProductsQuery => ({
  myProducts: { nodes: [...nodes], pageInfo: { endCursor, hasNextPage } },
});

const FIRST_PAGE = pageOf([NODE], 'cursor-1', true);

const FIELDS: MyProductFields = {
  ...NODE,
  previousHandle: 'pitch-deck-old',
  tagline: '5分でピッチの資料を作る',
  websiteUrl: 'https://pitch-deck.example',
  description: '# ピッチデッキ',
  logoFileId: LOGO.id,
  screenshots: [
    {
      fileId: '01JD0FILE00000000000000002',
      image: { ...LOGO, id: '01JD0FILE00000000000000002' },
    },
    { fileId: '01JD0FILE00000000000000003', image: null },
  ],
  version: 4,
};

const nextPageParamOf = (page: ClientMyProductsQuery) =>
  myProductsQueryOptions(VIEWER.id).getNextPageParam(page, [page], null, [
    null,
  ]);

describe('myProductsQueryOptions', () => {
  test('キーは操作の識別子と1ページの件数で始まり、閲覧者ごとに別のキーにする', () => {
    const mine: readonly unknown[] = myProductsQueryOptions(VIEWER.id).queryKey;

    expect(mine).toStrictEqual([
      ...graphqlQueryKey(ClientMyProductsDocument, {
        first: MY_PRODUCTS_PAGE_SIZE,
      }),
      VIEWER.id,
    ]);
    expect(JSON.stringify(mine)).not.toBe(
      JSON.stringify(myProductsQueryOptions(OTHER_VIEWER_ID).queryKey),
    );
  });

  test('1ページは20件で、最初のページはカーソルを持たない', () => {
    expect(MY_PRODUCTS_PAGE_SIZE).toBe(20);
    expect(myProductsQueryOptions(VIEWER.id).initialPageParam).toBeNull();
  });

  test('続きがあれば最後の項目のカーソルを次のページの位置にする', () => {
    expect(nextPageParamOf(FIRST_PAGE)).toBe('cursor-1');
  });

  test.each([
    ['続きが無い', pageOf([NODE], 'cursor-1', false)],
    ['カーソルが無い', pageOf([], null, true)],
  ])('%sなら次のページを持たない', (_case, page) => {
    expect(nextPageParamOf(page)).toBeUndefined();
  });
});

describe('toLaunchPlanView・toLaunchDateWindowView', () => {
  test('計画の種類・選べない理由を画面の値へ写し、選べる日と解除の日時を残す', () => {
    expect(toLaunchPlanView(RESCHEDULE_PLAN)).toStrictEqual({
      mode: 'reschedule',
      currentLaunchDate: '2026-11-20',
      window: {
        earliest: '2026-11-12',
        latest: '2027-02-07',
        unavailable: [
          { from: '2026-11-12', to: '2026-11-13', reason: 'relaunch_interval' },
        ],
        relaunchIntervalDays: 7,
      },
      blocks: [],
      locked: false,
      locks: [],
      lockUnknown: false,
      ultrasEntitled: false,
    });
  });

  test('予約の禁止と固定の理由を順に残し、選べる日の無い計画はnullにする', () => {
    expect(toLaunchPlanView(BLOCKED_PLAN)).toStrictEqual({
      mode: 'blocked',
      currentLaunchDate: null,
      window: null,
      blocks: [
        {
          code: 'tournament_entry',
          message: 'トーナメントに参加中のため予約できません。',
          releaseAt: '2026-11-30T15:00:00.000Z',
        },
      ],
      locked: true,
      locks: [
        { code: 'match_imminent', message: 'マッチ直前のため変更できません。' },
      ],
      lockUnknown: false,
      ultrasEntitled: true,
    });
  });

  test.each([
    ['NEW', 'new'],
    ['RESCHEDULE', 'reschedule'],
    ['BLOCKED', 'blocked'],
    ['UNKNOWN', 'unknown'],
  ] as const)('計画の種類%sを%sへ写す', (mode, expected) => {
    expect(toLaunchPlanView({ ...BLOCKED_PLAN, mode }).mode).toBe(expected);
  });

  test.each([
    ['PAIRING_DEADLINE', 'pairing_deadline'],
    ['RELAUNCH_INTERVAL', 'relaunch_interval'],
    ['OUT_OF_RANGE', 'out_of_range'],
  ] as const)('選べない理由%sを%sへ写す', (reason, expected) => {
    expect(
      toLaunchDateWindowView({
        ...WINDOW,
        unavailable: [{ from: '2026-11-12', to: '2026-11-12', reason }],
      }).unavailable[0]?.reason,
    ).toBe(expected);
  });
});

describe('toMyProductCards', () => {
  test('読み込んだページの項目を順に1つの並びにし、直近のローンチと計画を画面の値にする', () => {
    const data: InfiniteData<ClientMyProductsQuery, string | null> = {
      pages: [FIRST_PAGE, pageOf([HIDDEN_NODE], null, false)],
      pageParams: [null, 'cursor-1'],
    };

    const cards = toMyProductCards(data);

    expect(cards.map(({ handle }) => handle)).toStrictEqual([
      'pitch-deck',
      'old-tool',
    ]);
    expect(cards[0]).toStrictEqual({
      handle: 'pitch-deck',
      name: 'ピッチデッキ',
      category: CATEGORY,
      logo: LOGO,
      hidden: false,
      listed: false,
      latestLaunch: {
        id: '01JD0LAUNCH000000000000001',
        number: 1,
        launchDate: '2026-11-20',
        kickoffAt: '2026-11-19T15:00:00.000Z',
        status: 'scheduled',
        outcome: null,
        summary: { label: 'キックオフ予定', inMatch: false },
      },
      plan: toLaunchPlanView(RESCHEDULE_PLAN),
    });
    expect(cards[1]).toMatchObject({
      logo: null,
      hidden: true,
      listed: true,
      latestLaunch: null,
    });
  });

  test('項目が無ければ空の並びにする', () => {
    expect(
      toMyProductCards({
        pages: [pageOf([], null, false)],
        pageParams: [null],
      }),
    ).toStrictEqual([]);
  });
});

describe('myProductQueryOptions・toMyProductLookup', () => {
  test('キーは操作の識別子と開いたハンドルで始まり、閲覧者ごとに別のキーにする', () => {
    expect(
      myProductQueryOptions(VIEWER.id, 'pitch-deck')
        .queryKey as readonly unknown[],
    ).toStrictEqual([
      ...graphqlQueryKey(ClientMyProductDocument, { handle: 'pitch-deck' }),
      VIEWER.id,
    ]);
    expect(
      JSON.stringify(
        myProductQueryOptions(OTHER_VIEWER_ID, 'pitch-deck').queryKey,
      ),
    ).not.toBe(
      JSON.stringify(myProductQueryOptions(VIEWER.id, 'pitch-deck').queryKey),
    );
  });

  test('自分のプロダクトは編集の値にし、スクリーンショットの順と画像の無い枠を残す', () => {
    const data: ClientMyProductQuery = {
      myProduct: { __typename: 'MyProduct', ...FIELDS },
    };

    expect(toMyProductLookup(data)).toStrictEqual({
      kind: 'found',
      product: toMyProductEditView(FIELDS),
    });
    expect(toMyProductEditView(FIELDS)).toMatchObject({
      handle: 'pitch-deck',
      previousHandle: 'pitch-deck-old',
      tagline: '5分でピッチの資料を作る',
      websiteUrl: 'https://pitch-deck.example',
      description: '# ピッチデッキ',
      logoFileId: LOGO.id,
      screenshots: [
        {
          fileId: '01JD0FILE00000000000000002',
          image: { ...LOGO, id: '01JD0FILE00000000000000002' },
        },
        { fileId: '01JD0FILE00000000000000003', image: null },
      ],
      version: 4,
      latestLaunch: { status: 'scheduled' },
      plan: { mode: 'reschedule' },
    });
  });

  test('旧ハンドルでの照会は転送先のハンドルにする', () => {
    expect(
      toMyProductLookup({
        myProduct: { __typename: 'MyProductRedirect', handle: 'pitch-deck' },
      }),
    ).toStrictEqual({ kind: 'redirect', handle: 'pitch-deck' });
  });

  test('他人・論理削除済み・不在のnullは見つからないことにする', () => {
    expect(toMyProductLookup({ myProduct: null })).toStrictEqual({
      kind: 'not-found',
    });
  });
});

describe('選べる日とカテゴリの取得', () => {
  test('登録の選べる日は閲覧者ごとに別のキーにし、画面の値へ写す', () => {
    expect(
      newProductLaunchWindowQueryOptions(VIEWER.id)
        .queryKey as readonly unknown[],
    ).toStrictEqual([
      ...graphqlQueryKey(ClientNewProductLaunchWindowDocument, {}),
      VIEWER.id,
    ]);
    expect(toLaunchDateWindowView(WINDOW)).toStrictEqual({
      earliest: '2026-11-12',
      latest: '2027-02-07',
      unavailable: [
        { from: '2026-11-12', to: '2026-11-13', reason: 'relaunch_interval' },
      ],
      relaunchIntervalDays: 7,
    });
  });

  test('カテゴリは閲覧者によらない共通の取得にし、APIの順を保つ', () => {
    expect(
      productCategoriesQueryOptions().queryKey as readonly unknown[],
    ).toStrictEqual(graphqlQueryKey(ClientProductCategoriesDocument, {}));
    const other = {
      id: '01JD0000000000000000000000',
      name: 'その他',
      handle: 'other',
      systemDefault: true,
    };

    expect(
      toProductCategoryViews({ productCategories: [CATEGORY, other] }),
    ).toStrictEqual([CATEGORY, other]);
  });
});

describe('fetchProductHandleAvailability', () => {
  const succeedingQueryClient = () => {
    const options: unknown[] = [];
    const queryClient = {
      query: (option: unknown) => {
        options.push(option);
        return Promise.resolve({ productHandleAvailability: 'UNAVAILABLE' });
      },
    } as unknown as QueryClient;
    return { queryClient, options };
  };

  test('編集中は現在のハンドルを添えて問い合わせ、結果をキャッシュに残さない', async () => {
    const { queryClient, options } = succeedingQueryClient();

    expect(
      await fetchProductHandleAvailability(
        queryClient,
        'new-deck',
        'pitch-deck',
      ),
    ).toBe('UNAVAILABLE');
    expect(options[0]).toMatchObject({
      queryKey: graphqlQueryKey(ClientProductHandleAvailabilityDocument, {
        handle: 'new-deck',
        productHandle: 'pitch-deck',
      }),
      staleTime: 0,
      gcTime: 0,
    });
  });

  test('登録では現在のハンドルを変数に含めない', async () => {
    const { queryClient, options } = succeedingQueryClient();

    await fetchProductHandleAvailability(queryClient, 'new-deck');

    expect(options[0]).toMatchObject({
      queryKey: graphqlQueryKey(ClientProductHandleAvailabilityDocument, {
        handle: 'new-deck',
      }),
    });
  });

  test('確認に失敗したら、保存の時のサーバーの判定に任せるため結果なしで返す', async () => {
    const queryClient = {
      query: () =>
        Promise.reject(
          new GraphQLClientError({
            status: 429,
            code: 'rate_limited',
            message: '時間をおいて再度お試しください。',
          }),
        ),
    } as unknown as QueryClient;

    expect(
      await fetchProductHandleAvailability(queryClient, 'new-deck'),
    ).toBeUndefined();
  });
});

describe('invalidateMyProductQueries', () => {
  test('自分のプロダクト・選べる日・ローンチ履歴・受賞の取得を無効にし、カテゴリは残す', async () => {
    const queryClient = new QueryClient();
    const keys = [
      myProductsQueryOptions(VIEWER.id).queryKey,
      myProductQueryOptions(VIEWER.id, 'pitch-deck').queryKey,
      newProductLaunchWindowQueryOptions(VIEWER.id).queryKey,
      [
        documentIdOf(ClientLaunchHistoryDocument),
        { userHandle: 'pitch_maker', first: 20 },
        VIEWER.id,
      ],
      [
        documentIdOf(ClientProfileAwardsDocument),
        { userHandle: 'pitch_maker' },
        VIEWER.id,
      ],
    ] as const;
    for (const key of keys) {
      queryClient.setQueryData(key, {});
    }
    queryClient.setQueryData(productCategoriesQueryOptions().queryKey, {
      productCategories: [],
    });

    await invalidateMyProductQueries(queryClient);

    for (const key of keys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(
      queryClient.getQueryState(productCategoriesQueryOptions().queryKey)
        ?.isInvalidated,
    ).toBe(false);
  });
});

const runThroughApi = async (
  run: (queryClient: QueryClient) => Promise<unknown>,
  respond: (request: Request) => Promise<Response>,
) => {
  const api = recordingApi(respond);
  const queryClient = new QueryClient();
  let result: unknown;
  await runInStartRequest({
    context: renderContextOf({ api, reported: [] }),
    render: async () => {
      result = await run(queryClient);
      return htmlResponse();
    },
  });
  const sent = await Promise.all(api.requests.map((request) => request.json()));
  return { result, sent, queryClient };
};

describe('取得の処理', () => {
  test('最初のページは件数だけ、続きのページは件数とカーソルを変数にして実行する', async () => {
    const { sent } = await runThroughApi(
      async (queryClient) => {
        const options = myProductsQueryOptions(VIEWER.id);
        await queryClient.infiniteQuery(options);
        return queryClient.infiniteQuery({ ...options, pages: 2 });
      },
      () => Promise.resolve(graphqlResponse({ data: FIRST_PAGE })),
    );
    const documentId = documentIdOf(ClientMyProductsDocument);

    expect(sent).toStrictEqual([
      { documentId, variables: { first: MY_PRODUCTS_PAGE_SIZE } },
      { documentId, variables: { first: MY_PRODUCTS_PAGE_SIZE } },
      {
        documentId,
        variables: { first: MY_PRODUCTS_PAGE_SIZE, after: 'cursor-1' },
      },
    ]);
  });

  test('編集の照会は開いたハンドルを変数にして実行する', async () => {
    const { sent, result } = await runThroughApi(
      (queryClient) =>
        queryClient.query(myProductQueryOptions(VIEWER.id, 'pitch-deck')),
      () => Promise.resolve(graphqlResponse({ data: { myProduct: null } })),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientMyProductDocument),
        variables: { handle: 'pitch-deck' },
      },
    ]);
    expect(result).toStrictEqual({ myProduct: null });
  });
});

describe('loadMyProducts', () => {
  test('最初のページだけを読み、キャッシュに残す', async () => {
    const { result, sent } = await runThroughApi(
      async (client) => {
        await loadMyProducts({
          context: { queryClient: client, viewer: VIEWER },
        });
        return client.getQueryData(myProductsQueryOptions(VIEWER.id).queryKey);
      },
      () => Promise.resolve(graphqlResponse({ data: FIRST_PAGE })),
    );

    expect(result).toStrictEqual({ pages: [FIRST_PAGE], pageParams: [null] });
    expect(sent).toHaveLength(1);
  });

  test('取得に失敗しても、一覧の位置で再試行できるよう例外にせず失敗をキャッシュに残す', async () => {
    const { result, queryClient } = await runThroughApi(
      (client) =>
        loadMyProducts({
          context: { queryClient: client, viewer: VIEWER },
        }).then(() => 'loaded'),
      () => Promise.resolve(new Response('', { status: 503 })),
    );

    expect(result).toBe('loaded');
    expect(
      queryClient.getQueryState(myProductsQueryOptions(VIEWER.id).queryKey)
        ?.status,
    ).toBe('error');
  });
});

describe('loadProductRegistration', () => {
  test('選べる日とカテゴリを同時に読み、キャッシュに残す', async () => {
    const { result, sent } = await runThroughApi(
      async (client) => {
        await loadProductRegistration({
          context: { queryClient: client, viewer: VIEWER },
        });
        return [
          client.getQueryData(
            newProductLaunchWindowQueryOptions(VIEWER.id).queryKey,
          ),
          client.getQueryData(productCategoriesQueryOptions().queryKey),
        ];
      },
      async (request) => {
        const { documentId } = (await request.clone().json()) as {
          readonly documentId: string;
        };
        return graphqlResponse({
          data:
            documentId === documentIdOf(ClientProductCategoriesDocument)
              ? { productCategories: [CATEGORY] }
              : { newProductLaunchWindow: WINDOW },
        });
      },
    );

    expect(result).toStrictEqual([
      { newProductLaunchWindow: WINDOW },
      { productCategories: [CATEGORY] },
    ]);
    expect(
      (sent as readonly { readonly documentId: string }[])
        .map(({ documentId }) => documentId)
        .toSorted(),
    ).toStrictEqual(
      [
        documentIdOf(ClientNewProductLaunchWindowDocument),
        documentIdOf(ClientProductCategoriesDocument),
      ].toSorted(),
    );
  });

  test('取得に失敗しても、ページの位置で再試行できるよう例外にせず失敗をキャッシュに残す', async () => {
    const { result, queryClient } = await runThroughApi(
      (client) =>
        loadProductRegistration({
          context: { queryClient: client, viewer: VIEWER },
        }).then(() => 'loaded'),
      () => Promise.resolve(new Response('', { status: 503 })),
    );

    expect(result).toBe('loaded');
    expect(
      queryClient.getQueryState(productCategoriesQueryOptions().queryKey)
        ?.status,
    ).toBe('error');
  });
});
