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
  ClientMyYearEntryDocument,
  type ClientMyYearEntryQuery,
  ClientStartYearTournamentCheckoutDocument,
  ClientYearBracketDocument,
  type ClientYearBracketQuery,
  ClientYearTournamentBoardDocument,
  type ClientYearTournamentBoardQuery,
  type MatchByeFragment,
  type MatchFragment,
  type YearBoardRoundFieldsFragment,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';
import {
  myYearEntryQueryOptions,
  startYearTournamentCheckoutMutationOptions,
  yearBracketQueryOptions,
  yearTournamentBoardQueryOptions,
} from './year-tournament.ts';

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

describe('yearTournamentBoardQueryOptions', () => {
  test('閲覧者のUpvoteと制限を含むため、業務日付の変数のキーの後に閲覧者のIDか未ログインの印を加える', () => {
    expect([
      ...yearTournamentBoardQueryOptions(VIEWER, '2027-05-16').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientYearTournamentBoardDocument, {
        date: '2027-05-16',
      }),
      VIEWER.id,
    ]);
    expect([
      ...yearTournamentBoardQueryOptions(null, '2027-05-16').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientYearTournamentBoardDocument, {
        date: '2027-05-16',
      }),
      'guest',
    ]);
  });

  test('業務日付と閲覧者ごとに別のキーにする', () => {
    expect(
      keysAreDistinct([
        yearTournamentBoardQueryOptions(VIEWER, '2027-05-16').queryKey,
        yearTournamentBoardQueryOptions(VIEWER, '2027-05-17').queryKey,
        yearTournamentBoardQueryOptions(OTHER_VIEWER, '2027-05-16').queryKey,
        yearTournamentBoardQueryOptions(null, '2027-05-16').queryKey,
      ]),
    ).toBe(true);
  });

  test('業務日付を変数にして照会を送り、結果を返す', async () => {
    const data: ClientYearTournamentBoardQuery = {
      yearTournamentBoard: {
        date: '2027-05-16',
        serverTime: '2027-05-16T03:00:00.000Z',
        rounds: [],
      },
    };

    const { result, sent } = await runThroughApi(
      (queryClient) =>
        queryClient.query(
          yearTournamentBoardQueryOptions(VIEWER, '2027-05-16'),
        ),
      data,
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientYearTournamentBoardDocument),
        variables: { date: '2027-05-16' },
      },
    ]);
    expect(result).toStrictEqual(data);
  });
});

describe('yearBracketQueryOptions', () => {
  test('非公開のプロダクトが投稿者本人にだけ見えるため、年の変数のキーの後に閲覧者のIDか未ログインの印を加える', () => {
    expect([...yearBracketQueryOptions(VIEWER, '2027').queryKey]).toStrictEqual(
      [
        ...graphqlQueryKey(ClientYearBracketDocument, { year: '2027' }),
        VIEWER.id,
      ],
    );
    expect([...yearBracketQueryOptions(null, '2027').queryKey]).toStrictEqual([
      ...graphqlQueryKey(ClientYearBracketDocument, { year: '2027' }),
      'guest',
    ]);
  });

  test('年と閲覧者ごとに別のキーにする', () => {
    expect(
      keysAreDistinct([
        yearBracketQueryOptions(VIEWER, '2027').queryKey,
        yearBracketQueryOptions(VIEWER, '2028').queryKey,
        yearBracketQueryOptions(OTHER_VIEWER, '2027').queryKey,
        yearBracketQueryOptions(null, '2027').queryKey,
      ]),
    ).toBe(true);
  });

  test('年を変数にして照会を送り、未決定の年のnullもそのまま返す', async () => {
    const data: ClientYearBracketQuery = { yearBracket: null };

    const { result, sent } = await runThroughApi(
      (queryClient) => queryClient.query(yearBracketQueryOptions(null, '2027')),
      data,
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientYearBracketDocument),
        variables: { year: '2027' },
      },
    ]);
    expect(result).toStrictEqual(data);
  });
});

describe('myYearEntryQueryOptions', () => {
  test('投稿者本人の枠のため、プロダクトのハンドルの変数のキーの後に閲覧者のIDを加える', () => {
    expect([
      ...myYearEntryQueryOptions(VIEWER, 'pitch-notes').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientMyYearEntryDocument, {
        productHandle: 'pitch-notes',
      }),
      VIEWER.id,
    ]);
    expect(
      keysAreDistinct([
        myYearEntryQueryOptions(VIEWER, 'pitch-notes').queryKey,
        myYearEntryQueryOptions(VIEWER, 'goal-board').queryKey,
        myYearEntryQueryOptions(OTHER_VIEWER, 'pitch-notes').queryKey,
      ]),
    ).toBe(true);
  });

  test('プロダクトのハンドルを変数にして照会を送り、結果を返す', async () => {
    const data: ClientMyYearEntryQuery = {
      myYearEntry: {
        launchId: LAUNCH_ID,
        year: 2027,
        yearLabel: '2027年',
        weekLabel: '2026年第47週(11/16〜11/22)',
        finalDate: '2027-05-30',
        status: 'AWAITING_PAYMENT',
        closeReason: null,
        exempt: false,
        refundable: false,
        acceptUntil: '2026-11-23T14:00:00.000Z',
        deadlineAt: '2026-11-23T14:35:00.000Z',
        drawAt: '2026-11-23T14:45:00.000Z',
        fee: { amount: 1000, currency: 'USD' },
        serverTime: '2026-11-22T15:00:00.000Z',
        progress: null,
        bracketPath: null,
      },
    };

    const { result, sent } = await runThroughApi(
      (queryClient) =>
        queryClient.query(myYearEntryQueryOptions(VIEWER, 'pitch-notes')),
      data,
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientMyYearEntryDocument),
        variables: { productHandle: 'pitch-notes' },
      },
    ]);
    expect(result).toStrictEqual(data);
  });
});

describe('startYearTournamentCheckoutMutationOptions', () => {
  test('変更のキーは操作の識別子だけにする', () => {
    expect(
      startYearTournamentCheckoutMutationOptions().mutationKey,
    ).toStrictEqual([documentIdOf(ClientStartYearTournamentCheckoutDocument)]);
  });

  test('ローンチのIDを変数にして決済の開始を送り、購入のIDを返す', async () => {
    const data = { startYearTournamentCheckout: { purchaseId: PURCHASE_ID } };
    const { result, sent } = await runThroughApi(
      (queryClient) =>
        new MutationObserver(
          queryClient,
          startYearTournamentCheckoutMutationOptions(),
        ).mutate({ variables: { launchId: LAUNCH_ID } }),
      data,
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(ClientStartYearTournamentCheckoutDocument),
        variables: { launchId: LAUNCH_ID },
      },
    ]);
    expect(result).toStrictEqual(data);
  });
});

// APIサーバーの深さの上限のため照会はフラグメントを展開せずに項目を直接書くので、照会の結果の型がフラグメントの型と一致することを型で確かめる
describe('照会の結果とフラグメントの型', () => {
  test('トップページの区画の行は、YearBoardRoundFieldsのフラグメントの型と一致する', () => {
    expectTypeOf<
      ClientYearTournamentBoardQuery['yearTournamentBoard']['rounds'][number]
    >().toEqualTypeOf<YearBoardRoundFieldsFragment>();
  });

  test('区画の行の対戦カードと不戦勝は、MatchCard・ByeListが受けるフラグメントの型と一致する', () => {
    expectTypeOf<
      YearBoardRoundFieldsFragment['matches'][number]
    >().toEqualTypeOf<MatchFragment>();
    expectTypeOf<
      YearBoardRoundFieldsFragment['byes'][number]
    >().toEqualTypeOf<MatchByeFragment>();
  });

  test('ブラケットのラウンドと受賞したプロダクトは、共用の2つのフラグメントの型と一致する', () => {
    type YearBracket = NonNullable<ClientYearBracketQuery['yearBracket']>;

    expectTypeOf<
      YearBracket['rounds'][number]
    >().toEqualTypeOf<BracketRoundFieldsFragment>();
    expectTypeOf<
      YearBracket['champion']
    >().toEqualTypeOf<BracketMatchProductFieldsFragment | null>();
  });
});
