import { describe, expect, expectTypeOf, test } from 'bun:test';
import { MutationObserver, QueryClient } from '@tanstack/react-query';

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
  type BracketMatchProductFieldsFragment,
  type BracketRoundFieldsFragment,
  ClientMyWeekEntryDocument,
  ClientProductTrophiesDocument,
  ClientStartWeekTournamentCheckoutDocument,
  ClientWeekBracketDocument,
  type ClientWeekBracketQuery,
  ClientWeekTournamentBoardDocument,
  type ClientWeekTournamentBoardQuery,
  type MatchByeFragment,
  type MatchFragment,
  type WeekBoardRoundFieldsFragment,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';
import {
  myWeekEntryQueryOptions,
  productTrophiesQueryOptions,
  startWeekTournamentCheckoutMutationOptions,
  weekBracketQueryOptions,
  weekTournamentBoardQueryOptions,
} from './week-tournament.ts';

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
};

const LAUNCH_ID = '01JD0LAVNCH0000000000000000';

const PURCHASE_ID = '01JD0PVRCHASE00000000000000';

interface SentRequest {
  readonly documentId: string;
  readonly variables: unknown;
}

// 外部へ通信しないよう、描画の文脈のAPIを偽物にしてサーバーの分岐で実行し、APIへ送った識別子と変数を読み取る
const runThroughApi = async (
  run: (queryClient: QueryClient) => Promise<unknown>,
  data: unknown,
) => {
  const api = recordingApi(() => Promise.resolve(graphqlResponse({ data })));
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
    api.requests.map((request) => request.json() as Promise<SentRequest>),
  );
  return { result, sent };
};

const keysAreDistinct = (keys: readonly (readonly unknown[])[]): boolean =>
  new Set(keys.map((key) => JSON.stringify(key))).size === keys.length;

describe('weekTournamentBoardQueryOptions', () => {
  test('閲覧者のUpvoteと制限を含むため、業務日付の変数のキーの後に閲覧者のIDか未ログインの印を加える', () => {
    expect([
      ...weekTournamentBoardQueryOptions(VIEWER, '2026-11-24').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientWeekTournamentBoardDocument, {
        date: '2026-11-24',
      }),
      VIEWER.id,
    ]);
    expect([
      ...weekTournamentBoardQueryOptions(null, '2026-11-24').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientWeekTournamentBoardDocument, {
        date: '2026-11-24',
      }),
      'guest',
    ]);
  });

  test('業務日付と閲覧者ごとに別のキーにする', () => {
    expect(
      keysAreDistinct([
        weekTournamentBoardQueryOptions(VIEWER, '2026-11-24').queryKey,
        weekTournamentBoardQueryOptions(VIEWER, '2026-11-25').queryKey,
        weekTournamentBoardQueryOptions(OTHER_VIEWER, '2026-11-24').queryKey,
        weekTournamentBoardQueryOptions(null, '2026-11-24').queryKey,
      ]),
    ).toBe(true);
  });

  test('業務日付を変数にして照会を送り、結果を返す', async () => {
    const data: ClientWeekTournamentBoardQuery = {
      weekTournamentBoard: {
        date: '2026-11-24',
        serverTime: '2026-11-24T03:00:00.000Z',
        rounds: [],
      },
    };

    const { result, sent } = await runThroughApi(
      (queryClient) =>
        queryClient.query(
          weekTournamentBoardQueryOptions(VIEWER, '2026-11-24'),
        ),
      data,
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientWeekTournamentBoardDocument),
        variables: { date: '2026-11-24' },
      },
    ]);
    expect(result).toStrictEqual(data);
  });
});

describe('weekBracketQueryOptions', () => {
  test('非公開のプロダクトが投稿者本人にだけ見えるため、ISO週の変数のキーの後に閲覧者のIDか未ログインの印を加える', () => {
    expect([
      ...weekBracketQueryOptions(VIEWER, '2026-W48').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientWeekBracketDocument, { week: '2026-W48' }),
      VIEWER.id,
    ]);
    expect([
      ...weekBracketQueryOptions(null, '2026-W48').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientWeekBracketDocument, { week: '2026-W48' }),
      'guest',
    ]);
  });

  test('ISO週と閲覧者ごとに別のキーにする', () => {
    expect(
      keysAreDistinct([
        weekBracketQueryOptions(VIEWER, '2026-W48').queryKey,
        weekBracketQueryOptions(VIEWER, '2026-W49').queryKey,
        weekBracketQueryOptions(OTHER_VIEWER, '2026-W48').queryKey,
        weekBracketQueryOptions(null, '2026-W48').queryKey,
      ]),
    ).toBe(true);
  });

  test('ISO週を変数にして照会を送り、未決定の週のnullもそのまま返す', async () => {
    const data: ClientWeekBracketQuery = { weekBracket: null };

    const { result, sent } = await runThroughApi(
      (queryClient) =>
        queryClient.query(weekBracketQueryOptions(null, '2026-W48')),
      data,
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientWeekBracketDocument),
        variables: { week: '2026-W48' },
      },
    ]);
    expect(result).toStrictEqual(data);
  });
});

describe('myWeekEntryQueryOptions', () => {
  test('投稿者本人の枠のため、プロダクトのハンドルの変数のキーの後に閲覧者のIDを加える', () => {
    expect([
      ...myWeekEntryQueryOptions(VIEWER, 'pitch-notes').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientMyWeekEntryDocument, {
        productHandle: 'pitch-notes',
      }),
      VIEWER.id,
    ]);
    expect(
      keysAreDistinct([
        myWeekEntryQueryOptions(VIEWER, 'pitch-notes').queryKey,
        myWeekEntryQueryOptions(VIEWER, 'goal-board').queryKey,
        myWeekEntryQueryOptions(OTHER_VIEWER, 'pitch-notes').queryKey,
      ]),
    ).toBe(true);
  });

  test('プロダクトのハンドルを変数にして照会を送る', async () => {
    const { sent } = await runThroughApi(
      (queryClient) =>
        queryClient.query(myWeekEntryQueryOptions(VIEWER, 'pitch-notes')),
      { myWeekEntry: null },
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientMyWeekEntryDocument),
        variables: { productHandle: 'pitch-notes' },
      },
    ]);
  });
});

describe('productTrophiesQueryOptions', () => {
  test('非公開のプロダクトが投稿者本人にだけ見えるため、プロダクトのハンドルの変数のキーの後に閲覧者のIDか未ログインの印を加える', () => {
    expect([
      ...productTrophiesQueryOptions(VIEWER, 'pitch-notes').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientProductTrophiesDocument, {
        productHandle: 'pitch-notes',
      }),
      VIEWER.id,
    ]);
    expect([
      ...productTrophiesQueryOptions(null, 'pitch-notes').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientProductTrophiesDocument, {
        productHandle: 'pitch-notes',
      }),
      'guest',
    ]);
  });

  test('プロダクトのハンドルを変数にして照会を送る', async () => {
    const { sent } = await runThroughApi(
      (queryClient) =>
        queryClient.query(productTrophiesQueryOptions(null, 'pitch-notes')),
      { productTrophies: [] },
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientProductTrophiesDocument),
        variables: { productHandle: 'pitch-notes' },
      },
    ]);
  });
});

describe('startWeekTournamentCheckoutMutationOptions', () => {
  test('変更のキーは操作の識別子だけにする', () => {
    expect(
      startWeekTournamentCheckoutMutationOptions().mutationKey,
    ).toStrictEqual([documentIdOf(ClientStartWeekTournamentCheckoutDocument)]);
  });

  test('ローンチのIDを変数にして決済の開始を送り、購入のIDを返す', async () => {
    const data = { startWeekTournamentCheckout: { purchaseId: PURCHASE_ID } };
    const { result, sent } = await runThroughApi(
      (queryClient) =>
        new MutationObserver(
          queryClient,
          startWeekTournamentCheckoutMutationOptions(),
        ).mutate({ variables: { launchId: LAUNCH_ID } }),
      data,
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientStartWeekTournamentCheckoutDocument),
        variables: { launchId: LAUNCH_ID },
      },
    ]);
    expect(result).toStrictEqual(data);
  });
});

// APIサーバーの深さの上限のため照会はフラグメントを展開せずに項目を直接書くので、照会の結果の型がフラグメントの型と一致することを型で確かめる
describe('照会の結果とフラグメントの型', () => {
  test('トップページの区画の行は、WeekBoardRoundFieldsのフラグメントの型と一致する', () => {
    expectTypeOf<
      ClientWeekTournamentBoardQuery['weekTournamentBoard']['rounds'][number]
    >().toEqualTypeOf<WeekBoardRoundFieldsFragment>();
  });

  test('区画の行の対戦カードと不戦勝は、MatchCard・ByeListが受けるフラグメントの型と一致する', () => {
    expectTypeOf<
      WeekBoardRoundFieldsFragment['matches'][number]
    >().toEqualTypeOf<MatchFragment>();
    expectTypeOf<
      WeekBoardRoundFieldsFragment['byes'][number]
    >().toEqualTypeOf<MatchByeFragment>();
  });

  test('ブラケットのラウンドと優勝したプロダクトは、共用の2つのフラグメントの型と一致する', () => {
    type WeekBracket = NonNullable<ClientWeekBracketQuery['weekBracket']>;

    expectTypeOf<
      WeekBracket['rounds'][number]
    >().toEqualTypeOf<BracketRoundFieldsFragment>();
    expectTypeOf<
      WeekBracket['champion']
    >().toEqualTypeOf<BracketMatchProductFieldsFragment | null>();
    expectTypeOf<
      BracketRoundFieldsFragment['nodes'][number]['slots'][number]['product']
    >().toEqualTypeOf<BracketMatchProductFieldsFragment | null>();
  });
});
