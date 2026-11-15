import { describe, expect, test } from 'bun:test';

import { DIRECTORY_PLATFORM_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'DirectoryListingQuery',
  'DirectoryEntryStore',
] as const;

describe('DIRECTORY_PLATFORM_TYPES', () => {
  test('両アプリと公開APIが共有する2種の識別子だけを持つ', () => {
    expect(Object.keys(DIRECTORY_PLATFORM_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のdirectory.<名前>である',
    (name) => {
      expect<symbol>(DIRECTORY_PLATFORM_TYPES[name]).toBe(
        Symbol.for(`directory.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(DIRECTORY_PLATFORM_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(DIRECTORY_PLATFORM_TYPES)).toBe(true);
  });
});
