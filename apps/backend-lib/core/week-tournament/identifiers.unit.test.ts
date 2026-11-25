import { describe, expect, test } from 'bun:test';

import { WEEK_TOURNAMENT_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'WeekTournamentStore',
  'WeekEntryRegistrar',
  'WeekEntryOfferPolicy',
  'WeekEntryFulfillment',
  'WeekDrawService',
  'WeekProgressionService',
  'WeekEntryFollowUp',
  'WeekNotificationPublisher',
  'WeekChampionDirectory',
  'WeekAwardExport',
] as const;

describe('WEEK_TOURNAMENT_TYPES', () => {
  test('両アプリと後続specが共有する10種の識別子だけを持つ', () => {
    expect(Object.keys(WEEK_TOURNAMENT_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のweek-tournament.<名前>である',
    (name) => {
      expect<symbol>(WEEK_TOURNAMENT_TYPES[name]).toBe(
        Symbol.for(`week-tournament.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(WEEK_TOURNAMENT_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(WEEK_TOURNAMENT_TYPES)).toBe(true);
  });
});
