import { describe, expect, test } from 'bun:test';

import { YEAR_TOURNAMENT_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'YearTournamentStore',
  'YearEntryStore',
  'YearCalendar',
  'YearEntryRegistrar',
  'YearEntryOfferPolicy',
  'YearEntryFulfillment',
  'YearDrawService',
  'YearProgressionService',
  'YearEntryFollowUp',
  'YearNotificationPublisher',
  'YearAwardExport',
] as const;

describe('YEAR_TOURNAMENT_TYPES', () => {
  test('両アプリと後続specが共有する11種の識別子だけを持つ', () => {
    expect(Object.keys(YEAR_TOURNAMENT_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のyear-tournament.<名前>である',
    (name) => {
      expect<symbol>(YEAR_TOURNAMENT_TYPES[name]).toBe(
        Symbol.for(`year-tournament.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(YEAR_TOURNAMENT_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(YEAR_TOURNAMENT_TYPES)).toBe(true);
  });
});
