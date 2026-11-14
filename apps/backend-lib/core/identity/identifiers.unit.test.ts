import { describe, expect, test } from 'bun:test';

import { IDENTITY_PLATFORM_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'UserContactDirectory',
  'AccountExport',
  'AdminUserDirectory',
  'AccountGuard',
] as const;

describe('IDENTITY_PLATFORM_TYPES', () => {
  test('両アプリと後続specが共有する識別子だけを持つ', () => {
    expect(Object.keys(IDENTITY_PLATFORM_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のidentity.<名前>である',
    (name) => {
      expect<symbol>(IDENTITY_PLATFORM_TYPES[name]).toBe(
        Symbol.for(`identity.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(IDENTITY_PLATFORM_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(IDENTITY_PLATFORM_TYPES)).toBe(true);
  });
});
