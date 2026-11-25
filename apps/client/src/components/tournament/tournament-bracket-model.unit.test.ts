import { describe, expect, test } from 'bun:test';

import { LIVE_REFRESH_INTERVAL_MS } from '../../../lib/utilities/query/live-refresh.ts';
import { bracketProductOf } from '../bracket/bracket-fixtures.ts';
import {
  AWARDED_TOURNAMENT_BRACKET,
  FINISHED_BRACKET_ROUNDS,
  tournamentBracketOf,
} from './tournament-bracket-fixtures.ts';
import {
  bracketViewPropsOf,
  isTournamentBracketLive,
  tournamentBracketRefetchIntervalOf,
} from './tournament-bracket-model.ts';

describe('bracketViewPropsOf', () => {
  test('ラウンドと受賞したプロダクトをそのまま渡し、受賞で終えたトーナメントは受賞かつ終了にする', () => {
    expect(bracketViewPropsOf(AWARDED_TOURNAMENT_BRACKET)).toStrictEqual({
      rounds: FINISHED_BRACKET_ROUNDS,
      champion: bracketProductOf(1),
      awarded: true,
      finished: true,
    });
  });

  test('受賞なしで終えたトーナメントは、受賞でない終了にする', () => {
    const view = bracketViewPropsOf(
      tournamentBracketOf({
        tournament: { status: 'FINISHED', awarded: false },
      }),
    );

    expect(view.awarded).toBe(false);
    expect(view.finished).toBe(true);
  });

  test('終了の前(受賞の有無がnull)は、受賞でも終了でもないものとする', () => {
    const view = bracketViewPropsOf(tournamentBracketOf());

    expect(view.awarded).toBe(false);
    expect(view.finished).toBe(false);
    expect(view.champion).toBeNull();
  });

  test('表示できないプロダクトが受賞したトーナメントは、受賞したプロダクトをnullのまま受賞にする', () => {
    const view = bracketViewPropsOf(
      tournamentBracketOf({
        tournament: { status: 'FINISHED', awarded: true },
        champion: null,
      }),
    );

    expect(view.awarded).toBe(true);
    expect(view.champion).toBeNull();
  });
});

describe('isTournamentBracketLive', () => {
  test.each(['IN_PROGRESS', 'DRAWING'])(
    '終了していないトーナメント(%s)は開催中とする',
    (status) => {
      expect(
        isTournamentBracketLive(
          tournamentBracketOf({ tournament: { status } }),
        ),
      ).toBe(true);
    },
  );

  test('終了したトーナメント・見つからないトーナメント・取得の前は開催中としない', () => {
    expect(isTournamentBracketLive(AWARDED_TOURNAMENT_BRACKET)).toBe(false);
    expect(isTournamentBracketLive(null)).toBe(false);
    expect(isTournamentBracketLive(undefined)).toBe(false);
  });
});

describe('tournamentBracketRefetchIntervalOf', () => {
  test('開催中で自動更新がオンなら定期再取得の間隔を返す', () => {
    expect(
      tournamentBracketRefetchIntervalOf(tournamentBracketOf(), true),
    ).toBe(LIVE_REFRESH_INTERVAL_MS);
  });

  test('自動更新がオフ、または終了したトーナメントなら止める', () => {
    expect(
      tournamentBracketRefetchIntervalOf(tournamentBracketOf(), false),
    ).toBe(false);
    expect(
      tournamentBracketRefetchIntervalOf(AWARDED_TOURNAMENT_BRACKET, true),
    ).toBe(false);
  });

  test('取得の前・見つからないトーナメントは止める', () => {
    expect(tournamentBracketRefetchIntervalOf(undefined, true)).toBe(false);
    expect(tournamentBracketRefetchIntervalOf(null, true)).toBe(false);
  });
});
