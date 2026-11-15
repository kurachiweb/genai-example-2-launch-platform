import { describe, expect, mock, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { isNotFound, isRedirect } from '@tanstack/react-router';

import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientPublicProfileDocument,
  type ClientPublicProfileQuery,
} from './generated/graphql.ts';
import {
  loadPublicProfile,
  publicProfileQueryOptions,
  toPublicProfileView,
  withFollowState,
} from './public-profile.ts';
import type { ClientViewer } from './viewer.ts';

const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

const PROFILE: ClientPublicProfileQuery = {
  publicProfile: {
    __typename: 'PublicProfile',
    handle: 'Maker_AI',
    nickname: 'AIの作り手',
    headline: null,
    bio: null,
    avatar: null,
    websites: [],
    followerCount: 12,
    ultras: false,
    suspended: false,
    viewerRelation: 'NOT_FOLLOWING',
  },
};

const REDIRECT: ClientPublicProfileQuery = {
  publicProfile: { __typename: 'PublicProfileRedirect', handle: 'maker_ai' },
};

const MISSING: ClientPublicProfileQuery = { publicProfile: null };

const INTERNAL_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const cachedQueryClient = (): QueryClient =>
  new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });

const queryClientWith = (
  viewer: ClientViewer | null,
  handle: string,
  data: ClientPublicProfileQuery,
): QueryClient => {
  const queryClient = cachedQueryClient();
  queryClient.setQueryData(
    publicProfileQueryOptions(viewer, handle).queryKey,
    data,
  );
  return queryClient;
};

const failingQueryClient = (error: Error) =>
  ({ query: () => Promise.reject(error) }) as unknown as QueryClient;

const LOCATION = { search: {} };

const caught = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  );

describe('publicProfileQueryOptions', () => {
  test('公開プロフィールの操作とハンドルの後に、閲覧者のIDをキーへ加える', () => {
    expect([...publicProfileQueryOptions(VIEWER, 'maker_ai').queryKey]).toEqual(
      [
        ...graphqlQueryKey(ClientPublicProfileDocument, {
          handle: 'maker_ai',
        }),
        VIEWER.id,
      ],
    );
  });

  test('未ログインは閲覧者のIDの代わりにguestをキーへ加え、ログインした閲覧者とキャッシュを分ける', () => {
    const guestKey = publicProfileQueryOptions(null, 'maker_ai').queryKey;

    expect(guestKey.at(-1)).toBe('guest');
    expect(guestKey).not.toEqual(
      publicProfileQueryOptions(VIEWER, 'maker_ai').queryKey,
    );
  });
});

describe('toPublicProfileView', () => {
  test('人物情報はそのまま返す', () => {
    expect(toPublicProfileView(PROFILE)).toMatchObject({
      handle: 'Maker_AI',
      nickname: 'AIの作り手',
      followerCount: 12,
    });
  });

  test.each([
    ['転送', REDIRECT],
    ['存在しない', MISSING],
  ])('%sはundefinedにする', (_label, data) => {
    expect(toPublicProfileView(data)).toBeUndefined();
  });
});

describe('withFollowState', () => {
  test('フォローした結果のフォロワー数とフォロー中の関係へ更新する', () => {
    const next = withFollowState(PROFILE, {
      following: true,
      followerCount: 13,
    });

    expect(toPublicProfileView(next)).toMatchObject({
      followerCount: 13,
      viewerRelation: 'FOLLOWING',
      nickname: 'AIの作り手',
    });
  });

  test('解除した結果のフォロワー数とフォローしていない関係へ更新する', () => {
    const following = withFollowState(PROFILE, {
      following: true,
      followerCount: 13,
    });

    const next = withFollowState(following, {
      following: false,
      followerCount: 12,
    });

    expect(toPublicProfileView(next)).toMatchObject({
      followerCount: 12,
      viewerRelation: 'NOT_FOLLOWING',
    });
  });

  test('元のデータを書き換えない', () => {
    withFollowState(PROFILE, { following: true, followerCount: 99 });

    expect(toPublicProfileView(PROFILE)).toMatchObject({
      followerCount: 12,
      viewerRelation: 'NOT_FOLLOWING',
    });
  });

  test.each([
    ['転送', REDIRECT],
    ['存在しない', MISSING],
  ])('%sのデータは変えない', (_label, data) => {
    expect(withFollowState(data, { following: true, followerCount: 1 })).toBe(
      data,
    );
  });

  test('キャッシュに無い値(undefined)はundefinedのまま返す', () => {
    expect(
      withFollowState(undefined, { following: true, followerCount: 1 }),
    ).toBeUndefined();
  });
});

describe('loadPublicProfile', () => {
  test('現在のハンドルの表記とニックネームを、ページのheadの値として返す', async () => {
    const queryClient = queryClientWith(VIEWER, 'maker_ai', PROFILE);

    const data = await loadPublicProfile({
      context: { queryClient, viewer: VIEWER },
      params: { handle: 'maker_ai' },
      location: LOCATION,
    });

    expect(data).toStrictEqual({ handle: 'Maker_AI', nickname: 'AIの作り手' });
  });

  test.each(['', 'a b', 'ユーザー', '-leading', 'a'.repeat(26), 'a.b'])(
    'ハンドルの形式違反(%p)は照会せずに存在しないページにする',
    async (handle) => {
      const query = mock(() => Promise.resolve(PROFILE));
      const queryClient = { query } as unknown as QueryClient;

      const error = await caught(
        loadPublicProfile({
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
    const error = await caught(
      loadPublicProfile({
        context: {
          queryClient: queryClientWith(null, 'nobody', MISSING),
          viewer: null,
        },
        params: { handle: 'nobody' },
        location: LOCATION,
      }),
    );

    expect(isNotFound(error)).toBe(true);
  });

  test('旧ハンドルは現在のハンドルのパスへ、状態コード302とクエリを引き継いで転送する', async () => {
    const error = await caught(
      loadPublicProfile({
        context: {
          queryClient: queryClientWith(null, 'old_name', REDIRECT),
          viewer: null,
        },
        params: { handle: 'old_name' },
        location: { search: { tab: 'upvotes', utm_source: 'share' } },
      }),
    );

    expect(isRedirect(error)).toBe(true);
    if (!isRedirect(error)) {
      throw new Error('転送が投げられていない');
    }
    expect(error.status).toBe(302);
    expect(error.options).toMatchObject({
      to: '/@{$handle}',
      params: { handle: 'maker_ai' },
      search: { tab: 'upvotes', utm_source: 'share' },
      statusCode: 302,
    });
  });

  test('取得の失敗はエラーの画面にするため、そのまま投げる', async () => {
    const error = await caught(
      loadPublicProfile({
        context: {
          queryClient: failingQueryClient(INTERNAL_ERROR),
          viewer: null,
        },
        params: { handle: 'maker_ai' },
        location: LOCATION,
      }),
    );

    expect(error).toBe(INTERNAL_ERROR);
  });
});
