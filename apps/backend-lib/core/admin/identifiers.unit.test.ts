import { describe, expect, test } from 'bun:test';

import { ADMIN_PLATFORM_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = ['AdminDirectory'] as const;

describe('ADMIN_PLATFORM_TYPES', () => {
  test('両アプリと後続specが共有する管理者の照会口の識別子だけを持つ', () => {
    expect(Object.keys(ADMIN_PLATFORM_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のadmin.<名前>である',
    (name) => {
      expect<symbol>(ADMIN_PLATFORM_TYPES[name]).toBe(
        Symbol.for(`admin.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(ADMIN_PLATFORM_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(ADMIN_PLATFORM_TYPES)).toBe(true);
  });
});
