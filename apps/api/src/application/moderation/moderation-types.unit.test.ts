import { describe, expect, test } from 'bun:test';

import { MODERATION_PLATFORM_TYPES } from '../../../lib/core/moderation/identifiers.ts';
import { MODERATION_TYPES } from './moderation-types.ts';

const EXPECTED_NAMES = [
  'UserModerationService',
  'AdministrativeWithdrawalService',
  'ProductModerationService',
  'CommentModerationService',
  'RatingModerationService',
  'ImageModerationService',
  'ModerationNotifier',
  'AdminUserReader',
  'AdminProductReader',
  'AdminCommentReader',
  'AdminRatingReader',
  'QuarantinedImageReader',
  'ModerationMaintenanceJob',
  'ImageModerationWriter',
  'EngagementModerationWriter',
  'ModerationIncidentReporter',
  'ModerationStatements',
  'PendingModerationRecord',
  'UserModerationRecordSyncHandler',
  'ProductModerationRecordSyncHandler',
  'ModerationWriteParticipants',
] as const;

describe('MODERATION_TYPES', () => {
  test('apiの措置のユースケース・照会・通知・保守のジョブ・書き込みの単位・定型の通知・文の組み立て・保留中の措置・同期の処理・参加者の解決の識別子だけを持つ', () => {
    expect(Object.keys(MODERATION_TYPES).toSorted()).toStrictEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のmoderation.api.<名前>である',
    (name) => {
      expect<symbol>(MODERATION_TYPES[name]).toBe(
        Symbol.for(`moderation.api.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なり、両アプリ共通の措置の記録の識別子と重ならない', () => {
    const platform = new Set<symbol>(
      Object.values<symbol>(MODERATION_PLATFORM_TYPES),
    );

    expect(new Set(Object.values(MODERATION_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
    expect(
      Object.values<symbol>(MODERATION_TYPES).filter((identifier) =>
        platform.has(identifier),
      ),
    ).toStrictEqual([]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(MODERATION_TYPES)).toBe(true);
  });
});
