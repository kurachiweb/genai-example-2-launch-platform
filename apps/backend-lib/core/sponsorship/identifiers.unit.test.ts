import { describe, expect, test } from 'bun:test';

import { SPONSORSHIP_PLATFORM_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'SponsorshipStore',
  'EligibleProductReader',
  'PlacementReader',
  'SponsorshipOfferPolicy',
  'SponsorshipFulfillment',
  'NoticeScheduler',
  'NoticeRequester',
  'DisplayStopStore',
  'DisplayStopStatements',
  'RefundEstimator',
  'RefundSettlement',
  'SponsorshipExport',
] as const;

describe('SPONSORSHIP_PLATFORM_TYPES', () => {
  test('両アプリと後続specが共有する12種の識別子だけを持つ', () => {
    expect(Object.keys(SPONSORSHIP_PLATFORM_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のsponsorship.<名前>である',
    (name) => {
      expect<symbol>(SPONSORSHIP_PLATFORM_TYPES[name]).toBe(
        Symbol.for(`sponsorship.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(SPONSORSHIP_PLATFORM_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(SPONSORSHIP_PLATFORM_TYPES)).toBe(true);
  });
});
