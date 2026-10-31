import { describe, expect, test } from 'bun:test';

import { SEARCH_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'TargetCatalog',
  'SourceProvider',
  'IndexStore',
  'RefreshRequester',
  'KeywordExtractor',
  'RefreshHandler',
  'ReextractionJob',
] as const;

describe('SEARCH_TYPES', () => {
  test('両アプリと検索を持つドメインが共有する7種の識別子だけを持つ', () => {
    expect(Object.keys(SEARCH_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のsearch.<名前>である',
    (name) => {
      expect<symbol>(SEARCH_TYPES[name]).toBe(Symbol.for(`search.${name}`));
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(SEARCH_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(SEARCH_TYPES)).toBe(true);
  });
});
