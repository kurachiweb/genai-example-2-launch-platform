import { describe, expect, test } from 'bun:test';

import { DIRECTORY_PLATFORM_TYPES } from '../../../lib/core/directory/identifiers.ts';
import { DIRECTORY_TYPES } from './directory-types.ts';

const EXPECTED_NAMES = [
  'LaunchHighlightsReader',
  'ItemMetricSources',
  'ItemMetricsReader',
  'DirectoryReader',
  'DirectoryCategoryReader',
  'ProductPageReader',
  'LiveMatchReader',
  'SupporterListReader',
  'AccountIndexRemovalSyncHandler',
  'ProductIndexRemovalSyncHandler',
] as const;

describe('DIRECTORY_TYPES', () => {
  test('apiのディレクトリのユースケース・供給元の一覧・同期の処理の識別子だけを持つ', () => {
    expect(Object.keys(DIRECTORY_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のdirectory.<名前>である',
    (name) => {
      expect<symbol>(DIRECTORY_TYPES[name]).toBe(
        Symbol.for(`directory.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(DIRECTORY_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('backend-libの共有の識別子と重ならない', () => {
    const shared = new Set<symbol>(Object.values(DIRECTORY_PLATFORM_TYPES));

    for (const identifier of Object.values(DIRECTORY_TYPES)) {
      expect(shared.has(identifier)).toBe(false);
    }
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(DIRECTORY_TYPES)).toBe(true);
  });
});
