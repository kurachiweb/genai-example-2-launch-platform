import { describe, expect, test } from 'bun:test';

import { ENGAGEMENT_PLATFORM_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'CommentStore',
  'CommentStatements',
  'CommentThreadQuery',
  'RatingStore',
  'RatingStatements',
  'EngagementErasureStore',
  'CommentExport',
  'RatingExport',
  'AdminCommentDirectory',
  'AdminRatingDirectory',
] as const;

describe('ENGAGEMENT_PLATFORM_TYPES', () => {
  test('両アプリと後続specが共有する10種の識別子だけを持つ', () => {
    expect(Object.keys(ENGAGEMENT_PLATFORM_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のengagement.<名前>である',
    (name) => {
      expect<symbol>(ENGAGEMENT_PLATFORM_TYPES[name]).toBe(
        Symbol.for(`engagement.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(ENGAGEMENT_PLATFORM_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(ENGAGEMENT_PLATFORM_TYPES)).toBe(true);
  });
});
