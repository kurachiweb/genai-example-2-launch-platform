import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { isNotFound } from '@tanstack/react-router';

import { ADMIN_LIST_PAGE_SIZE } from '../../common-lib/moderation/moderation-actions.ts';
import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import {
  dataResponse,
  runThroughApi,
  unavailableResponse,
} from '../../test/moderation-graphql-api.ts';
import { adminProductRatingsQueryOptions } from './admin-moderation-engagement.ts';
import {
  type AdminModerationProductView,
  adminModerationCategoryOptionsQueryOptions,
  adminModerationProductQueryOptions,
  adminModerationProductsQueryOptions,
  invalidateAdminModerationProductQueries,
  loadAdminModerationProductPage,
  loadAdminModerationProductsPage,
  productModerationActionOptions,
  toAdminModerationProductDetail,
  toAdminModerationProductPage,
  toModerationCategoryOptions,
} from './admin-moderation-products.ts';
import {
  AdminHideProductDocument,
  AdminModerationCategoryOptionsDocument,
  AdminProductDocument,
  type AdminProductQuery,
  AdminProductsDocument,
  type AdminProductsQuery,
  AdminUnhideProductDocument,
} from './generated/graphql.ts';

const PRODUCT_ID = '01JC0PRODUCT00000000000001';
const USER_ID = '01JC0USER00000000000000001';
const LOGO_ID = '01JC0FILE00000000000000001';
const SCREENSHOT_ID = '01JC0FILE00000000000000002';
const CATEGORY_ID = '01JC0CATEGORY0000000000001';
const LAUNCH_ID = '01JC0LAUNCH000000000000001';
const MATCH_ID = '01JC0MATCH0000000000000001';
const SCREENSHOT_OBJECT_KEY = '0123456789abcdef'.repeat(2);

type ProductNode = AdminProductsQuery['adminProducts']['nodes'][number];

type ProductDetail = NonNullable<AdminProductQuery['adminProduct']>;

const HIDDEN_PRODUCT: ProductNode = {
  id: PRODUCT_ID,
  handle: 'pitch_deck',
  name: 'ピッチデッキ',
  logo: {
    id: LOGO_ID,
    path: `/media/files/${LOGO_ID}`,
    image: {
      id: LOGO_ID,
      objectKey: null,
      fallbackFormat: 'PNG',
      width: 512,
      height: 512,
    },
    quarantined: true,
    quarantineReasons: ['PRODUCT_HIDDEN'],
  },
  owner: {
    id: USER_ID,
    handle: 'maker_ai',
    nickname: 'メーカーAI',
    suspended: false,
  },
  category: { id: CATEGORY_ID, name: '生産性' },
  latestLaunchDate: '2026-11-18',
  latestLaunchState: 'IN_PROGRESS',
  visibility: 'HIDDEN',
};

const HIDDEN_PRODUCT_VIEW: AdminModerationProductView = {
  id: PRODUCT_ID,
  handle: 'pitch_deck',
  name: 'ピッチデッキ',
  logo: {
    id: LOGO_ID,
    path: `/media/files/${LOGO_ID}`,
    image: { objectKey: null, fallbackFormat: 'PNG', width: 512, height: 512 },
    quarantined: true,
    quarantineReasons: ['product_hidden'],
  },
  owner: {
    id: USER_ID,
    handle: 'maker_ai',
    nickname: 'メーカーAI',
    suspended: false,
  },
  category: { id: CATEGORY_ID, name: '生産性' },
  latestLaunchDate: '2026-11-18',
  latestLaunchState: 'in_progress',
  visibility: 'hidden',
};

const UNLAUNCHED_PRODUCT: ProductNode = {
  ...HIDDEN_PRODUCT,
  logo: null,
  owner: null,
  latestLaunchDate: null,
  latestLaunchState: null,
  visibility: 'OWNER_SUSPENDED',
};

const productsResponse = (
  nodes: readonly ProductNode[],
  endCursor: string | null = null,
): AdminProductsQuery => ({
  adminProducts: {
    nodes: [...nodes],
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
  },
});

const DETAIL: ProductDetail = {
  product: HIDDEN_PRODUCT,
  tagline: '資料づくりを速く',
  descriptionMarkdown: '# 説明',
  websiteUrl: 'https://pitch.example',
  screenshots: [
    {
      id: SCREENSHOT_ID,
      path: `/media/files/${SCREENSHOT_ID}`,
      image: {
        id: SCREENSHOT_ID,
        objectKey: SCREENSHOT_OBJECT_KEY,
        fallbackFormat: 'PNG',
        width: 512,
        height: 512,
      },
      quarantined: false,
      quarantineReasons: [],
    },
  ],
  hiddenAt: '2026-11-19T01:00:00.000Z',
  latestHide: { reason: '虚偽の説明', occurredAt: '2026-11-19T01:00:00.000Z' },
  ratingSummary: { average: 4.5, count: 2 },
  launches: [
    {
      id: LAUNCH_ID,
      number: 2,
      launchDate: '2026-11-18',
      status: 'in_progress',
      matches: [
        {
          id: MATCH_ID,
          kind: 'qualifier',
          round: 1,
          stage: null,
          matchDate: '2026-11-18',
          upvoteCount: 12,
          result: 'won',
          phase: 'finished',
          decision: 'votes',
          opponentName: null,
        },
      ],
    },
  ],
};

describe('adminModerationProductsQueryOptions', () => {
  test('指定した条件だけをGraphQLの絞り込みにし、状態を大文字の列挙へ写して1ページ50件で取得する', () => {
    expect([
      ...adminModerationProductsQueryOptions({
        name: 'ピッチ',
        handle: 'pitch',
        ownerHandle: 'maker_ai',
        categoryId: CATEGORY_ID,
        launchState: 'in_progress',
        visibility: 'owner_suspended',
        after: 'cursor-2',
      }).queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(AdminProductsDocument, {
        filter: {
          name: 'ピッチ',
          handle: 'pitch',
          ownerHandle: 'maker_ai',
          categoryId: CATEGORY_ID,
          launchState: 'IN_PROGRESS',
          visibility: 'OWNER_SUSPENDED',
        },
        first: ADMIN_LIST_PAGE_SIZE,
        after: 'cursor-2',
      }),
    ]);
    expect([...adminModerationProductsQueryOptions({}).queryKey]).toStrictEqual(
      [
        ...graphqlQueryKey(AdminProductsDocument, {
          filter: {},
          first: ADMIN_LIST_PAGE_SIZE,
        }),
      ],
    );
  });

  test('ローンチ状態と公開状態の全ての値を大文字の列挙へ写す', () => {
    const filterOf = (
      args: Parameters<typeof adminModerationProductsQueryOptions>[0],
    ) => adminModerationProductsQueryOptions(args).queryKey[1].filter;

    expect(
      (['scheduled', 'in_progress', 'won', 'lost', 'canceled'] as const).map(
        (launchState) => filterOf({ launchState })?.launchState,
      ),
    ).toStrictEqual(['SCHEDULED', 'IN_PROGRESS', 'WON', 'LOST', 'CANCELED']);
    expect(
      (['visible', 'hidden', 'owner_suspended'] as const).map(
        (visibility) => filterOf({ visibility })?.visibility,
      ),
    ).toStrictEqual(['VISIBLE', 'HIDDEN', 'OWNER_SUSPENDED']);
  });
});

describe('toAdminModerationProductPage', () => {
  test('列挙を共用部品の値へ写し、ロゴと投稿者を画面の型にし、続きのカーソルを取り出す', () => {
    expect(
      toAdminModerationProductPage(
        productsResponse([HIDDEN_PRODUCT, UNLAUNCHED_PRODUCT], 'cursor-3'),
      ),
    ).toStrictEqual({
      items: [
        HIDDEN_PRODUCT_VIEW,
        {
          ...HIDDEN_PRODUCT_VIEW,
          logo: null,
          owner: null,
          latestLaunchDate: null,
          latestLaunchState: null,
          visibility: 'owner_suspended',
        },
      ],
      nextCursor: 'cursor-3',
    });
    expect(toAdminModerationProductPage(productsResponse([]))).toStrictEqual({
      items: [],
      nextCursor: null,
    });
  });

  test('ローンチ状態の全ての列挙を共用部品の値へ写す', () => {
    expect(
      (['SCHEDULED', 'IN_PROGRESS', 'WON', 'LOST', 'CANCELED'] as const).map(
        (latestLaunchState) =>
          toAdminModerationProductPage(
            productsResponse([{ ...HIDDEN_PRODUCT, latestLaunchState }]),
          ).items[0]?.latestLaunchState,
      ),
    ).toStrictEqual(['scheduled', 'in_progress', 'won', 'lost', 'canceled']);
  });
});

describe('toAdminModerationProductDetail', () => {
  test('プロダクトと画像と最新の理由を画面の型にし、ローンチとマッチの生の値をそのまま写す', () => {
    expect(
      toAdminModerationProductDetail({ adminProduct: DETAIL }),
    ).toStrictEqual({
      product: HIDDEN_PRODUCT_VIEW,
      tagline: '資料づくりを速く',
      descriptionMarkdown: '# 説明',
      websiteUrl: 'https://pitch.example',
      screenshots: [
        {
          id: SCREENSHOT_ID,
          path: `/media/files/${SCREENSHOT_ID}`,
          image: {
            objectKey: SCREENSHOT_OBJECT_KEY,
            fallbackFormat: 'PNG',
            width: 512,
            height: 512,
          },
          quarantined: false,
          quarantineReasons: [],
        },
      ],
      hiddenAt: '2026-11-19T01:00:00.000Z',
      latestHide: {
        reason: '虚偽の説明',
        occurredAt: '2026-11-19T01:00:00.000Z',
      },
      ratingSummary: { average: 4.5, count: 2 },
      launches: [
        {
          id: LAUNCH_ID,
          number: 2,
          launchDate: '2026-11-18',
          state: 'in_progress',
          matches: [
            {
              id: MATCH_ID,
              kind: 'qualifier',
              round: 1,
              stage: null,
              matchDate: '2026-11-18',
              upvoteCount: 12,
              result: 'won',
              phase: 'finished',
              decision: 'votes',
              opponentName: null,
            },
          ],
        },
      ],
    });
  });

  test('不在のプロダクトはnull、ローンチの無いプロダクトは空の一覧、知らないローンチの状態はnullにする', () => {
    expect(toAdminModerationProductDetail({ adminProduct: null })).toBeNull();

    const detail = toAdminModerationProductDetail({
      adminProduct: {
        ...DETAIL,
        screenshots: [],
        hiddenAt: null,
        latestHide: null,
        ratingSummary: { average: null, count: 0 },
        launches: [],
      },
    });
    expect(detail?.screenshots).toStrictEqual([]);
    expect(detail?.latestHide).toBeNull();
    expect(detail?.ratingSummary).toStrictEqual({ average: null, count: 0 });
    expect(detail?.launches).toStrictEqual([]);

    expect(
      toAdminModerationProductDetail({
        adminProduct: {
          ...DETAIL,
          launches: DETAIL.launches.map((launch) => ({
            ...launch,
            status: 'postponed',
            matches: [],
          })),
        },
      })?.launches[0]?.state,
    ).toBeNull();
  });
});

describe('toModerationCategoryOptions', () => {
  test('カテゴリの選択肢を並び順のまま写し、空なら空の一覧にする', () => {
    expect(
      toModerationCategoryOptions({
        adminModerationCategoryOptions: [
          { id: CATEGORY_ID, name: '生産性' },
          { id: '01JC0CATEGORY0000000000002', name: '開発者向け' },
        ],
      }),
    ).toStrictEqual([
      { id: CATEGORY_ID, name: '生産性' },
      { id: '01JC0CATEGORY0000000000002', name: '開発者向け' },
    ]);
    expect(
      toModerationCategoryOptions({ adminModerationCategoryOptions: [] }),
    ).toStrictEqual([]);
  });
});

describe('productModerationActionOptions', () => {
  test.each([
    ['product.hide', documentIdOf(AdminHideProductDocument), 'hideProduct'],
    [
      'product.unhide',
      documentIdOf(AdminUnhideProductDocument),
      'unhideProduct',
    ],
  ] as const)(
    '%sは対象と理由を操作の変数にして実行し、変化の有無を返す',
    async (action, documentId, field) => {
      const options = productModerationActionOptions(action);
      const { result, sent } = await runThroughApi(
        () =>
          options.mutationFn({
            variables: { targetId: PRODUCT_ID, reason: '虚偽の説明' },
          }),
        dataResponse({ [field]: { changed: true } }),
      );

      expect(options.mutationKey).toStrictEqual([documentId]);
      expect(sent).toStrictEqual([
        {
          documentId,
          variables: { id: PRODUCT_ID, reason: '虚偽の説明' },
        },
      ]);
      expect(result).toStrictEqual({ changed: true });
    },
  );
});

describe('invalidateAdminModerationProductQueries', () => {
  test('プロダクトの一覧と詳細の取得を全て無効にし、カテゴリの選択肢は残す', async () => {
    const queryClient = new QueryClient();
    const list = adminModerationProductsQueryOptions({});
    const detail = adminModerationProductQueryOptions(PRODUCT_ID);
    const categories = adminModerationCategoryOptionsQueryOptions();
    queryClient.setQueryData(list.queryKey, productsResponse([]));
    queryClient.setQueryData(detail.queryKey, { adminProduct: null });
    queryClient.setQueryData(categories.queryKey, {
      adminModerationCategoryOptions: [],
    });

    await invalidateAdminModerationProductQueries(queryClient);

    expect(queryClient.getQueryState(list.queryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(detail.queryKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(categories.queryKey)?.isInvalidated).toBe(
      false,
    );
  });
});

describe('loadAdminModerationProductsPage', () => {
  test('カテゴリの選択肢と、検索の条件の一覧を同時に取得する', async () => {
    const deps = { visibility: 'hidden', after: 'cursor-2' } as const;
    const { sent } = await runThroughApi(
      (queryClient) =>
        loadAdminModerationProductsPage({ context: { queryClient }, deps }),
      dataResponse({
        ...productsResponse([]),
        adminModerationCategoryOptions: [],
      }),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(AdminModerationCategoryOptionsDocument),
        variables: {},
      },
      {
        documentId: documentIdOf(AdminProductsDocument),
        variables: {
          filter: { visibility: 'HIDDEN' },
          first: ADMIN_LIST_PAGE_SIZE,
          after: 'cursor-2',
        },
      },
    ]);
  });

  test('取得に失敗しても例外にせず、一覧とカテゴリの選択肢の失敗をキャッシュに残す', async () => {
    const { result, queryClient } = await runThroughApi(
      (client) =>
        loadAdminModerationProductsPage({
          context: { queryClient: client },
          deps: {},
        }),
      unavailableResponse,
    );

    expect(result).toBeUndefined();
    expect(
      queryClient.getQueryState(
        adminModerationProductsQueryOptions({}).queryKey,
      )?.status,
    ).toBe('error');
    expect(
      queryClient.getQueryState(
        adminModerationCategoryOptionsQueryOptions().queryKey,
      )?.status,
    ).toBe('error');
  });
});

describe('loadAdminModerationProductPage', () => {
  test('詳細と、評価の一覧の最初のページを同時に取得する', async () => {
    const { result, sent } = await runThroughApi(
      async (queryClient) => {
        await loadAdminModerationProductPage({
          context: { queryClient },
          params: { productId: PRODUCT_ID },
        });
        return queryClient.getQueryData(
          adminModerationProductQueryOptions(PRODUCT_ID).queryKey,
        );
      },
      dataResponse({
        adminProduct: DETAIL,
        adminProductRatings: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(AdminProductDocument),
        variables: { id: PRODUCT_ID },
      },
      {
        documentId: adminProductRatingsQueryOptions(PRODUCT_ID).queryKey[0],
        variables: { productId: PRODUCT_ID, first: ADMIN_LIST_PAGE_SIZE },
      },
    ]);
    expect(result).toMatchObject({ adminProduct: DETAIL });
  });

  test('不在のプロダクトと、IDの形式の違反は見つからない扱いにする', async () => {
    const missing = await runThroughApi(
      (queryClient) =>
        loadAdminModerationProductPage({
          context: { queryClient },
          params: { productId: PRODUCT_ID },
        }).catch((error: unknown) => error),
      dataResponse({
        adminProduct: null,
        adminProductRatings: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }),
    );
    const malformed = await runThroughApi(
      (queryClient) =>
        loadAdminModerationProductPage({
          context: { queryClient },
          params: { productId: 'not-a-ulid' },
        }).catch((error: unknown) => error),
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              errors: [
                {
                  message: '入力内容に誤りがあります。',
                  extensions: {
                    code: 'validation_error',
                    details: [
                      {
                        field: 'id',
                        code: 'invalid_format',
                        message: 'プロダクトが見つかりません。',
                      },
                    ],
                  },
                },
              ],
            }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/graphql-response+json' },
            },
          ),
        ),
    );

    expect(isNotFound(missing.result)).toBe(true);
    expect(isNotFound(malformed.result)).toBe(true);
  });

  test('詳細の取得の他の失敗はルートのエラーの画面に任せ、評価の取得の失敗は投げない', async () => {
    const { result } = await runThroughApi(
      (queryClient) =>
        loadAdminModerationProductPage({
          context: { queryClient },
          params: { productId: PRODUCT_ID },
        }).catch((error: unknown) => error),
      unavailableResponse,
    );

    expect(result).toBeInstanceOf(GraphQLClientError);
  });
});
