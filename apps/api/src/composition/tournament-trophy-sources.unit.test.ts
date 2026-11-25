import { describe, expect, test } from 'bun:test';

import { assertTrophySourceRegistrations } from '../application/tournament/trophy-source.ts';
import { WEEK_TOURNAMENT_API_TYPES } from '../application/week-tournament/week-tournament-api-types.ts';
import { YEAR_TOURNAMENT_API_TYPES } from '../application/year-tournament/year-tournament-api-types.ts';
import { TOURNAMENT_TROPHY_SOURCES } from './tournament-trophy-sources.ts';

describe('トロフィーの供給元の登録口', () => {
  test('Yearの受賞の供給元をorderの10で、Weekの受賞の供給元をorderの20で登録する', () => {
    expect(TOURNAMENT_TROPHY_SOURCES).toStrictEqual([
      {
        name: 'tournament-year.year-trophies',
        order: 10,
        source: YEAR_TOURNAMENT_API_TYPES.YearTrophySource,
      },
      {
        name: 'tournament-week.week-trophies',
        order: 20,
        source: WEEK_TOURNAMENT_API_TYPES.WeekTrophySource,
      },
    ]);
  });

  test('登録は<spec名>.<名詞句>の名前とorderが重複せず、orderは整数である', () => {
    expect(() => {
      assertTrophySourceRegistrations(TOURNAMENT_TROPHY_SOURCES);
    }).not.toThrow();
  });
});
