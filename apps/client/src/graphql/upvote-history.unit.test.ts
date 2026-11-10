import { describe, expect, test } from 'bun:test';
import type { InfiniteData } from '@tanstack/react-query';

import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientUpvoteHistoryDocument,
  type ClientUpvoteHistoryQuery,
} from './generated/graphql.ts';
import {
  toUpvoteHistoryView,
  UPVOTE_HISTORY_PAGE_SIZE,
  upvoteHistoryQueryOptions,
} from './upvote-history.ts';
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

type HistoryConnection = NonNullable<ClientUpvoteHistoryQuery['upvoteHistory']>;
type HistoryNode = HistoryConnection['nodes'][number];

const nodeOf = (
  id: string,
  date: string,
  overrides: Partial<HistoryNode> = {},
): HistoryNode => ({
  id,
  date,
  kind: 'QUALIFIER',
  round: null,
  stage: null,
  live: false,
  product: {
    handle: `product-${id}`,
    name: `プロダクト${id}`,
    listed: true,
    logo: null,
  },
  owner: { handle: 'maker_ai', nickname: 'AIの作り手', avatar: null },
  ...overrides,
});

const connectionOf = (
  nodes: readonly HistoryNode[],
  overrides: Partial<HistoryConnection> = {},
): ClientUpvoteHistoryQuery => ({
  upvoteHistory: {
    totalCount: nodes.length,
    dateTotals: [],
    nodes: [...nodes],
    pageInfo: { endCursor: null, hasNextPage: false },
    ...overrides,
  },
});

const dataOf = (
  ...pages: ClientUpvoteHistoryQuery[]
): InfiniteData<ClientUpvoteHistoryQuery, string | null> => ({
  pages,
  pageParams: pages.map((_page, index) =>
    index === 0 ? null : `cursor-${String(index)}`,
  ),
});

const nextPageParamOf = (page: ClientUpvoteHistoryQuery) =>
  upvoteHistoryQueryOptions(VIEWER, 'pitch_maker').getNextPageParam(
    page,
    [page],
    null,
    [null],
  );

describe('upvoteHistoryQueryOptions', () => {
  test('キーは操作の識別子と利用者のハンドルと1ページの件数で始まる', () => {
    expect(
      upvoteHistoryQueryOptions(VIEWER, 'pitch_maker').queryKey.slice(
        0,
        2,
      ) as readonly unknown[],
    ).toStrictEqual(
      graphqlQueryKey(ClientUpvoteHistoryDocument, {
        userHandle: 'pitch_maker',
        first: UPVOTE_HISTORY_PAGE_SIZE,
      }),
    );
  });

  test('停止中の利用者を本人だけが見られるため、閲覧者ごと・未ログインで別のキーにする', () => {
    const keys = [VIEWER, OTHER_VIEWER, null].map((viewer) =>
      JSON.stringify(upvoteHistoryQueryOptions(viewer, 'pitch_maker').queryKey),
    );

    expect(new Set(keys).size).toBe(3);
  });

  test('1ページは20件で、最初のページはカーソルを持たない', () => {
    expect(UPVOTE_HISTORY_PAGE_SIZE).toBe(20);
    expect(
      upvoteHistoryQueryOptions(VIEWER, 'pitch_maker').initialPageParam,
    ).toBeNull();
  });

  test('続きがあれば最後の項目のカーソルを次のページの位置にする', () => {
    expect(
      nextPageParamOf(
        connectionOf([nodeOf('a', '2026-10-02')], {
          pageInfo: { endCursor: '2026-10-02:a', hasNextPage: true },
        }),
      ),
    ).toBe('2026-10-02:a');
  });

  test.each([
    ['続きが無い', connectionOf([nodeOf('a', '2026-10-02')])],
    [
      'カーソルが無い',
      connectionOf([], { pageInfo: { endCursor: null, hasNextPage: true } }),
    ],
    ['利用者を表示できない', { upvoteHistory: null }],
  ])('%sなら次のページを持たない', (_case, page) => {
    expect(nextPageParamOf(page)).toBeUndefined();
  });
});

describe('toUpvoteHistoryView', () => {
  test('利用者を表示できなければnullを返す', () => {
    expect(toUpvoteHistoryView(dataOf({ upvoteHistory: null }))).toBeNull();
  });

  test('項目を実施日ごとにまとめ、各日の件数は読み込んだ数ではなくその日の総数にする', () => {
    const view = toUpvoteHistoryView(
      dataOf(
        connectionOf(
          [
            nodeOf('a', '2026-10-02'),
            nodeOf('b', '2026-10-02'),
            nodeOf('c', '2026-09-30'),
          ],
          {
            totalCount: 1234,
            dateTotals: [
              { date: '2026-10-02', count: 2 },
              { date: '2026-09-30', count: 5 },
            ],
          },
        ),
      ),
    );

    expect(view?.totalCount).toBe(1234);
    expect(
      view?.days.map(({ date, count, items }) => ({
        date,
        count,
        ids: items.map(({ id }) => id),
      })),
    ).toStrictEqual([
      { date: '2026-10-02', count: 2, ids: ['a', 'b'] },
      { date: '2026-09-30', count: 5, ids: ['c'] },
    ]);
    expect(view?.itemCount).toBe(3);
  });

  test('続きのページの同じ日の項目は前のページの日へ加え、件数は最初に受け取った総数を保つ', () => {
    const view = toUpvoteHistoryView(
      dataOf(
        connectionOf([nodeOf('a', '2026-09-30')], {
          totalCount: 7,
          dateTotals: [{ date: '2026-09-30', count: 5 }],
        }),
        connectionOf([nodeOf('b', '2026-09-30'), nodeOf('c', '2026-09-28')], {
          totalCount: 9,
          dateTotals: [
            { date: '2026-09-30', count: 6 },
            { date: '2026-09-28', count: 2 },
          ],
        }),
      ),
    );

    expect(view?.totalCount).toBe(7);
    expect(
      view?.days.map(({ date, count, items }) => ({
        date,
        count,
        ids: items.map(({ id }) => id),
      })),
    ).toStrictEqual([
      { date: '2026-09-30', count: 5, ids: ['a', 'b'] },
      { date: '2026-09-28', count: 2, ids: ['c'] },
    ]);
  });

  test('続きのページに既出のマッチの項目があれば、最初に読み込んだ項目だけを残す', () => {
    const view = toUpvoteHistoryView(
      dataOf(
        connectionOf([nodeOf('a', '2026-10-02'), nodeOf('b', '2026-10-01')]),
        connectionOf([
          nodeOf('b', '2026-10-01', { live: true }),
          nodeOf('c', '2026-09-30'),
        ]),
      ),
    );

    expect(
      view?.days.flatMap(({ items }) =>
        items.map(({ id, live }) => ({ id, live })),
      ),
    ).toStrictEqual([
      { id: 'a', live: false },
      { id: 'b', live: false },
      { id: 'c', live: false },
    ]);
    expect(view?.itemCount).toBe(3);
  });

  test('続きのページの取得の間に利用者を表示できなくなったページは項目に加えない', () => {
    const view = toUpvoteHistoryView(
      dataOf(connectionOf([nodeOf('a', '2026-10-02')]), {
        upvoteHistory: null,
      }),
    );

    expect(view?.itemCount).toBe(1);
  });

  test('その日の総数を受け取っていない日は、読み込んだ項目の数を示す', () => {
    const view = toUpvoteHistoryView(
      dataOf(
        connectionOf([nodeOf('a', '2026-10-02'), nodeOf('b', '2026-10-02')]),
      ),
    );

    expect(view?.days[0]?.count).toBe(2);
  });
});
