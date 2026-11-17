import { describe, expect, test } from 'bun:test';

import { LIVE_REFRESH_INTERVAL_MS } from '../../../lib/utilities/query/live-refresh.ts';
import type { MatchFragment } from '../../graphql/generated/graphql.ts';
import { entryOf } from '../match/match-fixtures.ts';
import { FOLLOW_UP_REFETCH_LIMIT } from '../match/follow-up-refetch.ts';
import {
  weekBoardOf,
  weekBoardRoundOf,
  weekByeOf,
  weekFinalRoundOf,
  weekMatchOf,
} from './week-board-fixtures.ts';
import { splitBoardRound } from './week-board-model.ts';
import {
  canWeekFinalChange,
  isWeekFinalAwaitingChange,
  isWeekFinalFollowUpExhausted,
  weekFinalOutcomeOf,
  weekFinalRefetchIntervalOf,
  weekFinalRoundsOf,
} from './week-final-model.ts';

const finalMatchOf = (overrides: Partial<MatchFragment> = {}): MatchFragment =>
  weekMatchOf(21, { round: 8, stage: 'FINAL', ...overrides });

const finalBoardWith = (phase: MatchFragment['phase']) =>
  weekBoardOf({
    rounds: [weekFinalRoundOf({ matches: [finalMatchOf({ phase })] })],
  });

const decided = (
  decision: MatchFragment['decision'],
  results: readonly [
    MatchFragment['entries'][number]['result'],
    MatchFragment['entries'][number]['result'],
  ],
): MatchFragment => {
  const match = finalMatchOf({ phase: 'FINISHED', decision });
  const [left, right] = match.entries;
  return {
    ...match,
    entries: [
      entryOf('left', { ...left, result: results[0] }),
      entryOf('right', { ...right, result: results[1] }),
    ],
  };
};

describe('weekFinalRoundsOf', () => {
  test('決勝の行だけを、対戦カードか不戦勝を持つものに限ってサーバーの順のまま並べる', () => {
    const first = weekFinalRoundOf();
    const forfeited = weekFinalRoundOf({
      tournament: { ...weekFinalRoundOf().tournament, week: '2026-W44' },
      matches: [],
      byes: [],
    });
    const byeOnly = weekFinalRoundOf({
      tournament: { ...weekFinalRoundOf().tournament, week: '2026-W43' },
      matches: [],
      byes: [weekByeOf(1, { round: 8 })],
    });

    const rows = weekFinalRoundsOf([
      weekBoardRoundOf(),
      first,
      forfeited,
      byeOnly,
    ]);

    expect(rows.map(({ round }) => round.tournament.week)).toStrictEqual([
      '2026-W45',
      '2026-W43',
    ]);
    expect(rows[0]).toStrictEqual({ round: first, ...splitBoardRound(first) });
  });

  test('その日に決勝が無ければ空にする', () => {
    expect(weekFinalRoundsOf([weekBoardRoundOf()])).toStrictEqual([]);
    expect(weekFinalRoundsOf([])).toStrictEqual([]);
  });
});

describe('weekFinalOutcomeOf', () => {
  test('確定の前の決勝は結果を持たない', () => {
    for (const phase of ['SCHEDULED', 'LIVE', 'TALLYING'] as const) {
      expect(
        weekFinalOutcomeOf(
          splitBoardRound(
            weekFinalRoundOf({ matches: [finalMatchOf({ phase })] }),
          ),
        ),
      ).toBeNull();
    }
  });

  test('確定した決勝は勝った側のプロダクトの受賞にし、表示できない側は「非公開のプロダクト」とする', () => {
    expect(
      weekFinalOutcomeOf(
        splitBoardRound(
          weekFinalRoundOf({ matches: [decided('VOTES', ['LOST', 'WON'])] }),
        ),
      ),
    ).toStrictEqual({ kind: 'awarded', productName: 'Week Right 21' });

    const hidden = decided('LAST_UPVOTE', ['WON', 'LOST']);
    const [left, right] = hidden.entries;
    expect(
      weekFinalOutcomeOf(
        splitBoardRound(
          weekFinalRoundOf({
            matches: [
              {
                ...hidden,
                entries: [
                  entryOf('left', { ...left, product: null }),
                  right ?? entryOf('right'),
                ],
              },
            ],
          }),
        ),
      ),
    ).toStrictEqual({ kind: 'awarded', productName: '非公開のプロダクト' });
  });

  test('0対0で両者敗北した決勝は受賞なしにする', () => {
    expect(
      weekFinalOutcomeOf(
        splitBoardRound(
          weekFinalRoundOf({
            matches: [decided('NO_VOTES', ['LOST', 'LOST'])],
          }),
        ),
      ),
    ).toStrictEqual({ kind: 'no-award' });
  });

  test('不戦勝と早期勝利の決勝は、その側のプロダクトの受賞にする', () => {
    expect(
      weekFinalOutcomeOf(
        splitBoardRound(
          weekFinalRoundOf({
            matches: [],
            byes: [weekByeOf(1, { round: 8, endedEarly: true })],
          }),
        ),
      ),
    ).toStrictEqual({ kind: 'awarded', productName: 'Week Bye 1' });
  });
});

describe('決勝の区画の定期の取り直し', () => {
  test('決勝の対戦カードが確定の前の間だけ、変わり得ると判定する', () => {
    expect(canWeekFinalChange(finalBoardWith('LIVE'))).toBe(true);
    expect(canWeekFinalChange(finalBoardWith('TALLYING'))).toBe(true);
    expect(canWeekFinalChange(finalBoardWith('SCHEDULED'))).toBe(true);
    expect(canWeekFinalChange(finalBoardWith('FINISHED'))).toBe(false);
    expect(canWeekFinalChange(weekBoardOf())).toBe(false);
    expect(canWeekFinalChange(undefined)).toBe(false);
  });

  test('決勝の対戦カードが集計中か開始の前なら、結果か開始を待っていると判定する', () => {
    expect(isWeekFinalAwaitingChange(finalBoardWith('TALLYING'))).toBe(true);
    expect(isWeekFinalAwaitingChange(finalBoardWith('SCHEDULED'))).toBe(true);
    expect(isWeekFinalAwaitingChange(finalBoardWith('LIVE'))).toBe(false);
    expect(
      isWeekFinalAwaitingChange(
        weekBoardOf({
          rounds: [
            weekBoardRoundOf({
              matches: [weekMatchOf(1, { phase: 'TALLYING' })],
            }),
          ],
        }),
      ),
    ).toBe(false);
    expect(isWeekFinalAwaitingChange(undefined)).toBe(false);
  });

  test('自動更新がオンの間は決勝のマッチ中と待っている間に取り直し、オフでも待っている間は上限の回数まで取り直す', () => {
    expect(
      weekFinalRefetchIntervalOf({
        board: finalBoardWith('LIVE'),
        autoRefresh: true,
        updatesSinceBaseline: 0,
      }),
    ).toBe(LIVE_REFRESH_INTERVAL_MS);
    expect(
      weekFinalRefetchIntervalOf({
        board: finalBoardWith('LIVE'),
        autoRefresh: false,
        updatesSinceBaseline: 0,
      }),
    ).toBe(false);
    expect(
      weekFinalRefetchIntervalOf({
        board: finalBoardWith('TALLYING'),
        autoRefresh: false,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT - 1,
      }),
    ).toBe(LIVE_REFRESH_INTERVAL_MS);
    expect(
      weekFinalRefetchIntervalOf({
        board: finalBoardWith('TALLYING'),
        autoRefresh: false,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT,
      }),
    ).toBe(false);
    expect(
      weekFinalRefetchIntervalOf({
        board: finalBoardWith('FINISHED'),
        autoRefresh: true,
        updatesSinceBaseline: 0,
      }),
    ).toBe(false);
  });

  test('本文のWeekトーナメントの区画が同じ盤面を取り直す間は、決勝の区画は重ねて取り直さない', () => {
    const overlapping = weekBoardOf({
      rounds: [weekBoardRoundOf(), weekFinalRoundOf()],
    });
    expect(
      weekFinalRefetchIntervalOf({
        board: overlapping,
        autoRefresh: true,
        updatesSinceBaseline: 0,
      }),
    ).toBe(false);

    const awaitingBoth = weekBoardOf({
      rounds: [
        weekBoardRoundOf({
          matches: [weekMatchOf(1, { phase: 'TALLYING' })],
        }),
        weekFinalRoundOf({ matches: [finalMatchOf({ phase: 'TALLYING' })] }),
      ],
    });
    expect(
      weekFinalRefetchIntervalOf({
        board: awaitingBoth,
        autoRefresh: false,
        updatesSinceBaseline: 0,
      }),
    ).toBe(false);

    const liveSectionAwaitingFinal = weekBoardOf({
      rounds: [
        weekBoardRoundOf(),
        weekFinalRoundOf({ matches: [finalMatchOf({ phase: 'TALLYING' })] }),
      ],
    });
    expect(
      weekFinalRefetchIntervalOf({
        board: liveSectionAwaitingFinal,
        autoRefresh: false,
        updatesSinceBaseline: 0,
      }),
    ).toBe(LIVE_REFRESH_INTERVAL_MS);
  });

  test('自動更新がオフで決勝の結果か開始を待つ取り直しが上限に達した時だけ、開き直しの案内を出す', () => {
    expect(
      isWeekFinalFollowUpExhausted({
        board: finalBoardWith('TALLYING'),
        autoRefresh: false,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT,
      }),
    ).toBe(true);
    expect(
      isWeekFinalFollowUpExhausted({
        board: finalBoardWith('TALLYING'),
        autoRefresh: false,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT - 1,
      }),
    ).toBe(false);
    expect(
      isWeekFinalFollowUpExhausted({
        board: finalBoardWith('TALLYING'),
        autoRefresh: true,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT,
      }),
    ).toBe(false);
    expect(
      isWeekFinalFollowUpExhausted({
        board: finalBoardWith('FINISHED'),
        autoRefresh: false,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT,
      }),
    ).toBe(false);
  });
});
