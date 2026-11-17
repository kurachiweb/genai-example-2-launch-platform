import { describe, expect, test } from 'bun:test';

import { TOURNAMENT_PLATFORM_TYPES } from '../../../lib/core/tournament/identifiers.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../../lib/core/year-tournament/identifiers.ts';
import { EVENT_WEEK_TOURNAMENT_TYPES } from '../week-tournament/event-week-tournament-types.ts';
import { EVENT_YEAR_TOURNAMENT_TYPES } from './event-year-tournament-types.ts';

describe('EVENT_YEAR_TOURNAMENT_TYPES', () => {
  test('マッチイベント・プロダクトとユーザーのライフサイクル・Ultrasの知らせの7つの処理と、結果通知の追記の識別子だけを持つ', () => {
    expect(Object.keys(EVENT_YEAR_TOURNAMENT_TYPES).toSorted()).toStrictEqual([
      'AccountEntryLossHandler',
      'EntryUnlinkHandler',
      'ProductEntryLossHandler',
      'RoundProgressHandler',
      'WeekChampionEntryHandler',
      'YearEntrySupplementProvider',
      'YearOpenEntryCheckoutExpiryHandler',
      'YearUltrasEntryExemptionHandler',
    ]);
  });

  test('識別子はグローバルのシンボル登録簿のyear-tournament.event.<名前>である', () => {
    for (const [name, identifier] of Object.entries<symbol>(
      EVENT_YEAR_TOURNAMENT_TYPES,
    )) {
      expect<symbol>(identifier).toBe(
        Symbol.for(`year-tournament.event.${name}`),
      );
    }
  });

  test('両アプリ共通のYearとブラケットの識別子、イベントサーバーのWeekの識別子と重ならない', () => {
    const others = new Set<symbol>([
      ...Object.values<symbol>(YEAR_TOURNAMENT_TYPES),
      ...Object.values<symbol>(TOURNAMENT_PLATFORM_TYPES),
      ...Object.values<symbol>(EVENT_WEEK_TOURNAMENT_TYPES),
    ]);

    expect(
      Object.values<symbol>(EVENT_YEAR_TOURNAMENT_TYPES).filter((identifier) =>
        others.has(identifier),
      ),
    ).toStrictEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_YEAR_TOURNAMENT_TYPES)).toBe(true);
  });
});
