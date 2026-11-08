import { describe, expect, test } from 'bun:test';

import { PROFILE_PLATFORM_TYPES } from '../../../lib/core/profile/identifiers.ts';
import { PROFILE_TYPES } from './profile-types.ts';

const EXPECTED_NAMES = [
  'ProfileStore',
  'ProfileEditor',
  'MyProfileReader',
  'HandleAvailabilityChecker',
] as const;

describe('PROFILE_TYPES', () => {
  test('プロフィールのストア・ユースケースの識別子だけを持つ', () => {
    expect(Object.keys(PROFILE_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のprofile.<名前>である',
    (name) => {
      expect<symbol>(PROFILE_TYPES[name]).toBe(Symbol.for(`profile.${name}`));
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(PROFILE_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('backend-libの共有の識別子と重ならない', () => {
    const shared = new Set<symbol>(Object.values(PROFILE_PLATFORM_TYPES));

    for (const identifier of Object.values(PROFILE_TYPES)) {
      expect(shared.has(identifier)).toBe(false);
    }
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(PROFILE_TYPES)).toBe(true);
  });
});
