import { describe, expect, test } from 'bun:test';

import { PUBLIC_API_PLATFORM_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = ['ApiKeyExport'] as const;

describe('PUBLIC_API_PLATFORM_TYPES', () => {
  test('apiとeventと後続specが共有する識別子だけを持つ', () => {
    expect(Object.keys(PUBLIC_API_PLATFORM_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のpublic-api.<名前>である',
    (name) => {
      expect<symbol>(PUBLIC_API_PLATFORM_TYPES[name]).toBe(
        Symbol.for(`public-api.${name}`),
      );
    },
  );

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(PUBLIC_API_PLATFORM_TYPES)).toBe(true);
  });
});
