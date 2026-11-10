import { describe, expect, mock, test } from 'bun:test';
import type { QueryClient } from '@tanstack/react-query';
import { isNotFound, isRedirect } from '@tanstack/react-router';

import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import { entryOf, matchOf } from '../components/match/match-fixtures.ts';
import {
  ClientProductLiveMatchDocument,
  type ClientProductLiveMatchQuery,
  ClientProductPageDocument,
  type ClientProductPageQuery,
} from './generated/graphql.ts';
import {
  loadProductPage,
  productLiveMatchQueryOptions,
  productPageQueryOptions,
  type ProductPageView,
  toProductPageView,
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

const LOCATION = { searchStr: '' };

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

  test('旧ハンドルは現在のハンドルのパスへ、状態コード302とクエリを引き継いで転送する', async () => {
    const { queryClient } = queryClientWith(REDIRECT);

    const error = await caught(
      loadProductPage({
        context: { queryClient, viewer: null },
        params: { handle: 'old-notes' },
        location: { searchStr: '?utm_source=share' },
      }),
    );

    expect(isRedirect(error)).toBe(true);
    if (!isRedirect(error)) {
      throw new Error('転送が投げられていない');
    }
    expect(error.status).toBe(302);
    expect(error.options).toMatchObject({
      href: '/p/pitch-notes?utm_source=share',
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
