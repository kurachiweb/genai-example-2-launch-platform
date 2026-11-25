import { describe, expect, test } from 'bun:test';

import { TOURNAMENT_PLATFORM_TYPES } from '../../../lib/core/tournament/identifiers.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../../lib/core/week-tournament/identifiers.ts';
import { EVENT_WEEK_TOURNAMENT_TYPES } from './event-week-tournament-types.ts';

describe('EVENT_WEEK_TOURNAMENT_TYPES', () => {
  test('マッチイベント・プロダクトとユーザーのライフサイクル・Ultrasの知らせの7つの処理と、結果通知の追記の識別子だけを持つ', () => {
    expect(Object.keys(EVENT_WEEK_TOURNAMENT_TYPES).toSorted()).toStrictEqual([
      'AccountEntryLossHandler',
      'EntryUnlinkHandler',
      'ProductEntryLossHandler',
      'QualifierEntryHandler',
      'RoundProgressHandler',
      'WeekEntrySupplementProvider',
      'WeekOpenEntryCheckoutExpiryHandler',
      'WeekUltrasEntryExemptionHandler',
    ]);
  });

  test('識別子はグローバルのシンボル登録簿のweek-tournament.event.<名前>である', () => {
    for (const [name, identifier] of Object.entries<symbol>(
      EVENT_WEEK_TOURNAMENT_TYPES,
    )) {
      expect<symbol>(identifier).toBe(
        Symbol.for(`week-tournament.event.${name}`),
      );
    }
  });

  test('両アプリ共通のWeekとブラケットの識別子と重ならない', () => {
    const shared = new Set<symbol>([
      ...Object.values<symbol>(WEEK_TOURNAMENT_TYPES),
      ...Object.values<symbol>(TOURNAMENT_PLATFORM_TYPES),
    ]);

    expect(
      Object.values<symbol>(EVENT_WEEK_TOURNAMENT_TYPES).filter((identifier) =>
        shared.has(identifier),
      ),
    ).toStrictEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_WEEK_TOURNAMENT_TYPES)).toBe(true);
  });
});
