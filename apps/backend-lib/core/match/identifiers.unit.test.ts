import { describe, expect, test } from 'bun:test';

import { MATCH_PLATFORM_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'MatchDirectory',
  'SupporterDirectory',
  'MatchScheduler',
  'MatchEventStore',
  'MatchEventDispatcher',
  'MatchExport',
  'UpvoteExport',
] as const;

describe('MATCH_PLATFORM_TYPES', () => {
  test('両アプリと後続specが共有する7種の識別子だけを持つ', () => {
    expect(Object.keys(MATCH_PLATFORM_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のmatch.<名前>である',
    (name) => {
      expect<symbol>(MATCH_PLATFORM_TYPES[name]).toBe(
        Symbol.for(`match.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(MATCH_PLATFORM_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(MATCH_PLATFORM_TYPES)).toBe(true);
  });
});
