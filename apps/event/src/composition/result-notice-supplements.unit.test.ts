import { describe, expect, test } from 'bun:test';

import { MATCH_KINDS } from '../../lib/core/match/match-model.ts';
import { createResultNoticeSupplementRegistry } from '../../lib/core/notifications/result-notice-supplements.ts';
import { EVENT_WEEK_TOURNAMENT_TYPES } from '../application/week-tournament/event-week-tournament-types.ts';
import { EVENT_YEAR_TOURNAMENT_TYPES } from '../application/year-tournament/event-year-tournament-types.ts';
import { RESULT_NOTICE_SUPPLEMENTS } from './result-notice-supplements.ts';

describe('勝敗結果の通知の追記の登録口', () => {
  test('登録は<spec名>.<名詞句>の名前と同じ種別でのorderが重複せず、検証を通る凍結済みの配列である', () => {
    expect(Object.isFrozen(RESULT_NOTICE_SUPPLEMENTS)).toBe(true);
    expect(() =>
      createResultNoticeSupplementRegistry(RESULT_NOTICE_SUPPLEMENTS),
    ).not.toThrow();
  });

  test('tournament-weekは予選の結果に1500で参加費の決済期限の追記を登録する', () => {
    expect(
      RESULT_NOTICE_SUPPLEMENTS.filter(({ name }) =>
        name.startsWith('tournament-week.'),
      ),
    ).toStrictEqual([
      {
        name: 'tournament-week.entry-deadline',
        kinds: ['qualifier'],
        order: 1500,
        provider: EVENT_WEEK_TOURNAMENT_TYPES.WeekEntrySupplementProvider,
      },
    ]);
  });

  test('tournament-yearはWeekの結果に1700で参加費の決済期限の追記を登録する', () => {
    expect(
      RESULT_NOTICE_SUPPLEMENTS.filter(({ name }) =>
        name.startsWith('tournament-year.'),
      ),
    ).toStrictEqual([
      {
        name: 'tournament-year.entry-deadline',
        kinds: ['week'],
        order: 1700,
        provider: EVENT_YEAR_TOURNAMENT_TYPES.YearEntrySupplementProvider,
      },
    ]);
  });

  test('予選の結果にはWeekの決済期限の追記が、Weekの結果にはYearの決済期限の追記が並び、Yearの結果には並ばない', () => {
    const registry = createResultNoticeSupplementRegistry(
      RESULT_NOTICE_SUPPLEMENTS,
    );
    const namesFor = (kind: (typeof MATCH_KINDS)[number]) =>
      registry.providersFor(kind).map(({ name }) => name);

    expect(namesFor('qualifier')).toStrictEqual([
      'tournament-week.entry-deadline',
    ]);
    expect(namesFor('week')).toStrictEqual(['tournament-year.entry-deadline']);
    expect(namesFor('year')).toStrictEqual([]);
  });
});
