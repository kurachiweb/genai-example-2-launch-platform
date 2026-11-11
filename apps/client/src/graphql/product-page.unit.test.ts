import { describe, expect, mock, test } from 'bun:test';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { isNotFound, isRedirect } from '@tanstack/react-router';

import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import { entryOf, matchOf } from '../components/match/match-fixtures.ts';
import {
  ClientMatchSupportersDocument,
  type ClientMatchSupportersQuery,
  ClientOwnerFollowStatusDocument,
  type ClientOwnerFollowStatusQuery,
  ClientProductLiveMatchDocument,
  type ClientProductLiveMatchQuery,
  ClientProductOwnerStatusDocument,
  type ClientProductOwnerStatusQuery,
  ClientProductPageDocument,
  type ClientProductPageQuery,
} from './generated/graphql.ts';
import {
  loadProductPage,
  MATCH_SUPPORTERS_PAGE_SIZE,
  matchSupportersQueryOptions,
  ownerFollowingOf,
  ownerFollowStatusQueryOptions,
  PRODUCT_PAGE_QUERY_PREFIX,
  productLiveMatchQueryOptions,
  productOwnerStatusQueryOptions,
  productPageQueryOptions,
  type ProductPageView,
  toMatchSupporters,
  toOwnerLaunchPlan,
  toProductPageView,
  withOwnerFollowing,
  withUpdatedLiveMatch,
} from './product-page.ts';
import type { ClientViewer } from './viewer.ts';

const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

const PRODUCT_PAGE: ProductPageView = {
  __typename: 'ProductPage',
  id: '01JD0PRODUCT00000000000001',
  handle: 'Pitch-Notes',
  name: 'Pitch Notes',
  tagline: 'ピッチの台本を書いて練習できるノートアプリ',
  category: {
    id: '01JD0CATEGORY0000000000001',
    name: '開発ツール',
    handle: 'dev-tools',
  },
  websiteUrl: 'https://pitch-notes.example/',
  logo: null,
  description: '## 特徴',
  screenshots: [],
  owner: { handle: 'pitch_maker', nickname: 'ピッチの作り手', avatar: null },
  viewerIsOwner: false,
  listed: true,
  awards: [],
  record: {
    firstLaunchDate: '2026-09-15',
    launchCount: 1,
    wins: 1,
    losses: 0,
  },
  launches: [],
};

const PAGE: ClientProductPageQuery = { productPage: PRODUCT_PAGE };

const REDIRECT: ClientProductPageQuery = {
  productPage: { __typename: 'ProductPageRedirect', handle: 'pitch-notes' },
};

const MISSING: ClientProductPageQuery = { productPage: null };

const ENDS_AT = '2026-11-10T14:40:00.000Z';

const LIVE: ClientProductLiveMatchQuery = {
  productLiveMatch: {
    serverTime: '2026-11-10T12:00:00.000Z',
    awaitingChange: false,
    match: { ...matchOf(), endsAt: ENDS_AT },
  },
};

const INTERNAL_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const LOCATION = { search: {} };

const caught = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  );

// 詳細ページの取得には指定の結果を、開催中のマッチの取得には指定の結果か失敗を返す
const queryClientWith = (
  page: ClientProductPageQuery | Error,
  live: ClientProductLiveMatchQuery | Error = LIVE,
) => {
  const query = mock(
    ({ queryKey }: { readonly queryKey: readonly unknown[] }) => {
      const result =
        queryKey[0] === documentIdOf(ClientProductPageDocument) ? page : live;
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result);
    },
  );
  return { query, queryClient: { query } as unknown as QueryClient };
};

describe('productPageQueryOptions', () => {
  test('詳細ページの操作とハンドルの後に、閲覧者のIDか未ログインの印をキーへ加える', () => {
    expect([
      ...productPageQueryOptions(VIEWER, 'pitch-notes').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientProductPageDocument, { handle: 'pitch-notes' }),
      VIEWER.id,
    ]);
    expect([
      ...productPageQueryOptions(null, 'pitch-notes').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientProductPageDocument, { handle: 'pitch-notes' }),
      'guest',
    ]);
  });
});

describe('productLiveMatchQueryOptions', () => {
  test('開催中のマッチの操作とハンドルの後に、閲覧者のIDか未ログインの印をキーへ加える', () => {
    expect([
      ...productLiveMatchQueryOptions(VIEWER, 'pitch-notes').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientProductLiveMatchDocument, {
        productHandle: 'pitch-notes',
      }),
      VIEWER.id,
    ]);
    expect(
      productLiveMatchQueryOptions(null, 'pitch-notes').queryKey.at(-1),
    ).toBe('guest');
  });

  test('照会で同一視される大文字小文字の違うハンドルは、同じキーにする', () => {
    expect([
      ...productLiveMatchQueryOptions(VIEWER, 'PITCH-Notes').queryKey,
    ]).toStrictEqual([
      ...productLiveMatchQueryOptions(VIEWER, 'Pitch-Notes').queryKey,
    ]);
    expect([
      ...productLiveMatchQueryOptions(VIEWER, 'Pitch-Notes').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientProductLiveMatchDocument, {
        productHandle: 'pitch-notes',
      }),
      VIEWER.id,
    ]);
  });
});

describe('PRODUCT_PAGE_QUERY_PREFIX', () => {
  test('閲覧者とハンドルによらず詳細ページの取得の全てのキーの先頭に当たる', () => {
    expect([...PRODUCT_PAGE_QUERY_PREFIX]).toStrictEqual([
      documentIdOf(ClientProductPageDocument),
    ]);
    expect(
      productPageQueryOptions(VIEWER, 'PITCH-Notes').queryKey.slice(0, 1),
    ).toStrictEqual([...PRODUCT_PAGE_QUERY_PREFIX]);
  });
});

describe('toProductPageView', () => {
  test('詳細ページの結果だけを返し、転送とnullは返さない', () => {
    expect(toProductPageView(PAGE)).toBe(PRODUCT_PAGE);
    expect(toProductPageView(REDIRECT)).toBeUndefined();
    expect(toProductPageView(MISSING)).toBeUndefined();
  });
});

describe('loadProductPage', () => {
  test('詳細ページを鮮度を問わずキャッシュから、開催中のマッチを毎回取り直して同時に待ち、題名と説明と正規のURLと掲載の有無に要る値を返す', async () => {
    const { query, queryClient } = queryClientWith(PAGE);

    const data = await loadProductPage({
      context: { queryClient, viewer: VIEWER },
      params: { handle: 'pitch-notes' },
      location: LOCATION,
    });

    expect(data).toStrictEqual({
      handle: 'Pitch-Notes',
      name: 'Pitch Notes',
      tagline: 'ピッチの台本を書いて練習できるノートアプリ',
      listed: true,
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: productPageQueryOptions(VIEWER, 'pitch-notes').queryKey,
        staleTime: 'static',
      }),
    );
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: productLiveMatchQueryOptions(VIEWER, 'pitch-notes').queryKey,
        staleTime: 0,
      }),
    );
  });

  test('開催中のマッチの取得の失敗ではページを失敗にしない', async () => {
    const { queryClient } = queryClientWith(PAGE, INTERNAL_ERROR);

    const data = await loadProductPage({
      context: { queryClient, viewer: null },
      params: { handle: 'pitch-notes' },
      location: LOCATION,
    });

    expect(data.handle).toBe('Pitch-Notes');
  });

  test.each(['', 'a b', 'プロダクト', '-leading', 'a.b'])(
    'ハンドルの形式違反(%p)は照会せずに存在しないページにする',
    async (handle) => {
      const { query, queryClient } = queryClientWith(PAGE);

      const error = await caught(
        loadProductPage({
          context: { queryClient, viewer: null },
          params: { handle },
          location: LOCATION,
        }),
      );

      expect(isNotFound(error)).toBe(true);
      expect(query).not.toHaveBeenCalled();
    },
  );

  test('照会の結果がnullなら存在しないページにする', async () => {
    const { queryClient } = queryClientWith(MISSING);

    const error = await caught(
      loadProductPage({
        context: { queryClient, viewer: null },
        params: { handle: 'pitch-notes' },
        location: LOCATION,
      }),
    );

    expect(isNotFound(error)).toBe(true);
  });

  test('旧ハンドルは現在のハンドルの詳細ページの経路へ、状態コード302と検索パラメーターを引き継いで転送する', async () => {
    const { queryClient } = queryClientWith(REDIRECT);

    const error = await caught(
      loadProductPage({
        context: { queryClient, viewer: null },
        params: { handle: 'old-notes' },
        location: { search: { utm_source: 'share' } },
      }),
    );

    expect(isRedirect(error)).toBe(true);
    if (!isRedirect(error)) {
      throw new Error('転送が投げられていない');
    }
    expect(error.status).toBe(302);
    expect(error.options).toMatchObject({
      to: '/p/$handle',
      params: { handle: 'pitch-notes' },
      search: { utm_source: 'share' },
      statusCode: 302,
    });
  });

  test('詳細ページの取得の失敗はエラーの画面にするため、そのまま投げる', async () => {
    const { queryClient } = queryClientWith(INTERNAL_ERROR);

    const error = await caught(
      loadProductPage({
        context: { queryClient, viewer: null },
        params: { handle: 'pitch-notes' },
        location: LOCATION,
      }),
    );

    expect(error).toBe(INTERNAL_ERROR);
  });
});

describe('withUpdatedLiveMatch', () => {
  test('同じIDのマッチだけをUpvoteの結果に差し替え、操作の結果に無い終了の時刻と他の項目は保つ', () => {
    const updated = matchOf({
      viewerUpvotedEntryId: entryOf('left').id,
      entries: [entryOf('left', { upvoteCount: 13 }), entryOf('right')],
    });

    const next = withUpdatedLiveMatch(LIVE, updated);

    expect(next.productLiveMatch).toStrictEqual({
      serverTime: '2026-11-10T12:00:00.000Z',
      awaitingChange: false,
      match: { ...updated, endsAt: ENDS_AT },
    });
    expect(LIVE.productLiveMatch?.match?.viewerUpvotedEntryId).toBeNull();
  });

  test('別のマッチ・マッチが無い・表示できない・取得の結果が無いキャッシュは変えない', () => {
    const noMatch: ClientProductLiveMatchQuery = {
      productLiveMatch: {
        serverTime: '2026-11-10T12:00:00.000Z',
        awaitingChange: true,
        match: null,
      },
    };
    const hidden: ClientProductLiveMatchQuery = { productLiveMatch: null };

    expect(
      withUpdatedLiveMatch(LIVE, matchOf({ id: '01JD0MATCH0000000000000099' })),
    ).toBe(LIVE);
    expect(withUpdatedLiveMatch(noMatch, matchOf())).toBe(noMatch);
    expect(withUpdatedLiveMatch(hidden, matchOf())).toBe(hidden);
    expect(withUpdatedLiveMatch(undefined, matchOf())).toBeUndefined();
  });
});

const followStatusOf = (
  viewerRelation: 'OWNER' | 'FOLLOWING' | 'NOT_FOLLOWING',
): ClientOwnerFollowStatusQuery => ({
  publicProfile: { __typename: 'PublicProfile', viewerRelation },
});

const OWNER_REDIRECT: ClientOwnerFollowStatusQuery = {
  publicProfile: { __typename: 'PublicProfileRedirect' },
};

const OWNER_MISSING: ClientOwnerFollowStatusQuery = { publicProfile: null };

describe('ownerFollowStatusQueryOptions', () => {
  test('フォロー中の照会の操作と投稿者のハンドルの後に、閲覧者のIDか未ログインの印をキーへ加える', () => {
    expect([
      ...ownerFollowStatusQueryOptions(VIEWER, 'scout_ken').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientOwnerFollowStatusDocument, {
        handle: 'scout_ken',
      }),
      VIEWER.id,
    ]);
    expect(
      ownerFollowStatusQueryOptions(null, 'scout_ken').queryKey.at(-1),
    ).toBe('guest');
  });
});

describe('ownerFollowingOf', () => {
  test('フォロー中なら真、未フォローなら偽を返す', () => {
    expect(ownerFollowingOf(followStatusOf('FOLLOWING'))).toBe(true);
    expect(ownerFollowingOf(followStatusOf('NOT_FOLLOWING'))).toBe(false);
  });

  test('本人・転送・見つからない投稿者はフォローの対象にならないためundefinedを返す', () => {
    expect(ownerFollowingOf(followStatusOf('OWNER'))).toBeUndefined();
    expect(ownerFollowingOf(OWNER_REDIRECT)).toBeUndefined();
    expect(ownerFollowingOf(OWNER_MISSING)).toBeUndefined();
  });
});

describe('withOwnerFollowing', () => {
  test('フォロー・解除の結果で関係だけを合わせ、元の結果は変えない', () => {
    const notFollowing = followStatusOf('NOT_FOLLOWING');

    expect(withOwnerFollowing(notFollowing, true)).toStrictEqual(
      followStatusOf('FOLLOWING'),
    );
    expect(
      withOwnerFollowing(followStatusOf('FOLLOWING'), false),
    ).toStrictEqual(notFollowing);
    expect(notFollowing).toStrictEqual(followStatusOf('NOT_FOLLOWING'));
  });

  test('本人・転送・見つからない投稿者・取得の結果が無いキャッシュは変えない', () => {
    const owner = followStatusOf('OWNER');

    expect(withOwnerFollowing(owner, true)).toBe(owner);
    expect(withOwnerFollowing(OWNER_REDIRECT, true)).toBe(OWNER_REDIRECT);
    expect(withOwnerFollowing(OWNER_MISSING, true)).toBe(OWNER_MISSING);
    expect(withOwnerFollowing(undefined, true)).toBeUndefined();
  });
});

describe('productOwnerStatusQueryOptions', () => {
  test('投稿者本人向けの照会の操作とプロダクトのハンドルの後に、閲覧者のIDか未ログインの印をキーへ加える', () => {
    expect([
      ...productOwnerStatusQueryOptions(VIEWER, 'Pitch-Notes').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientProductOwnerStatusDocument, {
        productHandle: 'Pitch-Notes',
      }),
      VIEWER.id,
    ]);
    expect(
      productOwnerStatusQueryOptions(null, 'Pitch-Notes').queryKey.at(-1),
    ).toBe('guest');
  });
});

const QUALIFIER_BLOCK_MESSAGE =
  'このプロダクトは予選マッチに参加中のため再ローンチできません。';

const QUALIFIER_LOCK_MESSAGE =
  'マッチ直前・マッチ中のため、ローンチ日・カテゴリの変更と削除はできません。';

describe('toOwnerLaunchPlan', () => {
  test('次回のローンチの予約の状態を自分のプロダクトの画面と同じ形にする', () => {
    const status: ClientProductOwnerStatusQuery = {
      productOwnerStatus: {
        latestLaunch: null,
        plan: {
          mode: 'BLOCKED',
          currentLaunchDate: null,
          window: null,
          blocks: [
            {
              code: 'qualifier_in_progress',
              message: QUALIFIER_BLOCK_MESSAGE,
              releaseAt: null,
            },
          ],
          locked: true,
          locks: [{ code: 'qualifier_match', message: QUALIFIER_LOCK_MESSAGE }],
          lockUnknown: false,
          ultrasEntitled: false,
        },
      },
    };

    expect(toOwnerLaunchPlan(status)).toStrictEqual({
      mode: 'blocked',
      currentLaunchDate: null,
      window: null,
      blocks: [
        {
          code: 'qualifier_in_progress',
          message: QUALIFIER_BLOCK_MESSAGE,
          releaseAt: null,
        },
      ],
      locked: true,
      locks: [{ code: 'qualifier_match', message: QUALIFIER_LOCK_MESSAGE }],
      lockUnknown: false,
      ultrasEntitled: false,
    });
  });

  test('現在のハンドルで本人のプロダクトが見つからなければundefinedを返す', () => {
    expect(toOwnerLaunchPlan({ productOwnerStatus: null })).toBeUndefined();
  });
});

const SUPPORTERS_TARGET = {
  productHandle: 'Pitch-Notes',
  matchId: '01JD0MATCH0000000000000001',
  entryId: '01JD0ENTRY0000000000000001',
} as const;

const supporterOf = (handle: string) => ({
  handle,
  nickname: `${handle}さん`,
  avatar: null,
});

const supportersPageOf = (
  handles: readonly string[],
  pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  },
): ClientMatchSupportersQuery => ({
  matchSupporters: {
    nodes: handles.map(supporterOf),
    pageInfo: { ...pageInfo },
  },
});

const supportersDataOf = (
  ...pages: ClientMatchSupportersQuery[]
): InfiniteData<ClientMatchSupportersQuery, string | null> => ({
  pages,
  pageParams: pages.map((_page, index) =>
    index === 0 ? null : `cursor-${String(index)}`,
  ),
});

const nextSupportersPageParamOf = (page: ClientMatchSupportersQuery) =>
  matchSupportersQueryOptions(VIEWER, SUPPORTERS_TARGET).getNextPageParam(
    page,
    [page],
    null,
    [null],
  );

describe('matchSupportersQueryOptions', () => {
  test('サポーターの一覧の操作とプロダクト・マッチ・出場と1ページの件数の後に、閲覧者のIDか未ログインの印をキーへ加える', () => {
    expect([
      ...matchSupportersQueryOptions(VIEWER, SUPPORTERS_TARGET).queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientMatchSupportersDocument, {
        ...SUPPORTERS_TARGET,
        first: MATCH_SUPPORTERS_PAGE_SIZE,
      }),
      VIEWER.id,
    ]);
    expect(
      matchSupportersQueryOptions(null, SUPPORTERS_TARGET).queryKey.at(-1),
    ).toBe('guest');
  });

  test('1ページは20件で、最初のページはカーソルを持たない', () => {
    expect(MATCH_SUPPORTERS_PAGE_SIZE).toBe(20);
    expect(
      matchSupportersQueryOptions(VIEWER, SUPPORTERS_TARGET).initialPageParam,
    ).toBeNull();
  });

  test('続きがあれば最後の項目のカーソルを次のページの位置にする', () => {
    expect(
      nextSupportersPageParamOf(
        supportersPageOf(['a'], { hasNextPage: true, endCursor: 'cursor-1' }),
      ),
    ).toBe('cursor-1');
  });

  test.each([
    [
      '続きが無い',
      supportersPageOf(['a'], { hasNextPage: false, endCursor: 'cursor-1' }),
    ],
    [
      'カーソルが無い',
      supportersPageOf([], { hasNextPage: true, endCursor: null }),
    ],
    ['マッチを表示できない', { matchSupporters: null }],
  ])('%sなら次のページを持たない', (_case, page) => {
    expect(nextSupportersPageParamOf(page)).toBeUndefined();
  });
});

describe('toMatchSupporters', () => {
  test('読み込んだページのサポーターを順に1つの並びにし、表示できなくなったページ(null)は加えない', () => {
    expect(
      toMatchSupporters(
        supportersDataOf(
          supportersPageOf(['a', 'b'], {
            hasNextPage: true,
            endCursor: 'cursor-1',
          }),
          { matchSupporters: null },
          supportersPageOf(['c'], { hasNextPage: false, endCursor: null }),
        ),
      ),
    ).toStrictEqual([supporterOf('a'), supporterOf('b'), supporterOf('c')]);
  });
});
