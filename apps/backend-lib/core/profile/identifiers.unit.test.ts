import { describe, expect, test } from 'bun:test';

import { PROFILE_PLATFORM_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'UserProfileDirectory',
  'ProfileExport',
  'FollowExport',
  'FollowerDirectory',
] as const;

describe('PROFILE_PLATFORM_TYPES', () => {
  test('apiとeventと後続specが共有する4つの照会口の識別子だけを持つ', () => {
    expect(Object.keys(PROFILE_PLATFORM_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のprofile.<名前>である',
    (name) => {
      expect<symbol>(PROFILE_PLATFORM_TYPES[name]).toBe(
        Symbol.for(`profile.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(PROFILE_PLATFORM_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(PROFILE_PLATFORM_TYPES)).toBe(true);
  });
});
