import { describe, expect, test } from 'bun:test';

import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../../lib/core/tournament/identifiers.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../../lib/core/week-tournament/identifiers.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../../lib/core/year-tournament/identifiers.ts';
import { WEEK_TOURNAMENT_API_TYPES } from '../week-tournament/week-tournament-api-types.ts';
import { YEAR_TOURNAMENT_API_TYPES } from './year-tournament-api-types.ts';

const EXPECTED_NAMES = [
  'EveningBracketJob',
  'EntryFollowUpJob',
  'YearTournamentIncidentReporter',
  'YearBoardReader',
  'YearBracketReader',
  'YearEntryPanelReader',
  'YearEntryCheckout',
  'YearFinalDateService',
  'YearFinalDateWriter',
  'YearRelaunchConditionSource',
  'YearProductLockSource',
  'YearLaunchSummarySource',
  'YearTrophySource',
] as const;

describe('YEAR_TOURNAMENT_API_TYPES', () => {
  test('apiのジョブ・失敗の通知・照会・決済の開始・決勝実施日・判定の供給元・トロフィーの識別子だけを持つ', () => {
    expect(Object.keys(YEAR_TOURNAMENT_API_TYPES).toSorted()).toStrictEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のyear-tournament.api.<名前>である',
    (name) => {
      expect<symbol>(YEAR_TOURNAMENT_API_TYPES[name]).toBe(
        Symbol.for(`year-tournament.api.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(YEAR_TOURNAMENT_API_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('両アプリ共通のYear・Week・ブラケット・マッチ・通知の識別子とWeekのapiの識別子と重ならない', () => {
    const others = new Set<symbol>([
      ...Object.values<symbol>(YEAR_TOURNAMENT_TYPES),
      ...Object.values<symbol>(WEEK_TOURNAMENT_TYPES),
      ...Object.values<symbol>(WEEK_TOURNAMENT_API_TYPES),
      ...Object.values<symbol>(TOURNAMENT_PLATFORM_TYPES),
      ...Object.values<symbol>(MATCH_PLATFORM_TYPES),
      ...Object.values<symbol>(NOTIFICATIONS_PLATFORM_TYPES),
    ]);

    expect(
      Object.values<symbol>(YEAR_TOURNAMENT_API_TYPES).filter((identifier) =>
        others.has(identifier),
      ),
    ).toStrictEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(YEAR_TOURNAMENT_API_TYPES)).toBe(true);
  });
});
