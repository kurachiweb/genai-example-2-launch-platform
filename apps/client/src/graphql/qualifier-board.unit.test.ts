import { describe, expect, mock, test } from 'bun:test';
import type { QueryClient } from '@tanstack/react-query';

import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  qualifierBoardOf,
  qualifierMatchOf,
} from '../components/top/qualifier-board-fixtures.ts';
import {
  ClientQualifierBoardDocument,
  type ClientQualifierBoardQuery,
} from './generated/graphql.ts';
import {
  loadQualifierBoard,
  QUALIFIER_BOARD_QUERY_PREFIX,
  qualifierBoardQueryOptions,
  toTopPageView,
  withUpdatedMatch,
} from './qualifier-board.ts';
import type { ClientViewer } from './viewer.ts';

const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

const dataOf = (board = qualifierBoardOf()): ClientQualifierBoardQuery => ({
  qualifierBoard: board,
});

describe('qualifierBoardQueryOptions', () => {
  test('閲覧者ごとの項目を含むため、共通の取得の補助のキーの後に閲覧者のIDか未ログインの印を加え、キーの先頭は無効化の接頭辞と同じにする', () => {
    const signedIn = qualifierBoardQueryOptions(VIEWER).queryKey;
    const guest = qualifierBoardQueryOptions(null).queryKey;

    expect([...signedIn]).toStrictEqual([
      ...graphqlQueryKey(ClientQualifierBoardDocument, {}),
      VIEWER.id,
    ]);
    expect([...guest]).toStrictEqual([
      ...graphqlQueryKey(ClientQualifierBoardDocument, {}),
      'guest',
    ]);
    expect(signedIn[0]).toBe(QUALIFIER_BOARD_QUERY_PREFIX[0]);
  });
});

describe('loadQualifierBoard', () => {
  test('キャッシュに値があっても取得し直すよう、鮮度0で同じ取得を待つ', async () => {
    const query = mock(() => Promise.resolve(dataOf()));
    const queryClient = { query } as unknown as QueryClient;

    await loadQualifierBoard({ context: { queryClient, viewer: VIEWER } });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: qualifierBoardQueryOptions(VIEWER).queryKey,
        staleTime: 0,
      }),
    );
  });

  test('取得の失敗はエラーの画面にするため、そのまま投げる', async () => {
    const error = new GraphQLClientError({
      code: 'internal_error',
      message: 'サーバーでエラーが発生しました。',
      status: 500,
    });
    const queryClient = {
      query: () => Promise.reject(error),
    } as unknown as QueryClient;

    const thrown = await loadQualifierBoard({
      context: { queryClient, viewer: null },
    }).then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(thrown).toBe(error);
  });
});

describe('toTopPageView', () => {
  test('区画の文脈に渡す日付・時間帯・サーバーの時刻と、予選の対戦カードの有無と、境界の取り直しの時刻(終了と翌日の開始)を取り出す', () => {
    const board = qualifierBoardOf({ phase: 'RESULT' });

    expect(toTopPageView(dataOf(board))).toStrictEqual({
      board: {
        date: board.date,
        phase: 'RESULT',
        serverTime: board.serverTime,
      },
      hasQualifierMatches: true,
      boundaries: [board.fullTimeAt, board.nextKickoffAt],
    });
    expect(
      toTopPageView(dataOf(qualifierBoardOf({ matches: [] })))
        .hasQualifierMatches,
    ).toBe(false);
  });
});

describe('withUpdatedMatch', () => {
  test('同じIDのマッチだけを並び順を保って差し替え、他の項目は変えない', () => {
    const data = dataOf(
      qualifierBoardOf({
        matches: [1, 2, 3].map((n) => qualifierMatchOf(n)),
      }),
    );
    const updated = qualifierMatchOf(2, {
      viewerUpvotedEntryId: 'entry',
    });

    const next = withUpdatedMatch(data, updated);

    expect(next.qualifierBoard.matches).toStrictEqual([
      qualifierMatchOf(1),
      updated,
      qualifierMatchOf(3),
    ]);
    expect(next.qualifierBoard.byes).toBe(data.qualifierBoard.byes);
    expect(data.qualifierBoard.matches[1]).toStrictEqual(qualifierMatchOf(2));
  });

  test('一覧に無いマッチと、取得の結果が無いキャッシュは変えない', () => {
    const data = dataOf();

    expect(withUpdatedMatch(data, qualifierMatchOf(99))).toBe(data);
    expect(withUpdatedMatch(undefined, qualifierMatchOf(1))).toBeUndefined();
  });
});
