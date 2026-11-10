import { describe, expect, test } from 'bun:test';

import { DIRECTORY_PLATFORM_TYPES } from '../../../lib/core/directory/identifiers.ts';
import { EVENT_DIRECTORY_TYPES } from './event-directory-types.ts';

describe('EVENT_DIRECTORY_TYPES', () => {
  test('掲載の記録・索引の作り直し・記録の物理削除の処理と、更新待ちの書き込みの単位の識別子を持つ', () => {
    expect(Object.keys(EVENT_DIRECTORY_TYPES).toSorted()).toStrictEqual([
      'AccountIndexRestoreHandler',
      'EntryErasureHandler',
      'ProductIndexPendingMarker',
      'ProductIndexRestoreHandler',
      'QualifierListingHandler',
    ]);
  });

  test('識別子はグローバルのシンボル登録簿のdirectory.event.<名前>である', () => {
    for (const [name, identifier] of Object.entries(EVENT_DIRECTORY_TYPES)) {
      expect<symbol>(identifier).toBe(Symbol.for(`directory.event.${name}`));
    }
  });

  test('両アプリ共通の識別子と重ならない', () => {
    const shared = new Set<symbol>(Object.values(DIRECTORY_PLATFORM_TYPES));

    expect(
      Object.values(EVENT_DIRECTORY_TYPES).filter((identifier) =>
        shared.has(identifier),
      ),
    ).toEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_DIRECTORY_TYPES)).toBe(true);
  });
});
