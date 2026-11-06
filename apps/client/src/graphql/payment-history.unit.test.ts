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
  ClientPaymentHistoryDocument,
  type ClientPaymentHistoryQuery,
} from './generated/graphql.ts';
import {
  loadPaymentHistory,
  PAYMENT_HISTORY_PAGE_SIZE,
  paymentHistoryQueryOptions,
  toPaymentHistoryEntries,
} from './payment-history.ts';
import type { ClientViewer } from './viewer.ts';

const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

type PaymentRecordNode =
  ClientPaymentHistoryQuery['paymentHistory']['nodes'][number];

const PAYMENT: PaymentRecordNode = {
  id: '01JC0PAYREC00000000000002',
  kind: 'ONE_TIME',
  purpose: 'WEEK_TOURNAMENT_ENTRY',
  amount: { amount: 1200, currency: 'usd' },
  quantity: 1,
  status: 'SUCCEEDED',
  occurredAt: '2026-11-04T01:00:00.000Z',
};

const REFUND: PaymentRecordNode = {
  id: '01JC0PAYREC00000000000001',
  kind: 'REFUND',
  purpose: 'WEEK_TOURNAMENT_ENTRY',
  amount: { amount: -1200, currency: 'usd' },
  quantity: null,
  status: 'PENDING',
  occurredAt: '2026-11-03T01:00:00.000Z',
};

const historyPage = (
  nodes: readonly PaymentRecordNode[],
  endCursor: string | null,
  hasNextPage: boolean,
): ClientPaymentHistoryQuery => ({
  paymentHistory: { nodes: [...nodes], pageInfo: { endCursor, hasNextPage } },
});

const FIRST_PAGE = historyPage([PAYMENT], 'cursor-2', true);

const nextPageParamOf = (page: ClientPaymentHistoryQuery) =>
  paymentHistoryQueryOptions(VIEWER.id).getNextPageParam(page, [page], null, [
    null,
  ]);

describe('paymentHistoryQueryOptions', () => {
  test('操作の識別子と1ページの件数で始まり、閲覧者ごとに別のキーにする', () => {
    const mine = paymentHistoryQueryOptions(VIEWER.id).queryKey;
    const other = paymentHistoryQueryOptions(
      '01JC0VIEWER0000000000000001',
    ).queryKey;

    expect(mine.slice(0, 2)).toStrictEqual([
      documentIdOf(ClientPaymentHistoryDocument),
      { first: PAYMENT_HISTORY_PAGE_SIZE },
    ]);
    expect(JSON.stringify(mine)).not.toBe(JSON.stringify(other));
  });

  test('1ページは20件で、最初のページはカーソルを持たない', () => {
    expect(PAYMENT_HISTORY_PAGE_SIZE).toBe(20);
    expect(paymentHistoryQueryOptions(VIEWER.id).initialPageParam).toBeNull();
  });

  test('続きがあれば最後の記録のカーソルを次のページの位置にする', () => {
    expect(nextPageParamOf(FIRST_PAGE)).toBe('cursor-2');
  });

  test.each([
    ['続きが無い', historyPage([PAYMENT], 'cursor-2', false)],
    ['カーソルが無い', historyPage([], null, true)],
  ])('%sなら次のページを持たない', (_case, page) => {
    expect(nextPageParamOf(page)).toBeUndefined();
  });
});

describe('toPaymentHistoryEntries', () => {
  test('読み込んだページの記録を順に1つの並びにし、種類・購入種別・状態を表示の名前の値にする', () => {
    const data: InfiniteData<ClientPaymentHistoryQuery, string | null> = {
      pages: [FIRST_PAGE, historyPage([REFUND], null, false)],
      pageParams: [null, 'cursor-2'],
    };

    expect(toPaymentHistoryEntries(data)).toStrictEqual([
      {
        id: '01JC0PAYREC00000000000002',
        kind: 'one_time',
        purpose: 'week_tournament_entry',
        amount: 1200,
        quantity: 1,
        status: 'succeeded',
        occurredAt: '2026-11-04T01:00:00.000Z',
      },
      {
        id: '01JC0PAYREC00000000000001',
        kind: 'refund',
        purpose: 'week_tournament_entry',
        amount: -1200,
        quantity: null,
        status: 'pending',
        occurredAt: '2026-11-03T01:00:00.000Z',
      },
    ]);
  });

  test.each([
    ['SUBSCRIPTION', 'subscription'],
    ['DISPUTE', 'dispute'],
  ] as const)('種類%sを%sにする', (kind, expected) => {
    const [entry] = toPaymentHistoryEntries({
      pages: [historyPage([{ ...PAYMENT, kind }], null, false)],
      pageParams: [null],
    });

    expect(entry?.kind).toBe(expected);
  });

  test.each([
    ['YEAR_TOURNAMENT_ENTRY', 'year_tournament_entry'],
    ['SPONSORSHIP', 'sponsorship'],
    ['ULTRAS', 'ultras'],
    ['PAYMENTS_SMOKE', 'payments_smoke'],
  ] as const)('購入種別%sを%sにする', (purpose, expected) => {
    const [entry] = toPaymentHistoryEntries({
      pages: [historyPage([{ ...PAYMENT, purpose }], null, false)],
      pageParams: [null],
    });

    expect(entry?.purpose).toBe(expected);
  });

  test.each([
    ['FAILED', 'failed'],
    ['DISPUTED', 'disputed'],
    ['DISPUTE_WON', 'dispute_won'],
    ['DISPUTE_LOST', 'dispute_lost'],
  ] as const)('状態%sを%sにする', (status, expected) => {
    const [entry] = toPaymentHistoryEntries({
      pages: [historyPage([{ ...PAYMENT, status }], null, false)],
      pageParams: [null],
    });

    expect(entry?.status).toBe(expected);
  });
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
  test('最初のページは件数だけ、続きのページは件数とカーソルを変数にして実行する', async () => {
    const { sent } = await runThroughApi(
      async (queryClient) => {
        const options = paymentHistoryQueryOptions(VIEWER.id);
        await queryClient.infiniteQuery(options);
        return queryClient.infiniteQuery({ ...options, pages: 2 });
      },
      () => Promise.resolve(graphqlResponse({ data: FIRST_PAGE })),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientPaymentHistoryDocument),
        variables: { first: PAYMENT_HISTORY_PAGE_SIZE },
      },
      {
        documentId: documentIdOf(ClientPaymentHistoryDocument),
        variables: { first: PAYMENT_HISTORY_PAGE_SIZE },
      },
      {
        documentId: documentIdOf(ClientPaymentHistoryDocument),
        variables: { first: PAYMENT_HISTORY_PAGE_SIZE, after: 'cursor-2' },
      },
    ]);
  });
});

describe('loadPaymentHistory', () => {
  test('最初のページを読み、続きは読まない', async () => {
    const { result, sent } = await runThroughApi(
      async (client) => {
        await loadPaymentHistory({
          context: { queryClient: client, viewer: VIEWER },
        });
        return client.getQueryData(
          paymentHistoryQueryOptions(VIEWER.id).queryKey,
        );
      },
      () => Promise.resolve(graphqlResponse({ data: FIRST_PAGE })),
    );

    expect(result).toStrictEqual({ pages: [FIRST_PAGE], pageParams: [null] });
    expect(sent).toHaveLength(1);
  });

  test('取得に失敗しても、一覧の中で再試行できるよう例外にせず失敗をキャッシュに残す', async () => {
    const { result, queryClient } = await runThroughApi(
      (client) =>
        loadPaymentHistory({
          context: { queryClient: client, viewer: VIEWER },
        }).then(() => 'loaded'),
      () => Promise.resolve(new Response('', { status: 503 })),
    );

    expect(result).toBe('loaded');
    expect(
      queryClient.getQueryState(paymentHistoryQueryOptions(VIEWER.id).queryKey)
        ?.status,
    ).toBe('error');
  });
});
