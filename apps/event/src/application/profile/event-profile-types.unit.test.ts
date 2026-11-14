import { describe, expect, test } from 'bun:test';

import { EVENT_PROFILE_TYPES } from './event-profile-types.ts';

describe('EVENT_PROFILE_TYPES', () => {
  test('識別子はグローバルのシンボル登録簿のprofile.event.<名前>である', () => {
    expect(Object.keys(EVENT_PROFILE_TYPES)).toEqual([
      'ProfilePurgeStore',
      'ProfileErasureHandler',
      'OwnedFileErasureHandler',
      'OwnedImageQuarantineHandler',
    ]);
    for (const [name, identifier] of Object.entries(EVENT_PROFILE_TYPES)) {
      expect<symbol>(identifier).toBe(Symbol.for(`profile.event.${name}`));
    }
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_PROFILE_TYPES)).toBe(true);
  });
});
