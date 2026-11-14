import { describe, expect, test } from 'bun:test';

import { historyLaunchOf, historyMatchOf } from './match-history-fixtures.ts';
import {
  emptyMatchesStateOf,
  historyOutcomeOf,
  isCloseMatch,
  matchCountOf,
} from './match-history-model.ts';

describe('historyOutcomeOf', () => {
  test.each([
    ['WON', 'VOTES', false, 'won'],
    ['WON', 'LAST_UPVOTE', false, 'won'],
    ['BYE', 'BYE', false, 'bye'],
    ['WALKOVER', 'WALKOVER', false, 'bye'],
    ['WALKOVER', 'WALKOVER', true, 'early'],
    ['LOST', 'VOTES', false, 'lost'],
    ['LOST', 'LAST_UPVOTE', false, 'lost'],
    ['LOST', 'WALKOVER', false, 'lost'],
    ['LOST', 'NO_VOTES', false, 'both-lost'],
    ['LOST', 'BOTH_FORFEITED', false, 'both-lost'],
  ] as const)(
    '結果%s・決着%s・即時の終了%pは%sにする',
    (result, decision, endedEarly, expected) => {
      expect(
        historyOutcomeOf(historyMatchOf({ result, decision, endedEarly })),
      ).toBe(expected);
    },
  );
});

describe('isCloseMatch', () => {
  test('同数で最終Upvote時間により決まったマッチだけを接戦にする', () => {
    expect(isCloseMatch(historyMatchOf({ decision: 'LAST_UPVOTE' }))).toBe(
      true,
    );
    expect(isCloseMatch(historyMatchOf({ decision: 'VOTES' }))).toBe(false);
  });
});

describe('emptyMatchesStateOf', () => {
  test.each([
    ['SCHEDULED', false, 'upcoming'],
    ['PAIRED', false, 'upcoming'],
    ['IN_PROGRESS', true, 'live'],
    ['FINISHED', true, 'none'],
  ] as const)(
    '状態%s・キックオフ済み%pのローンチは%sにする',
    (status, kickedOff, expected) => {
      expect(
        emptyMatchesStateOf(
          historyLaunchOf({ status, kickedOff, matches: [] }),
        ),
      ).toBe(expected);
    },
  );
});

describe('matchCountOf', () => {
  test('全てのローンチの結果が確定したマッチを数える', () => {
    expect(
      matchCountOf([
        historyLaunchOf({ matches: [historyMatchOf(), historyMatchOf()] }),
        historyLaunchOf({ matches: [] }),
        historyLaunchOf(),
      ]),
    ).toBe(3);
  });
});
