import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import {
  graphqlResponse,
  htmlResponse,
  recordingApi,
  renderContextOf,
  runInStartRequest,
} from '../../lib/test/start-request-fixtures.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientUltrasOfferDocument,
  type ClientUltrasOfferQuery,
  ClientViewerUltrasDocument,
  type ClientViewerUltrasQuery,
} from './generated/graphql.ts';
import {
  loadPlanPage,
  toUltrasPlanStatus,
  ultrasOfferQueryOptions,
  viewerUltrasQueryOptions,
} from './ultras.ts';
import type { ClientViewer } from './viewer.ts';

const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

describe('ultrasOfferQueryOptions', () => {
  test('操作の識別子と空の変数だけのキーを持ち、閲覧者によらず1つの取得にまとめる', () => {
    expect([...ultrasOfferQueryOptions().queryKey]).toStrictEqual([
      documentIdOf(ClientUltrasOfferDocument),
      {},
    ]);
  });
});

describe('viewerUltrasQueryOptions', () => {
  test('操作の識別子と空の変数で始まり、閲覧者ごとと未ログインで別のキーにする', () => {
    const own = viewerUltrasQueryOptions(VIEWER).queryKey;
    const other = viewerUltrasQueryOptions({
      ...VIEWER,
      id: '01JC0VIEWER0000000000000001',
    }).queryKey;
    const guest = viewerUltrasQueryOptions(null).queryKey;

    expect(own.slice(0, 2)).toStrictEqual([
      documentIdOf(ClientViewerUltrasDocument),
      {},
    ]);
    expect(
      new Set([own, other, guest].map((key) => JSON.stringify(key))).size,
    ).toBe(3);
  });

  test('同じ閲覧者は、停止の状態が変わっても同じキーにする', () => {
    expect(viewerUltrasQueryOptions(VIEWER).queryKey).toStrictEqual(
      viewerUltrasQueryOptions({ ...VIEWER, status: 'SUSPENDED' }).queryKey,
    );
  });
});

describe('toUltrasPlanStatus', () => {
  test.each([
    ['ACTIVE', 'active'],
    ['PAST_DUE', 'past_due'],
    ['CANCELED', 'canceled'],
    ['ENDED', 'ended'],
  ] as const)(
    'GraphQLの加入状態%sを共用部品の加入状態%sに写す',
    (graphqlStatus, status) => {
      expect(toUltrasPlanStatus(graphqlStatus)).toBe(status);
    },
  );
});

const OFFER: ClientUltrasOfferQuery = {
  ultrasOffer: {
    price: { amount: 999, currency: 'usd' },
    priceStale: false,
    promotionEnabled: true,
  },
};

const ULTRAS: ClientViewerUltrasQuery = {
  viewerUltras: { entitled: false, canOpenPortal: false, plan: null },
};

// 外部へ通信しないよう、描画の文脈のAPIを偽物にしてサーバーの分岐で取得し、APIへ送った識別子を読み取る
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
  const sent = await Promise.all(
    api.requests.map(
      (request) => request.json() as Promise<{ documentId: string }>,
    ),
  );
  return { result, sent, queryClient };
};

const respondByDocument = async (request: Request): Promise<Response> => {
  const { documentId } = (await request.clone().json()) as {
    documentId: string;
  };
  return graphqlResponse({
    data:
      documentId === documentIdOf(ClientUltrasOfferDocument) ? OFFER : ULTRAS,
  });
};

describe('loadPlanPage', () => {
  test('価格と閲覧者の加入状態の2つを同時に取得し、キャッシュに入れる', async () => {
    const { sent, queryClient } = await runThroughApi(
      (client) =>
        loadPlanPage({ context: { queryClient: client, viewer: VIEWER } }),
      respondByDocument,
    );

    expect(sent.map(({ documentId }) => documentId).toSorted()).toStrictEqual(
      [
        documentIdOf(ClientUltrasOfferDocument),
        documentIdOf(ClientViewerUltrasDocument),
      ].toSorted(),
    );
    expect(
      queryClient.getQueryData(ultrasOfferQueryOptions().queryKey),
    ).toStrictEqual(OFFER);
    expect(
      queryClient.getQueryData(viewerUltrasQueryOptions(VIEWER).queryKey),
    ).toStrictEqual(ULTRAS);
  });

  test('取得に失敗しても、ページの中で再試行できるよう例外にせず失敗をキャッシュに残す', async () => {
    const { result, queryClient } = await runThroughApi(
      (client) =>
        loadPlanPage({
          context: { queryClient: client, viewer: VIEWER },
        }).then(() => 'loaded'),
      () => Promise.resolve(new Response('', { status: 503 })),
    );

    expect(result).toBe('loaded');
    expect(
      queryClient.getQueryState(ultrasOfferQueryOptions().queryKey)?.status,
    ).toBe('error');
    expect(
      queryClient.getQueryState(viewerUltrasQueryOptions(VIEWER).queryKey)
        ?.status,
    ).toBe('error');
  });
});
