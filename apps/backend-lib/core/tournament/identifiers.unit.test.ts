import { describe, expect, test } from 'bun:test';

import { TOURNAMENT_PLATFORM_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'BracketStore',
  'BracketDraw',
  'BracketProgression',
] as const;

describe('TOURNAMENT_PLATFORM_TYPES', () => {
  test('両アプリと後続specが共有する3種の識別子だけを持つ', () => {
    expect(Object.keys(TOURNAMENT_PLATFORM_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のtournament.<名前>である',
    (name) => {
      expect<symbol>(TOURNAMENT_PLATFORM_TYPES[name]).toBe(
        Symbol.for(`tournament.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(TOURNAMENT_PLATFORM_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(TOURNAMENT_PLATFORM_TYPES)).toBe(true);
  });
});
