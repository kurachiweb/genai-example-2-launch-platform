import { describe, expect, test } from 'bun:test';

import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import { MATCH_TYPES } from './match-types.ts';

const EXPECTED_NAMES = [
  'UpvoteStore',
  'UpvoteService',
  'AccountMatchClosureSyncHandler',
  'ProductMatchClosureSyncHandler',
  'SettlementStore',
  'MatchSettlement',
] as const;

describe('MATCH_TYPES', () => {
  test('apiのマッチのストア・ユースケースの識別子だけを持つ', () => {
    expect(Object.keys(MATCH_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のmatch.<名前>である',
    (name) => {
      expect<symbol>(MATCH_TYPES[name]).toBe(Symbol.for(`match.${name}`));
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(MATCH_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('backend-libの共有の識別子と重ならない', () => {
    const shared = new Set<symbol>(Object.values(MATCH_PLATFORM_TYPES));

    for (const identifier of Object.values(MATCH_TYPES)) {
      expect(shared.has(identifier)).toBe(false);
    }
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(MATCH_TYPES)).toBe(true);
  });
});
