import { describe, expect, test } from 'bun:test';

import { MODERATION_PLATFORM_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'ModerationRecordStore',
  'ModerationRecordStatements',
] as const;

describe('MODERATION_PLATFORM_TYPES', () => {
  test('両アプリが共有する措置の記録の2種の識別子だけを持つ', () => {
    expect(Object.keys(MODERATION_PLATFORM_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のmoderation.<名前>である',
    (name) => {
      expect<symbol>(MODERATION_PLATFORM_TYPES[name]).toBe(
        Symbol.for(`moderation.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(MODERATION_PLATFORM_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(MODERATION_PLATFORM_TYPES)).toBe(true);
  });
});
