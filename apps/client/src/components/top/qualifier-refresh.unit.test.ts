import { describe, expect, test } from 'bun:test';

import { LIVE_REFRESH_INTERVAL_MS } from '../../../lib/utilities/query/live-refresh.ts';
import type { MatchFragment } from '../../graphql/generated/graphql.ts';
import { FOLLOW_UP_REFETCH_LIMIT } from '../match/follow-up-refetch.ts';
import {
  qualifierBoardOf,
  qualifierMatchOf,
} from './qualifier-board-fixtures.ts';
import {
  canQualifierBoardChange,
  isFollowUpExhausted,
  orderMatchesBy,
  qualifierRefetchIntervalOf,
} from './qualifier-refresh.ts';

const boardWith = (
  phases: readonly MatchFragment['phase'][],
  awaitingKickoff = false,
) =>
  qualifierBoardOf({
    awaitingKickoff,
    matches: phases.map((phase, index) =>
      qualifierMatchOf(index + 1, { phase }),
    ),
  });

describe('qualifierRefetchIntervalOf', () => {
  test.each([
    ['マッチ中の対戦カード', boardWith(['LIVE', 'FINISHED'])],
    ['集計中のマッチ', boardWith(['TALLYING', 'FINISHED'])],
    ['マッチの開始を待つ間', boardWith([], true)],
  ])('自動更新がオンで%sがあれば、定期再取得の間隔を返す', (_label, board) => {
    expect(
      qualifierRefetchIntervalOf({
        board,
        autoRefresh: true,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT * 3,
      }),
    ).toBe(LIVE_REFRESH_INTERVAL_MS);
  });

  test('自動更新がオフなら、マッチ中の対戦カードだけでは止める', () => {
    expect(
      qualifierRefetchIntervalOf({
        board: boardWith(['LIVE']),
        autoRefresh: false,
        updatesSinceBaseline: 0,
      }),
    ).toBe(false);
  });

  test.each([
    ['集計中のマッチ', boardWith(['TALLYING'])],
    ['マッチの開始を待つ間', boardWith(['LIVE'], true)],
  ])(
    '自動更新がオフでも%sがあれば、基準の時点からの更新が上限に達するまで間隔を返し、達したら止める',
    (_label, board) => {
      const intervalAfter = (updatesSinceBaseline: number) =>
        qualifierRefetchIntervalOf({
          board,
          autoRefresh: false,
          updatesSinceBaseline,
        });

      expect(intervalAfter(0)).toBe(LIVE_REFRESH_INTERVAL_MS);
      expect(intervalAfter(FOLLOW_UP_REFETCH_LIMIT - 1)).toBe(
        LIVE_REFRESH_INTERVAL_MS,
      );
      expect(intervalAfter(FOLLOW_UP_REFETCH_LIMIT)).toBe(false);
    },
  );

  test.each([
    ['結果がすべて確定した後', boardWith(['FINISHED', 'FINISHED'])],
    ['マッチの無い日', boardWith([])],
  ])('%sは自動更新がオンでも止める', (_label, board) => {
    expect(
      qualifierRefetchIntervalOf({
        board,
        autoRefresh: true,
        updatesSinceBaseline: 0,
      }),
    ).toBe(false);
  });

  test('取得した値が無ければ止める', () => {
    expect(
      qualifierRefetchIntervalOf({
        board: undefined,
        autoRefresh: true,
        updatesSinceBaseline: 0,
      }),
    ).toBe(false);
  });
});

describe('isFollowUpExhausted', () => {
  test('自動更新がオフで結果の確定かマッチの開始を待ったまま上限に達した時だけ真にする', () => {
    const waiting = boardWith(['TALLYING']);
    const of = (
      board: ReturnType<typeof boardWith>,
      autoRefresh: boolean,
      updatesSinceBaseline: number,
    ) => isFollowUpExhausted({ board, autoRefresh, updatesSinceBaseline });

    expect(of(waiting, false, FOLLOW_UP_REFETCH_LIMIT)).toBe(true);
    expect(of(boardWith([], true), false, FOLLOW_UP_REFETCH_LIMIT)).toBe(true);
    expect(of(waiting, false, FOLLOW_UP_REFETCH_LIMIT - 1)).toBe(false);
    expect(of(waiting, true, FOLLOW_UP_REFETCH_LIMIT * 2)).toBe(false);
    expect(of(boardWith(['FINISHED']), false, FOLLOW_UP_REFETCH_LIMIT)).toBe(
      false,
    );
  });
});

describe('canQualifierBoardChange', () => {
  test('マッチ中の対戦カード・集計中のマッチ・マッチの開始を待つ間のいずれかがある時だけ真にする', () => {
    expect(canQualifierBoardChange(boardWith(['FINISHED', 'LIVE']))).toBe(true);
    expect(canQualifierBoardChange(boardWith(['TALLYING']))).toBe(true);
    expect(canQualifierBoardChange(boardWith([], true))).toBe(true);
    expect(canQualifierBoardChange(boardWith(['FINISHED']))).toBe(false);
    expect(canQualifierBoardChange(undefined)).toBe(false);
  });
});

describe('orderMatchesBy', () => {
  const [first, second, third, fourth] = [1, 2, 3, 4].map((n) =>
    qualifierMatchOf(n),
  ) as [MatchFragment, MatchFragment, MatchFragment, MatchFragment];

  test('最初に表示した順にマッチを並べ、新しい値へ差し替える', () => {
    const updated = { ...second, viewerUpvotedEntryId: 'entry' };
    const order = [first.id, second.id, third.id];

    expect(orderMatchesBy(order, [third, updated, first])).toStrictEqual([
      first,
      updated,
      third,
    ]);
  });

  test('最初の順に無いマッチは取得した順で末尾に加え、無くなったマッチは除く', () => {
    expect(
      orderMatchesBy([first.id, second.id], [fourth, second, third]),
    ).toStrictEqual([second, fourth, third]);
  });
});
