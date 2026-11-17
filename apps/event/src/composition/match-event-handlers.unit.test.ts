import { describe, expect, test } from 'bun:test';

import {
  createMatchEventRegistry,
  MATCH_EVENT_TYPES,
} from '../../lib/core/match/match-events.ts';
import { EVENT_WEEK_TOURNAMENT_TYPES } from '../application/week-tournament/event-week-tournament-types.ts';
import { MATCH_EVENT_HANDLERS } from './match-event-handlers.ts';

const namesFor = (
  type: (typeof MATCH_EVENT_TYPES)[number],
  kind: 'qualifier' | 'week' | 'year',
): readonly string[] =>
  createMatchEventRegistry(MATCH_EVENT_HANDLERS)
    .handlersFor({ type, kind })
    .map(({ name }) => name);

describe('マッチイベントの処理の登録口', () => {
  test('登録は<spec名>.<名詞句>の名前と同じイベントでのorderが重複せず、検証を通る凍結済みの配列である', () => {
    expect(Object.isFrozen(MATCH_EVENT_HANDLERS)).toBe(true);
    expect(() => createMatchEventRegistry(MATCH_EVENT_HANDLERS)).not.toThrow();
  });

  test('tournament-weekは予選のマッチの確定に1500で枠の作成を、Weekのマッチの確定に1510でラウンドの進行を登録する', () => {
    expect(
      MATCH_EVENT_HANDLERS.filter(({ name }) =>
        name.startsWith('tournament-week.'),
      ),
    ).toStrictEqual([
      {
        name: 'tournament-week.qualifier-entry',
        events: ['decided'],
        kinds: ['qualifier'],
        order: 1500,
        handler: EVENT_WEEK_TOURNAMENT_TYPES.QualifierEntryHandler,
      },
      {
        name: 'tournament-week.decided-round-progress',
        events: ['decided'],
        kinds: ['week'],
        order: 1510,
        handler: EVENT_WEEK_TOURNAMENT_TYPES.RoundProgressHandler,
      },
    ]);
  });

  test('予選のマッチの確定では結果の記録と一覧の記録の後に枠の作成が並び、Weekのマッチの確定ではラウンドの進行だけが並ぶ', () => {
    expect(namesFor('decided', 'qualifier')).toStrictEqual([
      'match-engine.qualifier-outcome',
      'directory-discovery.qualifier-listing',
      'tournament-week.qualifier-entry',
    ]);
    expect(namesFor('decided', 'week')).toStrictEqual([
      'tournament-week.decided-round-progress',
    ]);
  });

  test('tournament-weekの処理は、Yearのマッチの確定と、予定の作成・開始のイベントでは呼ばれない', () => {
    const others = MATCH_EVENT_TYPES.flatMap((type) =>
      (['qualifier', 'week', 'year'] as const).flatMap((kind) =>
        type === 'decided' && kind !== 'year' ? [] : namesFor(type, kind),
      ),
    );

    expect(
      others.filter((name) => name.startsWith('tournament-week.')),
    ).toEqual([]);
  });
});
