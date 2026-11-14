import { describe, expect, expectTypeOf, test } from 'bun:test';

import { mediaFileQuarantineReasons } from '../../../db/schema/media/media-file-quarantine-reasons.ts';
import { mediaFiles } from '../../../db/schema/media/media-files.ts';
import {
  type MediaLocation,
  type MediaOwner,
  type ModerationStatus,
  QUARANTINE_REASONS,
  type QuarantineReason,
} from '../../core/media/media-file.ts';
import type { MediaStorage } from '../../core/media/upload-purpose.ts';

// coreはDBディレクトリを読み込めないため、テーブル定義に直書きした値の一覧とcoreの型の一致をここで確かめる
describe('メディアのテーブル定義の値の一覧', () => {
  test('保存先の列の値がcoreの保存先の型と過不足無く同じになる', () => {
    expectTypeOf<
      (typeof mediaFiles.storage.enumValues)[number]
    >().toEqualTypeOf<MediaStorage>();
    expect([...mediaFiles.storage.enumValues].toSorted()).toEqual([
      'files',
      'images',
    ]);
  });

  test('保存先の現在値の列の値がcoreのバケットの型と過不足無く同じになる', () => {
    expectTypeOf<
      (typeof mediaFiles.location.enumValues)[number]
    >().toEqualTypeOf<MediaLocation>();
    expect([...mediaFiles.location.enumValues].toSorted()).toEqual([
      'files',
      'images',
      'quarantine',
    ]);
  });

  test('保有者の種類の列の値がcoreの保有者の種類と過不足無く同じになる', () => {
    expectTypeOf<
      (typeof mediaFiles.ownerKind.enumValues)[number]
    >().toEqualTypeOf<MediaOwner['kind']>();
    expect([...mediaFiles.ownerKind.enumValues].toSorted()).toEqual([
      'admin',
      'system',
      'user',
    ]);
  });

  test('判定の状態の列の値がcoreの判定の状態の型と過不足無く同じになる', () => {
    expectTypeOf<
      (typeof mediaFiles.moderationStatus.enumValues)[number]
    >().toEqualTypeOf<ModerationStatus>();
    expect([...mediaFiles.moderationStatus.enumValues].toSorted()).toEqual([
      'flagged',
      'not_required',
      'passed',
      'pending',
      'undetermined',
    ]);
  });

  test('隔離理由の列の値がcoreの隔離理由の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof mediaFileQuarantineReasons.reason.enumValues)[number]
    >().toEqualTypeOf<QuarantineReason>();
    expect([...mediaFileQuarantineReasons.reason.enumValues]).toEqual([
      ...QUARANTINE_REASONS,
    ]);
  });
});
