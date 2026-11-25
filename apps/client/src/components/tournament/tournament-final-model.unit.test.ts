import { describe, expect, test } from 'bun:test';

import { LIVE_REFRESH_INTERVAL_MS } from '../../../lib/utilities/query/live-refresh.ts';
import type { MatchFragment } from '../../graphql/generated/graphql.ts';
import { FOLLOW_UP_REFETCH_LIMIT } from '../match/follow-up-refetch.ts';
import { entryOf } from '../match/match-fixtures.ts';
import {
  boardByeOf,
  boardFinalRoundOf,
  boardMatchOf,
  boardRoundOf,
} from './tournament-board-fixtures.ts';
import { splitBoardRound } from './tournament-board-model.ts';
import {
  canFinalChange,
  finalOutcomeOf,
  finalRefetchIntervalOf,
  finalRoundsOf,
  isFinalAwaitingChange,
  isFinalFollowUpExhausted,
} from './tournament-final-model.ts';

const finalMatchOf = (overrides: Partial<MatchFragment> = {}): MatchFragment =>
  boardMatchOf(21, { round: 8, stage: 'FINAL', ...overrides });

const finalRoundsWith = (phase: MatchFragment['phase']) => [
  boardFinalRoundOf({ matches: [finalMatchOf({ phase })] }),
];

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

describe('finalRoundsOf', () => {
  test('決勝の行だけを、対戦カードか不戦勝を持つものに限ってサーバーの順のまま並べる', () => {
    const first = boardFinalRoundOf();
    const forfeited = boardFinalRoundOf({
      key: 'forfeited',
      matches: [],
      byes: [],
    });
    const byeOnly = boardFinalRoundOf({
      key: 'bye-only',
      matches: [],
      byes: [boardByeOf(1, { round: 8 })],
    });

    const rows = finalRoundsOf([boardRoundOf(), first, forfeited, byeOnly]);

    expect(rows.map(({ round }) => round.key)).toStrictEqual([
      'final',
      'bye-only',
    ]);
    expect(rows[0]).toStrictEqual({ round: first, ...splitBoardRound(first) });
  });

  test('その日に決勝が無ければ空にする', () => {
    expect(finalRoundsOf([boardRoundOf()])).toStrictEqual([]);
    expect(finalRoundsOf([])).toStrictEqual([]);
  });
});

describe('finalOutcomeOf', () => {
  test('確定の前の決勝は結果を持たない', () => {
    for (const phase of ['SCHEDULED', 'LIVE', 'TALLYING'] as const) {
      expect(
        finalOutcomeOf(
          splitBoardRound(
            boardFinalRoundOf({ matches: [finalMatchOf({ phase })] }),
          ),
        ),
      ).toBeNull();
    }
  });

  test('確定した決勝は勝った側のプロダクトの受賞にし、表示できない側は「非公開のプロダクト」とする', () => {
    expect(
      finalOutcomeOf(
        splitBoardRound(
          boardFinalRoundOf({ matches: [decided('VOTES', ['LOST', 'WON'])] }),
        ),
      ),
    ).toStrictEqual({ kind: 'awarded', productName: 'Right 21' });

    const hidden = decided('LAST_UPVOTE', ['WON', 'LOST']);
    const [left, right] = hidden.entries;
    expect(
      finalOutcomeOf(
        splitBoardRound(
          boardFinalRoundOf({
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
      finalOutcomeOf(
        splitBoardRound(
          boardFinalRoundOf({
            matches: [decided('NO_VOTES', ['LOST', 'LOST'])],
          }),
        ),
      ),
    ).toStrictEqual({ kind: 'no-award' });
  });

  test('不戦勝と早期勝利の決勝は、その側のプロダクトの受賞にする', () => {
    expect(
      finalOutcomeOf(
        splitBoardRound(
          boardFinalRoundOf({
            matches: [],
            byes: [boardByeOf(1, { round: 8, endedEarly: true })],
          }),
        ),
      ),
    ).toStrictEqual({ kind: 'awarded', productName: 'Bye 1' });
  });
});

describe('決勝の区画の定期の取り直し', () => {
  test('決勝の対戦カードが確定の前の間だけ、変わり得ると判定する', () => {
    expect(canFinalChange(finalRoundsWith('LIVE'))).toBe(true);
    expect(canFinalChange(finalRoundsWith('TALLYING'))).toBe(true);
    expect(canFinalChange(finalRoundsWith('SCHEDULED'))).toBe(true);
    expect(canFinalChange(finalRoundsWith('FINISHED'))).toBe(false);
    expect(canFinalChange([boardRoundOf()])).toBe(false);
    expect(canFinalChange(undefined)).toBe(false);
  });

  test('決勝の対戦カードが集計中か開始の前なら、結果か開始を待っていると判定する', () => {
    expect(isFinalAwaitingChange(finalRoundsWith('TALLYING'))).toBe(true);
    expect(isFinalAwaitingChange(finalRoundsWith('SCHEDULED'))).toBe(true);
    expect(isFinalAwaitingChange(finalRoundsWith('LIVE'))).toBe(false);
    expect(
      isFinalAwaitingChange([
        boardRoundOf({ matches: [boardMatchOf(1, { phase: 'TALLYING' })] }),
      ]),
    ).toBe(false);
    expect(isFinalAwaitingChange(undefined)).toBe(false);
  });

  test('自動更新がオンの間は決勝のマッチ中と待っている間に取り直し、オフでも待っている間は上限の回数まで取り直す', () => {
    expect(
      finalRefetchIntervalOf({
        rounds: finalRoundsWith('LIVE'),
        autoRefresh: true,
        updatesSinceBaseline: 0,
      }),
    ).toBe(LIVE_REFRESH_INTERVAL_MS);
    expect(
      finalRefetchIntervalOf({
        rounds: finalRoundsWith('LIVE'),
        autoRefresh: false,
        updatesSinceBaseline: 0,
      }),
    ).toBe(false);
    expect(
      finalRefetchIntervalOf({
        rounds: finalRoundsWith('TALLYING'),
        autoRefresh: false,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT - 1,
      }),
    ).toBe(LIVE_REFRESH_INTERVAL_MS);
    expect(
      finalRefetchIntervalOf({
        rounds: finalRoundsWith('TALLYING'),
        autoRefresh: false,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT,
      }),
    ).toBe(false);
    expect(
      finalRefetchIntervalOf({
        rounds: finalRoundsWith('FINISHED'),
        autoRefresh: true,
        updatesSinceBaseline: 0,
      }),
    ).toBe(false);
  });

  test('本文の区画が同じ盤面を取り直す間は、決勝の区画は重ねて取り直さない', () => {
    expect(
      finalRefetchIntervalOf({
        rounds: [boardRoundOf(), boardFinalRoundOf()],
        autoRefresh: true,
        updatesSinceBaseline: 0,
      }),
    ).toBe(false);

    expect(
      finalRefetchIntervalOf({
        rounds: [
          boardRoundOf({ matches: [boardMatchOf(1, { phase: 'TALLYING' })] }),
          boardFinalRoundOf({
            matches: [finalMatchOf({ phase: 'TALLYING' })],
          }),
        ],
        autoRefresh: false,
        updatesSinceBaseline: 0,
      }),
    ).toBe(false);

    expect(
      finalRefetchIntervalOf({
        rounds: [
          boardRoundOf(),
          boardFinalRoundOf({
            matches: [finalMatchOf({ phase: 'TALLYING' })],
          }),
        ],
        autoRefresh: false,
        updatesSinceBaseline: 0,
      }),
    ).toBe(LIVE_REFRESH_INTERVAL_MS);
  });

  test('自動更新がオフで決勝の結果か開始を待つ取り直しが上限に達した時だけ、開き直しの案内を出す', () => {
    expect(
      isFinalFollowUpExhausted({
        rounds: finalRoundsWith('TALLYING'),
        autoRefresh: false,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT,
      }),
    ).toBe(true);
    expect(
      isFinalFollowUpExhausted({
        rounds: finalRoundsWith('TALLYING'),
        autoRefresh: false,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT - 1,
      }),
    ).toBe(false);
    expect(
      isFinalFollowUpExhausted({
        rounds: finalRoundsWith('TALLYING'),
        autoRefresh: true,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT,
      }),
    ).toBe(false);
    expect(
      isFinalFollowUpExhausted({
        rounds: finalRoundsWith('FINISHED'),
        autoRefresh: false,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT,
      }),
    ).toBe(false);
  });
});
