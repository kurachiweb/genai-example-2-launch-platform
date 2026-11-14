import { describe, expect, test } from 'bun:test';

import { SEARCH_TYPES } from '../../../lib/core/search/identifiers.ts';
import { EVENT_SEARCH_TYPES } from './search-types.ts';

describe('EVENT_SEARCH_TYPES', () => {
  test('イベントサーバーだけが束縛する通知のポートの識別子だけを持つ', () => {
    expect(Object.keys(EVENT_SEARCH_TYPES)).toEqual(['SearchIncidentReporter']);
  });

  test('識別子はグローバルのシンボル登録簿のsearch.<名前>である', () => {
    expect<symbol>(EVENT_SEARCH_TYPES.SearchIncidentReporter).toBe(
      Symbol.for('search.SearchIncidentReporter'),
    );
  });

  test('両アプリ共通の識別子と重ならない', () => {
    const shared = new Set<symbol>(Object.values(SEARCH_TYPES));

    expect(
      Object.values(EVENT_SEARCH_TYPES).filter((identifier) =>
        shared.has(identifier),
      ),
    ).toEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_SEARCH_TYPES)).toBe(true);
  });
});
