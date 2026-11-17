import { describe, expect, test } from 'bun:test';

import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../../lib/core/tournament/identifiers.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../../lib/core/week-tournament/identifiers.ts';
import { WEEK_TOURNAMENT_API_TYPES } from './week-tournament-api-types.ts';

const EXPECTED_NAMES = [
  'EveningBracketJob',
  'EntryFollowUpJob',
  'WeekTournamentIncidentReporter',
  'WeekBoardReader',
  'WeekBracketReader',
  'WeekEntryPanelReader',
  'WeekEntryCheckout',
  'WeekRelaunchConditionSource',
  'WeekProductLockSource',
  'WeekLaunchSummarySource',
  'WeekTrophySource',
  'TrophySources',
  'ProductTrophyReader',
] as const;

describe('WEEK_TOURNAMENT_API_TYPES', () => {
  test('apiのジョブ・失敗の通知・照会・決済の開始・判定の供給元・トロフィーの識別子だけを持つ', () => {
    expect(Object.keys(WEEK_TOURNAMENT_API_TYPES).toSorted()).toStrictEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のweek-tournament.api.<名前>である',
    (name) => {
      expect<symbol>(WEEK_TOURNAMENT_API_TYPES[name]).toBe(
        Symbol.for(`week-tournament.api.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(WEEK_TOURNAMENT_API_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('両アプリ共通のWeek・ブラケット・マッチ・通知の識別子と重ならない', () => {
    const shared = new Set<symbol>([
      ...Object.values<symbol>(WEEK_TOURNAMENT_TYPES),
      ...Object.values<symbol>(TOURNAMENT_PLATFORM_TYPES),
      ...Object.values<symbol>(MATCH_PLATFORM_TYPES),
      ...Object.values<symbol>(NOTIFICATIONS_PLATFORM_TYPES),
    ]);

    expect(
      Object.values<symbol>(WEEK_TOURNAMENT_API_TYPES).filter((identifier) =>
        shared.has(identifier),
      ),
    ).toStrictEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(WEEK_TOURNAMENT_API_TYPES)).toBe(true);
  });
});
