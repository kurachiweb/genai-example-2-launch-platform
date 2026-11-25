import { describe, expect, test } from 'bun:test';

import { assertDecisionSourceRegistrations } from '../application/product/decision-sources.ts';
import { WEEK_TOURNAMENT_API_TYPES } from '../application/week-tournament/week-tournament-api-types.ts';
import { YEAR_TOURNAMENT_API_TYPES } from '../application/year-tournament/year-tournament-api-types.ts';
import {
  LAUNCH_SUMMARY_SOURCES,
  PRODUCT_LOCK_SOURCES,
  RELAUNCH_CONDITION_SOURCES,
} from './product-decision-sources.ts';

const REGISTRIES = [
  ['次回の予約の禁止', RELAUNCH_CONDITION_SOURCES],
  ['固定', PRODUCT_LOCK_SOURCES],
  ['ローンチの要約と受賞', LAUNCH_SUMMARY_SOURCES],
] as const;

describe('判定の供給元の登録口', () => {
  test('3つの登録口に、Weekトーナメントの供給元をorderの1500で、Yearトーナメントの供給元をorderの1700で1つずつ登録する', () => {
    expect(RELAUNCH_CONDITION_SOURCES).toStrictEqual([
      {
        name: 'tournament-week.result-pending',
        order: 1500,
        source: WEEK_TOURNAMENT_API_TYPES.WeekRelaunchConditionSource,
      },
      {
        name: 'tournament-year.result-pending',
        order: 1700,
        source: YEAR_TOURNAMENT_API_TYPES.YearRelaunchConditionSource,
      },
    ]);
    expect(PRODUCT_LOCK_SOURCES).toStrictEqual([
      {
        name: 'tournament-week.bracket-lock',
        order: 1500,
        source: WEEK_TOURNAMENT_API_TYPES.WeekProductLockSource,
      },
      {
        name: 'tournament-year.bracket-lock',
        order: 1700,
        source: YEAR_TOURNAMENT_API_TYPES.YearProductLockSource,
      },
    ]);
    expect(LAUNCH_SUMMARY_SOURCES).toStrictEqual([
      {
        name: 'tournament-week.launch-summary',
        order: 1500,
        source: WEEK_TOURNAMENT_API_TYPES.WeekLaunchSummarySource,
      },
      {
        name: 'tournament-year.launch-summary',
        order: 1700,
        source: YEAR_TOURNAMENT_API_TYPES.YearLaunchSummarySource,
      },
    ]);
  });

  test.each(REGISTRIES)(
    '%sの登録は<spec名>.<名詞句>の名前とorderが重複せず、orderは整数である',
    (_name, registrations) => {
      expect(() => {
        assertDecisionSourceRegistrations(registrations);
      }).not.toThrow();
    },
  );
});
