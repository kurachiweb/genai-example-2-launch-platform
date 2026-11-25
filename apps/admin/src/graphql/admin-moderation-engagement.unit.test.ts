import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { ADMIN_LIST_PAGE_SIZE } from '../../common-lib/moderation/moderation-actions.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import {
  dataResponse,
  runThroughApi,
  unavailableResponse,
} from '../../test/moderation-graphql-api.ts';
import {
  adminModerationCommentsQueryOptions,
  adminModerationRatingsQueryOptions,
  type AdminModerationRatingView,
  adminProductRatingsQueryOptions,
  commentModerationActionOptions,
  invalidateAdminModerationEngagementQueries,
  loadAdminModerationCommentsPage,
  loadAdminModerationRatingsPage,
  ratingModerationActionOptions,
  toAdminModerationCommentPage,
  toAdminModerationRatingPage,
  toAdminProductRatings,
} from './admin-moderation-engagement.ts';
import {
  AdminCommentsDocument,
  type AdminCommentsQuery,
  AdminHideCommentDocument,
  AdminInvalidateRatingDocument,
  AdminProductRatingsDocument,
  type AdminProductRatingsQuery,
  AdminRatingsDocument,
  type AdminRatingsQuery,
  AdminRevalidateRatingDocument,
  AdminUnhideCommentDocument,
} from './generated/graphql.ts';

const COMMENT_ID = '01JC0COMMENT00000000000001';
const RATING_ID = '01JC0RATING000000000000001';
const PRODUCT_ID = '01JC0PRODUCT00000000000001';
const LAUNCH_ID = '01JC0LAUNCH000000000000001';
const USER_ID = '01JC0USER00000000000000001';

type CommentNode = AdminCommentsQuery['adminComments']['nodes'][number];

type RatingNode = AdminRatingsQuery['adminRatings']['nodes'][number];

const AUTHOR = {
  id: USER_ID,
  handle: 'maker_ai',
  nickname: 'メーカーAI',
  suspended: false,
};

const HIDDEN_COMMENT: CommentNode = {
  id: COMMENT_ID,
  excerpt: '**宣伝**のコメント',
  author: AUTHOR,
  productName: 'ピッチデッキ',
  productId: PRODUCT_ID,
  launchId: LAUNCH_ID,
  launchNumber: 2,
  createdAt: '2026-11-18T01:00:00.000Z',
  state: 'HIDDEN',
  latestHide: { reason: '宣伝', occurredAt: '2026-11-19T01:00:00.000Z' },
};

const INVALIDATED_RATING: RatingNode = {
  id: RATING_ID,
  rater: AUTHOR,
  productName: null,
  productId: PRODUCT_ID,
  score: 1,
  createdAt: '2026-11-17T01:00:00.000Z',
  updatedAt: '2026-11-18T01:00:00.000Z',
  state: 'INVALIDATED',
  latestInvalidation: {
    reason: '組織的な評価',
    occurredAt: '2026-11-19T01:00:00.000Z',
  },
};

const INVALIDATED_RATING_VIEW: AdminModerationRatingView = {
  id: RATING_ID,
  rater: AUTHOR,
  productName: null,
  productId: PRODUCT_ID,
  score: 1,
  createdAt: '2026-11-17T01:00:00.000Z',
  updatedAt: '2026-11-18T01:00:00.000Z',
  state: 'invalidated',
  latestInvalidation: {
    reason: '組織的な評価',
    occurredAt: '2026-11-19T01:00:00.000Z',
  },
};

const connectionOf = <TNode>(
  nodes: readonly TNode[],
  endCursor: string | null = null,
) => ({
  nodes: [...nodes],
  pageInfo: { hasNextPage: endCursor !== null, endCursor },
});

describe('adminModerationCommentsQueryOptions', () => {
  test('指定した条件だけをGraphQLの絞り込みにし、状態を大文字の列挙へ写して1ページ50件で取得する', () => {
    expect([
      ...adminModerationCommentsQueryOptions({
        authorHandle: 'maker_ai',
        productHandle: 'pitch_deck',
        postedFrom: '2026-10-31T15:00:00.000Z',
        postedBefore: '2026-11-19T15:00:00.000Z',
        state: 'author_unavailable',
        after: 'cursor-2',
      }).queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(AdminCommentsDocument, {
        filter: {
          authorHandle: 'maker_ai',
          productHandle: 'pitch_deck',
          postedFrom: '2026-10-31T15:00:00.000Z',
          postedBefore: '2026-11-19T15:00:00.000Z',
          state: 'AUTHOR_UNAVAILABLE',
        },
        first: ADMIN_LIST_PAGE_SIZE,
        after: 'cursor-2',
      }),
    ]);
    expect([...adminModerationCommentsQueryOptions({}).queryKey]).toStrictEqual(
      [
        ...graphqlQueryKey(AdminCommentsDocument, {
          filter: {},
          first: ADMIN_LIST_PAGE_SIZE,
        }),
      ],
    );
  });

  test('コメントの状態の全ての値を大文字の列挙へ写す', () => {
    expect(
      (
        [
          'hidden',
          'deleted',
          'anonymized',
          'author_unavailable',
          'shown',
        ] as const
      ).map(
        (state) =>
          adminModerationCommentsQueryOptions({ state }).queryKey[1].filter
            ?.state,
      ),
    ).toStrictEqual([
      'HIDDEN',
      'DELETED',
      'ANONYMIZED',
      'AUTHOR_UNAVAILABLE',
      'SHOWN',
    ]);
  });
});

describe('toAdminModerationCommentPage', () => {
  test('状態を共用部品の値へ写し、抜粋は文字列のまま、ローンチの回と最新の理由を写す', () => {
    expect(
      toAdminModerationCommentPage({
        adminComments: connectionOf([HIDDEN_COMMENT], 'cursor-3'),
      }),
    ).toStrictEqual({
      items: [
        {
          id: COMMENT_ID,
          excerpt: '**宣伝**のコメント',
          author: AUTHOR,
          productName: 'ピッチデッキ',
          productId: PRODUCT_ID,
          launchId: LAUNCH_ID,
          launchNumber: 2,
          createdAt: '2026-11-18T01:00:00.000Z',
          state: 'hidden',
          latestHide: {
            reason: '宣伝',
            occurredAt: '2026-11-19T01:00:00.000Z',
          },
        },
      ],
      nextCursor: 'cursor-3',
    });
  });

  test('投稿者・プロダクト名・ローンチの回・理由の欠けはnullのまま、全ての状態を写し、空の一覧は続き無しにする', () => {
    const anonymized = toAdminModerationCommentPage({
      adminComments: connectionOf([
        {
          ...HIDDEN_COMMENT,
          author: null,
          productName: null,
          launchNumber: null,
          state: 'ANONYMIZED',
          latestHide: null,
        },
      ]),
    }).items[0];
    expect(anonymized).toMatchObject({
      author: null,
      productName: null,
      launchNumber: null,
      state: 'anonymized',
      latestHide: null,
    });
    expect(
      (
        [
          'HIDDEN',
          'DELETED',
          'ANONYMIZED',
          'AUTHOR_UNAVAILABLE',
          'SHOWN',
        ] as const
      ).map(
        (state) =>
          toAdminModerationCommentPage({
            adminComments: connectionOf([{ ...HIDDEN_COMMENT, state }]),
          }).items[0]?.state,
      ),
    ).toStrictEqual([
      'hidden',
      'deleted',
      'anonymized',
      'author_unavailable',
      'shown',
    ]);
    expect(
      toAdminModerationCommentPage({ adminComments: connectionOf([]) }),
    ).toStrictEqual({ items: [], nextCursor: null });
  });
});

describe('adminModerationRatingsQueryOptions', () => {
  test('指定した条件だけをGraphQLの絞り込みにし、状態を大文字の列挙へ写して1ページ50件で取得する', () => {
    expect([
      ...adminModerationRatingsQueryOptions({
        productHandle: 'pitch_deck',
        raterHandle: 'maker_ai',
        state: 'invalidated',
        after: 'cursor-2',
      }).queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(AdminRatingsDocument, {
        filter: {
          productHandle: 'pitch_deck',
          raterHandle: 'maker_ai',
          state: 'INVALIDATED',
        },
        first: ADMIN_LIST_PAGE_SIZE,
        after: 'cursor-2',
      }),
    ]);
    expect(
      adminModerationRatingsQueryOptions({ state: 'valid' }).queryKey[1],
    ).toStrictEqual({
      filter: { state: 'VALID' },
      first: ADMIN_LIST_PAGE_SIZE,
    });
  });
});

describe('toAdminModerationRatingPage', () => {
  test('状態を共用部品の値へ写し、評価者と最新の理由を写し、続きのカーソルを取り出す', () => {
    expect(
      toAdminModerationRatingPage({
        adminRatings: connectionOf(
          [
            INVALIDATED_RATING,
            {
              ...INVALIDATED_RATING,
              rater: null,
              state: 'VALID',
              latestInvalidation: null,
            },
          ],
          'cursor-3',
        ),
      }),
    ).toStrictEqual({
      items: [
        INVALIDATED_RATING_VIEW,
        {
          ...INVALIDATED_RATING_VIEW,
          rater: null,
          state: 'valid',
          latestInvalidation: null,
        },
      ],
      nextCursor: 'cursor-3',
    });
    expect(
      toAdminModerationRatingPage({ adminRatings: connectionOf([]) }),
    ).toStrictEqual({ items: [], nextCursor: null });
  });
});

describe('adminProductRatingsQueryOptions', () => {
  const productRatingsResponse = (
    nodes: readonly RatingNode[],
    endCursor: string | null,
  ): AdminProductRatingsQuery => ({
    adminProductRatings: connectionOf(nodes, endCursor),
  });

  test('プロダクトのIDと1ページの件数をキーにし、続きがあれば最後の項目のカーソルを次のページの位置にする', () => {
    const options = adminProductRatingsQueryOptions(PRODUCT_ID);
    const nextOf = (page: AdminProductRatingsQuery) =>
      options.getNextPageParam(page, [page], null, [null]);

    expect([...options.queryKey]).toStrictEqual([
      ...graphqlQueryKey(AdminProductRatingsDocument, {
        productId: PRODUCT_ID,
        first: ADMIN_LIST_PAGE_SIZE,
      }),
    ]);
    expect(nextOf(productRatingsResponse([], 'cursor-2'))).toBe('cursor-2');
    expect(nextOf(productRatingsResponse([], null))).toBeUndefined();
  });

  test('最初のページはカーソルを持たず、続きのページはカーソルを変数にして実行する', async () => {
    const options = adminProductRatingsQueryOptions(PRODUCT_ID);
    const { result, sent } = await runThroughApi(
      async (queryClient) => {
        await queryClient.infiniteQuery(options);
        return queryClient.infiniteQuery({ ...options, pages: 2 });
      },
      dataResponse(productRatingsResponse([INVALIDATED_RATING], 'cursor-2')),
    );

    expect(sent.map(({ variables }) => variables)).toStrictEqual([
      { productId: PRODUCT_ID, first: ADMIN_LIST_PAGE_SIZE },
      { productId: PRODUCT_ID, first: ADMIN_LIST_PAGE_SIZE },
      { productId: PRODUCT_ID, first: ADMIN_LIST_PAGE_SIZE, after: 'cursor-2' },
    ]);
    expect(toAdminProductRatings(result)).toStrictEqual([
      INVALIDATED_RATING_VIEW,
      INVALIDATED_RATING_VIEW,
    ]);
  });

  test('読み込んだページが無ければ空の一覧にする', () => {
    expect(toAdminProductRatings({ pages: [], pageParams: [] })).toStrictEqual(
      [],
    );
  });
});

describe('commentModerationActionOptions・ratingModerationActionOptions', () => {
  test.each([
    [
      commentModerationActionOptions('comment.hide'),
      documentIdOf(AdminHideCommentDocument),
      'hideComment',
    ],
    [
      commentModerationActionOptions('comment.unhide'),
      documentIdOf(AdminUnhideCommentDocument),
      'unhideComment',
    ],
    [
      ratingModerationActionOptions('rating.invalidate'),
      documentIdOf(AdminInvalidateRatingDocument),
      'invalidateRating',
    ],
    [
      ratingModerationActionOptions('rating.revalidate'),
      documentIdOf(AdminRevalidateRatingDocument),
      'revalidateRating',
    ],
  ] as const)(
    '%#番目の措置は対象と理由を操作の変数にして実行し、変化の有無を返す',
    async (options, documentId, field) => {
      const { result, sent } = await runThroughApi(
        () =>
          options.mutationFn({
            variables: { targetId: COMMENT_ID, reason: '宣伝' },
          }),
        dataResponse({ [field]: { changed: false } }),
      );

      expect(options.mutationKey).toStrictEqual([documentId]);
      expect(sent).toStrictEqual([
        {
          documentId,
          variables: { id: COMMENT_ID, reason: '宣伝' },
        },
      ]);
      expect(result).toStrictEqual({ changed: false });
    },
  );
});

describe('invalidateAdminModerationEngagementQueries', () => {
  test('コメント・評価・プロダクトの評価の一覧の取得を全て無効にする', async () => {
    const queryClient = new QueryClient();
    const comments = adminModerationCommentsQueryOptions({});
    const ratings = adminModerationRatingsQueryOptions({ state: 'valid' });
    const productRatings = adminProductRatingsQueryOptions(PRODUCT_ID);
    queryClient.setQueryData(comments.queryKey, {
      adminComments: connectionOf([]),
    });
    queryClient.setQueryData(ratings.queryKey, {
      adminRatings: connectionOf([]),
    });
    queryClient.setQueryData(productRatings.queryKey, {
      pages: [],
      pageParams: [],
    });

    await invalidateAdminModerationEngagementQueries(queryClient);

    for (const queryKey of [
      comments.queryKey,
      ratings.queryKey,
      productRatings.queryKey,
    ]) {
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
    }
  });
});

describe('loadAdminModerationCommentsPage・loadAdminModerationRatingsPage', () => {
  test('検索の条件の一覧を取得する', async () => {
    const { sent } = await runThroughApi(
      async (queryClient) => {
        await loadAdminModerationCommentsPage({
          context: { queryClient },
          deps: { state: 'hidden' },
          cause: 'enter',
        });
        await loadAdminModerationRatingsPage({
          context: { queryClient },
          deps: { raterHandle: 'maker_ai' },
          cause: 'enter',
        });
      },
      dataResponse({
        adminComments: connectionOf([]),
        adminRatings: connectionOf([]),
      }),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(AdminCommentsDocument),
        variables: { filter: { state: 'HIDDEN' }, first: ADMIN_LIST_PAGE_SIZE },
      },
      {
        documentId: documentIdOf(AdminRatingsDocument),
        variables: {
          filter: { raterHandle: 'maker_ai' },
          first: ADMIN_LIST_PAGE_SIZE,
        },
      },
    ]);
  });

  test('取得に失敗しても、一覧の中で再試行できるよう例外にせず失敗をキャッシュに残す', async () => {
    const { result, queryClient } = await runThroughApi(async (client) => {
      const context = { queryClient: client };
      await loadAdminModerationCommentsPage({
        context,
        deps: {},
        cause: 'enter',
      });
      await loadAdminModerationRatingsPage({
        context,
        deps: {},
        cause: 'enter',
      });
      return 'loaded';
    }, unavailableResponse);

    expect(result).toBe('loaded');
    expect(
      queryClient.getQueryState(
        adminModerationCommentsQueryOptions({}).queryKey,
      )?.status,
    ).toBe('error');
    expect(
      queryClient.getQueryState(adminModerationRatingsQueryOptions({}).queryKey)
        ?.status,
    ).toBe('error');
  });

  const fetchStatusesOf = (queryClient: QueryClient) => [
    queryClient.getQueryState(adminModerationCommentsQueryOptions({}).queryKey)
      ?.fetchStatus,
    queryClient.getQueryState(adminModerationRatingsQueryOptions({}).queryKey)
      ?.fetchStatus,
  ];

  const emptyListsResponse = dataResponse({
    adminComments: connectionOf([]),
    adminRatings: connectionOf([]),
  });

  test.each(['enter', 'preload'] as const)(
    '%sの読み込みは取得の終わりを待つ',
    async (cause) => {
      const { result } = await runThroughApi(async (queryClient) => {
        const context = { queryClient };
        await loadAdminModerationCommentsPage({ context, deps: {}, cause });
        await loadAdminModerationRatingsPage({ context, deps: {}, cause });
        return fetchStatusesOf(queryClient);
      }, emptyListsResponse);

      expect(result).toStrictEqual(['idle', 'idle']);
    },
  );

  test('同じ画面の中の条件の変更とページの移動(stay)は、直前の一覧を残して読み込み中を示せるよう、取得を始めるだけで待たない', async () => {
    const { result } = await runThroughApi(async (queryClient) => {
      const context = { queryClient };
      await loadAdminModerationCommentsPage({
        context,
        deps: {},
        cause: 'stay',
      });
      await loadAdminModerationRatingsPage({
        context,
        deps: {},
        cause: 'stay',
      });
      const statuses = fetchStatusesOf(queryClient);
      await Promise.all([
        queryClient.query(adminModerationCommentsQueryOptions({})),
        queryClient.query(adminModerationRatingsQueryOptions({})),
      ]);
      return statuses;
    }, emptyListsResponse);

    expect(result).toStrictEqual(['fetching', 'fetching']);
  });
});
