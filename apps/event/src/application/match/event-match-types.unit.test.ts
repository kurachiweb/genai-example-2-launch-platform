import { describe, expect, test } from 'bun:test';

import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import { EVENT_MATCH_TYPES } from './event-match-types.ts';

describe('EVENT_MATCH_TYPES', () => {
  test('マッチイベントの実行器と予選の結果の記録の処理の識別子を持つ', () => {
    const names = new Set(Object.keys(EVENT_MATCH_TYPES));

    expect(names.has('MatchEventRunner')).toBe(true);
    expect(names.has('QualifierOutcomeHandler')).toBe(true);
  });

  test('識別子はグローバルのシンボル登録簿のmatch.event.<名前>である', () => {
    for (const [name, identifier] of Object.entries(EVENT_MATCH_TYPES)) {
      expect<symbol>(identifier).toBe(Symbol.for(`match.event.${name}`));
    }
  });

  test('両アプリ共通の識別子と重ならない', () => {
    const shared = new Set<symbol>(Object.values(MATCH_PLATFORM_TYPES));

    expect(
      Object.values(EVENT_MATCH_TYPES).filter((identifier) =>
        shared.has(identifier),
      ),
    ).toEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_MATCH_TYPES)).toBe(true);
  });
});
