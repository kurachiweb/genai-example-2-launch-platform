import { describe, expect, test } from 'bun:test';

import { bracketRoundOf } from '../bracket/bracket-fixtures.ts';
import {
  AWARDED_YEAR_BRACKET,
  NO_AWARD_YEAR_BRACKET,
  YEAR_AWARDED_ROUNDS,
  YEAR_FINAL_DATE,
  YEAR_IN_PROGRESS_ROUNDS,
  yearBracketOf,
} from './year-tournament-fixtures.ts';
import { yearBracketFinalDateOf } from './year-bracket-model.ts';

const DELAYED_FINAL_DATE = '2027-05-31';

const delayedFinalRoundOf = (
  rounds: typeof YEAR_IN_PROGRESS_ROUNDS,
): typeof YEAR_IN_PROGRESS_ROUNDS => {
  const final = rounds.at(-1);
  if (final === undefined) {
    throw new Error('決勝のラウンドが無い');
  }
  return [
    ...rounds.slice(0, -1),
    bracketRoundOf(final.round, final.name, DELAYED_FINAL_DATE, final.nodes),
  ];
};

describe('yearBracketFinalDateOf', () => {
  test('開催中は、予定を作る前の決勝でも最後のラウンドの実施日を決勝日にする', () => {
    expect(yearBracketFinalDateOf(yearBracketOf())).toBe(YEAR_FINAL_DATE);
  });

  test('ラウンドの遅れで最後のラウンドの実施日が設定した決勝日より後になったら、遅らせた後の日を決勝日にする', () => {
    const bracket = yearBracketOf({
      rounds: [...delayedFinalRoundOf(YEAR_IN_PROGRESS_ROUNDS)],
    });

    expect(bracket.tournament.finalDate).toBe(YEAR_FINAL_DATE);
    expect(yearBracketFinalDateOf(bracket)).toBe(DELAYED_FINAL_DATE);
  });

  test('決勝を行って終えた年は、受賞の有無によらず決勝のラウンドの実施日を決勝日にする', () => {
    const delayed = yearBracketOf({
      tournament: { status: 'FINISHED', awarded: true },
      rounds: [...delayedFinalRoundOf(YEAR_AWARDED_ROUNDS)],
    });

    expect(yearBracketFinalDateOf(AWARDED_YEAR_BRACKET)).toBe(YEAR_FINAL_DATE);
    expect(yearBracketFinalDateOf(NO_AWARD_YEAR_BRACKET)).toBe(YEAR_FINAL_DATE);
    expect(yearBracketFinalDateOf(delayed)).toBe(DELAYED_FINAL_DATE);
  });

  test('決勝の前のラウンドで終えた年は、最後のラウンドの実施日でなく設定した決勝日を示す', () => {
    const bracket = yearBracketOf({
      tournament: { status: 'FINISHED', awarded: false },
      rounds: YEAR_AWARDED_ROUNDS.slice(0, -1),
    });

    expect(yearBracketFinalDateOf(bracket)).toBe(YEAR_FINAL_DATE);
  });

  test('ラウンドを並べない参加0・1の年は、設定した決勝日を示す', () => {
    const bracket = yearBracketOf({
      tournament: {
        status: 'FINISHED',
        awarded: true,
        finalDate: '2027-05-23',
      },
      participantCount: 1,
      seedCount: 0,
      rounds: [],
    });

    expect(yearBracketFinalDateOf(bracket)).toBe('2027-05-23');
  });
});
