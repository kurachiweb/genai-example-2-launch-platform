import { describe, expect, test } from 'bun:test';

import { assertEveningDispatchParticipants } from '../../lib/core/notifications/evening-dispatch.ts';
import { EVENING_BRACKET_JOB_DEFINITION } from '../application/week-tournament/week-tournament-jobs.ts';
import { YEAR_EVENING_BRACKET_JOB_DEFINITION } from '../application/year-tournament/year-tournament-jobs.ts';
import { EVENING_DISPATCH_PARTICIPANTS } from './evening-dispatch-participants.ts';

describe('夜の枠の送り出しの前提の登録口', () => {
  test('Week・Yearトーナメントの23:45の夜の処理を、それぞれのジョブと同じ名前で前提に登録する', () => {
    expect(EVENING_DISPATCH_PARTICIPANTS).toStrictEqual([
      'tournament-week.evening-bracket',
      'tournament-year.evening-bracket',
    ]);
    expect(EVENING_DISPATCH_PARTICIPANTS).toStrictEqual([
      EVENING_BRACKET_JOB_DEFINITION.name,
      YEAR_EVENING_BRACKET_JOB_DEFINITION.name,
    ]);
  });

  test('登録は<spec名>.<名詞句>の名前で重複しない', () => {
    expect(() => {
      assertEveningDispatchParticipants(EVENING_DISPATCH_PARTICIPANTS);
    }).not.toThrow();
  });
});
