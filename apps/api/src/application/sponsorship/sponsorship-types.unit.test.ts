import { describe, expect, test } from 'bun:test';

import { SPONSORSHIP_PLATFORM_TYPES } from '../../../lib/core/sponsorship/identifiers.ts';
import { SPONSORSHIP_TYPES } from './sponsorship-types.ts';

const EXPECTED_NAMES = [
  'SponsorshipApplication',
  'SponsorshipOfferReader',
  'MySponsorshipsReader',
  'AdminSponsorshipsReader',
  'SponsorshipTermination',
  'SponsorshipTerminationWriter',
  'DailyNoticesJob',
  'MaintenanceJob',
  'AccountWithdrawalSyncHandler',
  'ProductDeletionSyncHandler',
  'AccountDisplayStopSyncHandler',
  'ProductDisplayStopSyncHandler',
] as const;

describe('SPONSORSHIP_TYPES', () => {
  test('apiのユースケース・強制終了の書き込み・ジョブ・同期の処理の識別子だけを持つ', () => {
    expect(Object.keys(SPONSORSHIP_TYPES).toSorted()).toStrictEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のsponsorship.api.<名前>である',
    (name) => {
      expect<symbol>(SPONSORSHIP_TYPES[name]).toBe(
        Symbol.for(`sponsorship.api.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なり、両アプリ共通のスポンサー広告の識別子と重ならない', () => {
    const platform = new Set<symbol>(
      Object.values<symbol>(SPONSORSHIP_PLATFORM_TYPES),
    );

    expect(new Set(Object.values(SPONSORSHIP_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
    expect(
      Object.values<symbol>(SPONSORSHIP_TYPES).filter((identifier) =>
        platform.has(identifier),
      ),
    ).toStrictEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(SPONSORSHIP_TYPES)).toBe(true);
  });
});
