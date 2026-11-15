import { describe, expect, test } from 'bun:test';

import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import { ENGAGEMENT_TYPES } from './engagement-types.ts';

const EXPECTED_NAMES = [
  'EngagementTargetResolver',
  'CommentService',
  'CommentReader',
  'RatingService',
  'CommentWriter',
  'RatingWriter',
  'CommentModerationControl',
  'RatingModerationControl',
  'CommentCountMetricSource',
  'EngagementWithdrawalSyncHandler',
  'CommentAnonymizationJob',
] as const;

describe('ENGAGEMENT_TYPES', () => {
  test('apiの投稿先の解決・ユースケース・書き込みの単位・読み取り・管理の操作口・供給元・同期の処理・ジョブの識別子だけを持つ', () => {
    expect(Object.keys(ENGAGEMENT_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のengagement.<名前>である',
    (name) => {
      expect<symbol>(ENGAGEMENT_TYPES[name]).toBe(
        Symbol.for(`engagement.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(ENGAGEMENT_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('backend-libの共有の識別子と重ならない', () => {
    const shared = new Set<symbol>(Object.values(ENGAGEMENT_PLATFORM_TYPES));

    for (const identifier of Object.values(ENGAGEMENT_TYPES)) {
      expect(shared.has(identifier)).toBe(false);
    }
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(ENGAGEMENT_TYPES)).toBe(true);
  });
});
