import { describe, expect, test } from 'bun:test';

import { LIVE_REFRESH_INTERVAL_MS } from '../../../lib/utilities/query/live-refresh.ts';
import { bracketProductOf } from '../bracket/bracket-fixtures.ts';
import {
  AWARDED_WEEK_BRACKET,
  FINISHED_ROUNDS,
  weekBracketOf,
} from './week-bracket-fixtures.ts';
import {
  bracketViewPropsOf,
  isWeekBracketLive,
  weekBracketRefetchIntervalOf,
} from './week-bracket-model.ts';

describe('bracketViewPropsOf', () => {
  test('ラウンドと受賞したプロダクトをそのまま渡し、受賞で終えた週は受賞かつ終了にする', () => {
    expect(bracketViewPropsOf(AWARDED_WEEK_BRACKET)).toStrictEqual({
      rounds: FINISHED_ROUNDS,
      champion: bracketProductOf(1),
      awarded: true,
      finished: true,
    });
  });

  test('受賞なしで終えた週は、受賞でない終了にする', () => {
    const view = bracketViewPropsOf(
      weekBracketOf({ tournament: { status: 'FINISHED', awarded: false } }),
    );

    expect(view.awarded).toBe(false);
    expect(view.finished).toBe(true);
  });

  test('終了の前(受賞の有無がnull)は、受賞でも終了でもないものとする', () => {
    const view = bracketViewPropsOf(weekBracketOf());

    expect(view.awarded).toBe(false);
    expect(view.finished).toBe(false);
    expect(view.champion).toBeNull();
  });

  test('表示できないプロダクトが受賞した週は、受賞したプロダクトをnullのまま受賞にする', () => {
    const view = bracketViewPropsOf(
      weekBracketOf({
        tournament: { status: 'FINISHED', awarded: true },
        champion: null,
      }),
    );

    expect(view.awarded).toBe(true);
    expect(view.champion).toBeNull();
  });
});

describe('isWeekBracketLive', () => {
  test.each(['IN_PROGRESS', 'DRAWING'] as const)(
    '終了していない週(%s)は開催中とする',
    (status) => {
      expect(
        isWeekBracketLive({
          weekBracket: weekBracketOf({ tournament: { status } }),
        }),
      ).toBe(true);
    },
  );

  test('終了した週・見つからない週・取得の前は開催中としない', () => {
    expect(isWeekBracketLive({ weekBracket: AWARDED_WEEK_BRACKET })).toBe(
      false,
    );
    expect(isWeekBracketLive({ weekBracket: null })).toBe(false);
    expect(isWeekBracketLive(undefined)).toBe(false);
  });
});

describe('weekBracketRefetchIntervalOf', () => {
  const live = { state: { data: { weekBracket: weekBracketOf() } } };
  const finished = { state: { data: { weekBracket: AWARDED_WEEK_BRACKET } } };

  test('開催中で自動更新がオンなら定期再取得の間隔を返す', () => {
    expect(weekBracketRefetchIntervalOf(live, true)).toBe(
      LIVE_REFRESH_INTERVAL_MS,
    );
  });

  test('自動更新がオフ、または終了した週なら止める', () => {
    expect(weekBracketRefetchIntervalOf(live, false)).toBe(false);
    expect(weekBracketRefetchIntervalOf(finished, true)).toBe(false);
  });
});
