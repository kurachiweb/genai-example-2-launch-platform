import { describe, expect, test } from 'bun:test';
import { type InfiniteData, QueryClient } from '@tanstack/react-query';

import {
  graphqlResponse,
  htmlResponse,
  recordingApi,
  renderContextOf,
  runInStartRequest,
} from '../../lib/test/start-request-fixtures.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientLaunchHistoryDocument,
  type ClientLaunchHistoryQuery,
  ClientProfileAwardsDocument,
} from './generated/graphql.ts';
import {
  LAUNCH_HISTORY_PAGE_SIZE,
  launchHistoryQueryOptions,
  profileAwardsQueryOptions,
  toLaunchHistoryView,
  toProfileAwardViews,
} from './launch-history.ts';
import type { ClientViewer } from './viewer.ts';

const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

const OTHER_VIEWER: ClientViewer = {
  ...VIEWER,
  id: '01JC0VIEWER0000000000000001',
  handle: 'scout_ken',
};

type HistoryConnection = NonNullable<ClientLaunchHistoryQuery['launchHistory']>;
type HistoryNode = HistoryConnection['nodes'][number];

const LOGO = {
  id: '01JD0FILE00000000000000001',
  objectKey: '0123456789abcdef'.repeat(2),
  fallbackFormat: 'PNG' as const,
  width: 512,
  height: 512,
};

const LISTED_NODE: HistoryNode = {
  product: {
    handle: 'pitch-deck',
    name: 'ピッチデッキ',
    tagline: '5分でピッチの資料を作る',
    category: {
      id: '01JD0CATEGORY0000000000001',
      name: '開発ツール',
      handle: 'dev-tools',
    },
    websiteUrl: 'https://pitch-deck.example',
    logo: LOGO,
    listed: true,
  },
  launches: [
    {
      id: '01JD0LAUNCH000000000000002',
      number: 2,
      launchDate: '2026-11-12',
      kickoffAt: '2026-11-11T15:00:00.000Z',
      status: 'IN_PROGRESS',
      outcome: null,
      summary: { label: '予選マッチ中', inMatch: true },
    },
    {
      id: '01JD0LAUNCH000000000000001',
      number: 1,
      launchDate: '2026-10-01',
      kickoffAt: '2026-09-30T15:00:00.000Z',
      status: 'FINISHED',
      outcome: 'WON',
      summary: { label: '予選マッチ勝利', inMatch: false },
    },
  ],
  awards: [
    { kind: 'YEAR', count: 1, labels: ['2026年'] },
    { kind: 'WEEK', count: 2, labels: ['2026年第40週', '2026年第41週'] },
  ],
};

const UNLISTED_NODE: HistoryNode = {
  product: {
    ...LISTED_NODE.product,
    handle: 'side-tool',
    name: 'サイドツール',
    logo: null,
    listed: false,
  },
  launches: [],
  awards: [],
};

const connectionOf = (
  nodes: readonly HistoryNode[],
  overrides: Partial<HistoryConnection> = {},
): ClientLaunchHistoryQuery => ({
  launchHistory: {
    viewerIsOwner: false,
    ownerSuspended: false,
    totalCount: 2,
    nodes: [...nodes],
    pageInfo: { endCursor: null, hasNextPage: false },
    ...overrides,
  },
});

const FIRST_PAGE = connectionOf([LISTED_NODE], {
  pageInfo: { endCursor: 'cursor-1', hasNextPage: true },
});

const dataOf = (
  ...pages: ClientLaunchHistoryQuery[]
): InfiniteData<ClientLaunchHistoryQuery, string | null> => ({
  pages,
  pageParams: pages.map((_page, index) =>
    index === 0 ? null : `cursor-${String(index)}`,
  ),
});

const nextPageParamOf = (page: ClientLaunchHistoryQuery) =>
  launchHistoryQueryOptions(VIEWER, 'pitch_maker').getNextPageParam(
    page,
    [page],
    null,
    [null],
  );

describe('launchHistoryQueryOptions', () => {
  test('キーは操作の識別子と利用者のハンドルと1ページの件数で始まる', () => {
    expect(
      launchHistoryQueryOptions(VIEWER, 'pitch_maker').queryKey.slice(
        0,
        2,
      ) as readonly unknown[],
    ).toStrictEqual(
      graphqlQueryKey(ClientLaunchHistoryDocument, {
        userHandle: 'pitch_maker',
        first: LAUNCH_HISTORY_PAGE_SIZE,
      }),
    );
  });

  test('本人かどうかで対象が変わるため、閲覧者ごと・未ログインで別のキーにする', () => {
    const keys = [VIEWER, OTHER_VIEWER, null].map((viewer) =>
      JSON.stringify(launchHistoryQueryOptions(viewer, 'pitch_maker').queryKey),
    );

    expect(new Set(keys).size).toBe(3);
  });

  test('1ページは20件で、最初のページはカーソルを持たない', () => {
    expect(LAUNCH_HISTORY_PAGE_SIZE).toBe(20);
    expect(
      launchHistoryQueryOptions(VIEWER, 'pitch_maker').initialPageParam,
    ).toBeNull();
  });

  test('続きがあれば最後の項目のカーソルを次のページの位置にする', () => {
    expect(nextPageParamOf(FIRST_PAGE)).toBe('cursor-1');
  });

  test.each([
    ['続きが無い', connectionOf([LISTED_NODE])],
    [
      'カーソルが無い',
      connectionOf([], { pageInfo: { endCursor: null, hasNextPage: true } }),
    ],
    ['利用者を表示できない', { launchHistory: null }],
  ])('%sなら次のページを持たない', (_case, page) => {
    expect(nextPageParamOf(page)).toBeUndefined();
  });
});

describe('toLaunchHistoryView', () => {
  test('読み込んだページの項目を順に1つの並びにし、件数と閲覧者の関係は最初のページから読む', () => {
    const view = toLaunchHistoryView(
      dataOf(FIRST_PAGE, connectionOf([UNLISTED_NODE], { totalCount: 9 })),
    );

    expect(view).toMatchObject({
      viewerIsOwner: false,
      ownerSuspended: false,
      totalCount: 2,
      hasUnlistedOwnProduct: false,
    });
    expect(view?.items.map(({ product }) => product.handle)).toStrictEqual([
      'pitch-deck',
      'side-tool',
    ]);
  });

  test('ローンチと受賞を画面の値へ写し、プロダクトの項目を残す', () => {
    expect(toLaunchHistoryView(dataOf(FIRST_PAGE))?.items[0]).toStrictEqual({
      product: LISTED_NODE.product,
      launches: [
        {
          id: '01JD0LAUNCH000000000000002',
          number: 2,
          launchDate: '2026-11-12',
          kickoffAt: '2026-11-11T15:00:00.000Z',
          status: 'in_progress',
          outcome: null,
          summary: { label: '予選マッチ中', inMatch: true },
        },
        {
          id: '01JD0LAUNCH000000000000001',
          number: 1,
          launchDate: '2026-10-01',
          kickoffAt: '2026-09-30T15:00:00.000Z',
          status: 'finished',
          outcome: 'won',
          summary: { label: '予選マッチ勝利', inMatch: false },
        },
      ],
      awards: [
        { kind: 'year', count: 1, labels: ['2026年'] },
        { kind: 'week', count: 2, labels: ['2026年第40週', '2026年第41週'] },
      ],
    });
  });

  test('本人の一覧に未掲載のプロダクトがあれば、本人にだけ見える旨の案内を出す', () => {
    const owner = { viewerIsOwner: true, ownerSuspended: true };

    expect(
      toLaunchHistoryView(
        dataOf(connectionOf([LISTED_NODE, UNLISTED_NODE], owner)),
      ),
    ).toMatchObject({ ...owner, hasUnlistedOwnProduct: true });
    expect(
      toLaunchHistoryView(dataOf(connectionOf([LISTED_NODE], owner)))
        ?.hasUnlistedOwnProduct,
    ).toBe(false);
  });

  test('利用者を表示できなければnullにし、途中のページのnullは項目に含めない', () => {
    expect(toLaunchHistoryView(dataOf({ launchHistory: null }))).toBeNull();
    expect(
      toLaunchHistoryView(dataOf(FIRST_PAGE, { launchHistory: null }))?.items,
    ).toHaveLength(1);
  });
});

describe('profileAwardsQueryOptions・toProfileAwardViews', () => {
  test('キーは操作の識別子と利用者のハンドルで始まり、閲覧者ごと・未ログインで別のキーにする', () => {
    expect(
      profileAwardsQueryOptions(null, 'pitch_maker').queryKey.slice(
        0,
        2,
      ) as readonly unknown[],
    ).toStrictEqual(
      graphqlQueryKey(ClientProfileAwardsDocument, {
        userHandle: 'pitch_maker',
      }),
    );
    const keys = [VIEWER, OTHER_VIEWER, null].map((viewer) =>
      JSON.stringify(profileAwardsQueryOptions(viewer, 'pitch_maker').queryKey),
    );

    expect(new Set(keys).size).toBe(3);
  });

  test('受賞をAPIの順(Yearが先頭)のまま画面の値へ写す', () => {
    expect(
      toProfileAwardViews({
        profileAwards: [
          { kind: 'YEAR', count: 1, labels: ['ピッチデッキ 2026年'] },
          {
            kind: 'WEEK',
            count: 3,
            labels: [
              'ピッチデッキ 2026年第40週',
              'ピッチデッキ 2026年第41週',
              'サイドツール 2026年第44週',
            ],
          },
        ],
      }),
    ).toStrictEqual([
      { kind: 'year', count: 1, labels: ['ピッチデッキ 2026年'] },
      {
        kind: 'week',
        count: 3,
        labels: [
          'ピッチデッキ 2026年第40週',
          'ピッチデッキ 2026年第41週',
          'サイドツール 2026年第44週',
        ],
      },
    ]);
  });

  test('利用者を表示できないnullと受賞の無い空の配列は、どちらも区画を出さない空の並びにする', () => {
    expect(toProfileAwardViews({ profileAwards: null })).toStrictEqual([]);
    expect(toProfileAwardViews({ profileAwards: [] })).toStrictEqual([]);
  });
});

describe('取得の処理', () => {
  test('最初のページは利用者と件数、続きのページはカーソルも変数にして実行する', async () => {
    const api = recordingApi(() =>
      Promise.resolve(graphqlResponse({ data: FIRST_PAGE })),
    );
    const queryClient = new QueryClient();
    await runInStartRequest({
      context: renderContextOf({ api, reported: [] }),
      render: async () => {
        const options = launchHistoryQueryOptions(null, 'pitch_maker');
        await queryClient.infiniteQuery(options);
        await queryClient.infiniteQuery({ ...options, pages: 2 });
        await queryClient.query(profileAwardsQueryOptions(null, 'pitch_maker'));
        return htmlResponse();
      },
    });
    const sent = await Promise.all(
      api.requests.map((request) => request.json()),
    );
    const variables = {
      userHandle: 'pitch_maker',
      first: LAUNCH_HISTORY_PAGE_SIZE,
    };
    const documentId = documentIdOf(ClientLaunchHistoryDocument);

    expect(sent).toStrictEqual([
      { documentId, variables },
      { documentId, variables },
      { documentId, variables: { ...variables, after: 'cursor-1' } },
      {
        documentId: documentIdOf(ClientProfileAwardsDocument),
        variables: { userHandle: 'pitch_maker' },
      },
    ]);
  });
});
