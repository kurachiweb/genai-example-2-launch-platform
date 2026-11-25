import { describe, expect, test } from 'bun:test';

import { SPONSORSHIP_PLATFORM_TYPES } from '../../../lib/core/sponsorship/identifiers.ts';
import { EVENT_SPONSORSHIP_TYPES } from './event-sponsorship-types.ts';

const EXPECTED_NAMES = [
  'NoticeDispatchHandler',
  'NoticeClaimStore',
  'PeriodEndSettlementHandler',
  'PeriodEndSettlementCommitter',
  'AccountPurgeHandler',
  'ProductPurgeHandler',
  'SponsorshipPurgeStore',
] as const;

describe('EVENT_SPONSORSHIP_TYPES', () => {
  test('通知の送信・掲載の終わりの精算・物理削除の処理とそのポートの識別子だけを持つ', () => {
    expect(Object.keys(EVENT_SPONSORSHIP_TYPES).toSorted()).toStrictEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のsponsorship.event.<名前>である',
    (name) => {
      expect<symbol>(EVENT_SPONSORSHIP_TYPES[name]).toBe(
        Symbol.for(`sponsorship.event.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なり、両アプリ共通のスポンサー広告の識別子と重ならない', () => {
    const platform = new Set<symbol>(
      Object.values<symbol>(SPONSORSHIP_PLATFORM_TYPES),
    );

    expect(new Set(Object.values(EVENT_SPONSORSHIP_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
    expect(
      Object.values<symbol>(EVENT_SPONSORSHIP_TYPES).filter((identifier) =>
        platform.has(identifier),
      ),
    ).toStrictEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_SPONSORSHIP_TYPES)).toBe(true);
  });
});
