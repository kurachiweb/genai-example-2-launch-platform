import { describe, expect, test } from 'bun:test';
import { type InfiniteData, QueryClient } from '@tanstack/react-query';

import {
  graphqlResponse,
  htmlResponse,
  recordingApi,
  renderContextOf,
  runInStartRequest,
} from '../../lib/test/start-request-fixtures.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientMyFollowersDocument,
  ClientMyFollowingDocument,
} from './generated/graphql.ts';
import {
  FOLLOW_LIST_PAGE_SIZE,
  type FollowListPageData,
  followListQueryOptions,
  loadFollowList,
  toFollowListEntries,
} from './follow-list.ts';
import type { ClientViewer } from './viewer.ts';

const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

const DOCUMENT_IDS = {
  following: documentIdOf(ClientMyFollowingDocument),
  followers: documentIdOf(ClientMyFollowersDocument),
} as const;

type FollowNode = FollowListPageData['nodes'][number];

const MAKER: FollowNode = {
  user: {
    handle: 'maker_ai',
    nickname: 'メーカーAI',
    avatar: {
      id: '01JC0FILE00000000000000001',
      objectKey: '0123456789abcdef'.repeat(2),
      fallbackFormat: 'PNG',
      width: 512,
      height: 512,
    },
  },
  followedAt: '2026-11-04T01:00:00.000Z',
};

const SCOUT: FollowNode = {
  user: { handle: 'scout_ken', nickname: 'スカウトKen', avatar: null },
  followedAt: '2026-11-03T01:00:00.000Z',
};

const pageOf = (
  nodes: readonly FollowNode[],
  endCursor: string | null,
  hasNextPage: boolean,
): FollowListPageData => ({
  nodes: [...nodes],
  pageInfo: { endCursor, hasNextPage },
});

const FIRST_PAGE = pageOf([MAKER], 'cursor-2', true);

const nextPageParamOf = (page: FollowListPageData) =>
  followListQueryOptions(VIEWER.id, 'following').getNextPageParam(
    page,
    [page],
    null,
    [null],
  );

describe('followListQueryOptions', () => {
  test.each(['following', 'followers'] as const)(
    '%sの一覧は、その操作の識別子と1ページの件数で始まり、閲覧者ごとに別のキーにする',
    (direction) => {
      const mine = followListQueryOptions(VIEWER.id, direction).queryKey;
      const other = followListQueryOptions(
        '01JC0VIEWER0000000000000001',
        direction,
      ).queryKey;

      expect(mine.slice(0, 2)).toStrictEqual([
        DOCUMENT_IDS[direction],
        { first: FOLLOW_LIST_PAGE_SIZE },
      ]);
      expect(JSON.stringify(mine)).not.toBe(JSON.stringify(other));
    },
  );

  test('フォロー中とフォロワーは別のキーにする', () => {
    expect(
      JSON.stringify(followListQueryOptions(VIEWER.id, 'following').queryKey),
    ).not.toBe(
      JSON.stringify(followListQueryOptions(VIEWER.id, 'followers').queryKey),
    );
  });

  test('1ページは20件で、最初のページはカーソルを持たない', () => {
    expect(FOLLOW_LIST_PAGE_SIZE).toBe(20);
    expect(
      followListQueryOptions(VIEWER.id, 'following').initialPageParam,
    ).toBeNull();
  });

  test('続きがあれば最後の項目のカーソルを次のページの位置にする', () => {
    expect(nextPageParamOf(FIRST_PAGE)).toBe('cursor-2');
  });

  test.each([
    ['続きが無い', pageOf([MAKER], 'cursor-2', false)],
    ['カーソルが無い', pageOf([], null, true)],
  ])('%sなら次のページを持たない', (_case, page) => {
    expect(nextPageParamOf(page)).toBeUndefined();
  });
});

describe('toFollowListEntries', () => {
  test('読み込んだページの項目を順に1つの並びにし、画像が無い利用者はnullにする', () => {
    const data: InfiniteData<FollowListPageData, string | null> = {
      pages: [FIRST_PAGE, pageOf([SCOUT], null, false)],
      pageParams: [null, 'cursor-2'],
    };

    expect(toFollowListEntries(data)).toStrictEqual([
      {
        handle: 'maker_ai',
        nickname: 'メーカーAI',
        avatar: MAKER.user.avatar,
        followedAt: '2026-11-04T01:00:00.000Z',
      },
      {
        handle: 'scout_ken',
        nickname: 'スカウトKen',
        avatar: null,
        followedAt: '2026-11-03T01:00:00.000Z',
      },
    ]);
  });
});

const responseOf = (direction: 'following' | 'followers') =>
  graphqlResponse({
    data:
      direction === 'following'
        ? { myFollowing: FIRST_PAGE }
        : { myFollowers: FIRST_PAGE },
  });

// 外部へ通信しないよう、描画の文脈のAPIを偽物にしてサーバーの分岐で取得し、APIへ送った識別子と変数を読み取る
const runThroughApi = async (
  run: (queryClient: QueryClient) => Promise<unknown>,
  respond: () => Promise<Response>,
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
  test.each(['following', 'followers'] as const)(
    '%sの最初のページは件数だけ、続きのページは件数とカーソルを変数にして実行する',
    async (direction) => {
      const { sent, result } = await runThroughApi(
        async (queryClient) => {
          const options = followListQueryOptions(VIEWER.id, direction);
          await queryClient.infiniteQuery(options);
          return queryClient.infiniteQuery({ ...options, pages: 2 });
        },
        () => Promise.resolve(responseOf(direction)),
      );

      expect(sent).toStrictEqual([
        {
          documentId: DOCUMENT_IDS[direction],
          variables: { first: FOLLOW_LIST_PAGE_SIZE },
        },
        {
          documentId: DOCUMENT_IDS[direction],
          variables: { first: FOLLOW_LIST_PAGE_SIZE },
        },
        {
          documentId: DOCUMENT_IDS[direction],
          variables: { first: FOLLOW_LIST_PAGE_SIZE, after: 'cursor-2' },
        },
      ]);
      expect(result).toStrictEqual({
        pages: [FIRST_PAGE, FIRST_PAGE],
        pageParams: [null, 'cursor-2'],
      });
    },
  );
});

describe('loadFollowList', () => {
  test('開いたタブの一覧の最初のページだけを読み、続きと他のタブは読まない', async () => {
    const { result, sent } = await runThroughApi(
      async (client) => {
        await loadFollowList({
          context: { queryClient: client, viewer: VIEWER },
          direction: 'followers',
        });
        return client.getQueryData(
          followListQueryOptions(VIEWER.id, 'followers').queryKey,
        );
      },
      () => Promise.resolve(responseOf('followers')),
    );

    expect(result).toStrictEqual({ pages: [FIRST_PAGE], pageParams: [null] });
    expect(sent).toStrictEqual([
      {
        documentId: DOCUMENT_IDS.followers,
        variables: { first: FOLLOW_LIST_PAGE_SIZE },
      },
    ]);
  });

  test('他の画面のフォローの操作を反映するため、キャッシュがあっても取得し直す', async () => {
    const { sent } = await runThroughApi(
      async (client) => {
        const context = { queryClient: client, viewer: VIEWER };
        await loadFollowList({ context, direction: 'following' });
        await loadFollowList({ context, direction: 'following' });
        return undefined;
      },
      () => Promise.resolve(responseOf('following')),
    );

    expect(sent).toHaveLength(2);
  });

  test('取得に失敗しても、一覧の中で再試行できるよう例外にせず失敗をキャッシュに残す', async () => {
    const { result, queryClient } = await runThroughApi(
      (client) =>
        loadFollowList({
          context: { queryClient: client, viewer: VIEWER },
          direction: 'following',
        }).then(() => 'loaded'),
      () => Promise.resolve(new Response('', { status: 503 })),
    );

    expect(result).toBe('loaded');
    expect(
      queryClient.getQueryState(
        followListQueryOptions(VIEWER.id, 'following').queryKey,
      )?.status,
    ).toBe('error');
  });
});
