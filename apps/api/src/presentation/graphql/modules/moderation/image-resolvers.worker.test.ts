import { describe, expect, test } from 'vitest';

import { downloadPathOf } from '../../../../../common-lib/media/upload-protocol.ts';
import type { QuarantineReason } from '../../../../../lib/core/media/media-file.ts';
import { RELOCATE_FILES_MESSAGE } from '../../../../../lib/core/media/media-messages.ts';
import { insertUser } from '../../../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  after,
  FINDINGS,
  fileIdOf,
  IMAGE_PURPOSE,
  insertFile,
  insertReason,
  readFile,
  readReasons,
  USER_A,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import { filePurposeRow } from '../../../../../lib/workers/media/testing/media-operations-fixtures.ts';
import { readModerationRows } from '../../../../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import { adminIdOf } from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';
import {
  type AdminQuarantinedImageFields,
  asModerator,
  asViewer,
  codesOf,
  detailsOf,
  fetchQuarantinedImages,
  failPublishing,
  type ImageModeration,
  installModerationContentGraphQLTest,
  MODERATION_ADMINS,
  moderateImage,
  readPublishedTypes,
} from '../../../../../test/support/moderation-content-graphql-operations.ts';

installModerationContentGraphQLTest();

const USER_FILE = 1;
const ADMIN_FILE = 2;
const SYSTEM_FILE = 3;
const DOCUMENT_FILE = 4;
const PENDING_ERASE_FILE = 5;
const MISSING_FILE_ID = fileIdOf(99);

const REASON = '規約に反する画像のため';

// 1: 利用者の画像(自動判定・検出内容あり) / 2: 管理者の画像(自動判定) / 3: システムの画像(管理者操作) / 4: 画像用でない用途のファイル
async function seedImages(): Promise<void> {
  await insertUser(1);
  await insertFile(USER_FILE, { moderationDetail: FINDINGS });
  await insertReason(USER_FILE, 'auto', after(1_000));
  await insertFile(ADMIN_FILE, {
    ownerKind: 'admin',
    ownerId: adminIdOf(MODERATION_ADMINS.superAdmin),
  });
  await insertReason(ADMIN_FILE, 'auto', after(2_000));
  await insertFile(SYSTEM_FILE, { ownerKind: 'system', ownerId: null });
  await insertReason(SYSTEM_FILE, 'admin_action', after(3_000));
  await insertFile(DOCUMENT_FILE, filePurposeRow());
}

const mediaFileOf = (index: number, reasons: readonly string[]) => ({
  id: fileIdOf(index),
  path: downloadPathOf(fileIdOf(index)),
  quarantined: reasons.length > 0,
  quarantineReasons: reasons,
});

const IMAGES: Readonly<Record<string, AdminQuarantinedImageFields>> =
  Object.freeze({
    user: {
      file: mediaFileOf(USER_FILE, ['AUTO']),
      purpose: IMAGE_PURPOSE,
      owner: { kind: 'user', id: USER_A, nickname: '利用者1', handle: 'user1' },
      quarantinedAt: after(1_000).toISOString(),
      findings: [
        'Violence: Graphic Violence(信頼度97%)',
        'SVG: disallowed_element(script)',
      ],
    },
    admin: {
      file: mediaFileOf(ADMIN_FILE, ['AUTO']),
      purpose: IMAGE_PURPOSE,
      owner: {
        kind: 'admin',
        id: adminIdOf(MODERATION_ADMINS.superAdmin),
        nickname: '管理者1',
        handle: null,
      },
      quarantinedAt: after(2_000).toISOString(),
      findings: [],
    },
    system: {
      file: mediaFileOf(SYSTEM_FILE, ['ADMIN_ACTION']),
      purpose: IMAGE_PURPOSE,
      owner: null,
      quarantinedAt: after(3_000).toISOString(),
      findings: [],
    },
  });

async function reasonsOf(index: number): Promise<QuarantineReason[]> {
  return (await readReasons())
    .filter(({ fileId }) => fileId === fileIdOf(index))
    .map(({ reason }) => reason);
}

describe('adminQuarantinedImages', () => {
  test('利用者側の呼び出し元からはforbiddenで拒否する', async () => {
    const response = await fetchQuarantinedImages({ reason: 'AUTO' });

    expect(codesOf(response)).toEqual(['forbidden']);
  });

  test('管理者のセッションが無ければunauthenticatedで拒否する', async () => {
    const response = await fetchQuarantinedImages(
      { reason: 'AUTO' },
      { caller: 'admin' },
    );

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test('閲覧のみの管理者に、隔離理由の画像を隔離の新しい順に同一オリジンの経路・用途・保有者・検出内容とともに返す', async () => {
    await seedImages();

    const response = await fetchQuarantinedImages(
      { reason: 'AUTO' },
      asViewer(),
    );

    expect(response.data?.adminQuarantinedImages).toEqual({
      items: [IMAGES.admin, IMAGES.user],
      nextCursor: null,
    });
  });

  test('システムが保有する画像の保有者はnullにする', async () => {
    await seedImages();

    const response = await fetchQuarantinedImages(
      { reason: 'ADMIN_ACTION' },
      asViewer(),
    );

    expect(response.data?.adminQuarantinedImages?.items).toEqual([
      IMAGES.system,
    ]);
  });

  test('不正な続きの位置は上流のinvalid_cursorと文言のまま返す', async () => {
    const response = await fetchQuarantinedImages(
      { reason: 'AUTO', after: 'not-a-cursor' },
      asViewer(),
    );

    expect(codesOf(response)).toEqual(['invalid_cursor']);
    expect(response.errors?.[0]?.message).toBe(
      'ページの位置の指定が正しくありません。',
    );
  });
});

describe('画像の措置の認可', () => {
  test.each([
    'approveQuarantinedImage',
    'quarantineImage',
    'releaseQuarantinedImage',
    'deleteQuarantinedImage',
  ] as const)(
    '閲覧のみの管理者の%sはforbiddenで拒否し、状態を変えない',
    async (operation) => {
      await seedImages();

      const response = await moderateImage(
        operation,
        { fileId: fileIdOf(USER_FILE) },
        asViewer(),
      );

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(await reasonsOf(USER_FILE)).toEqual(['auto']);
      expect(await readModerationRows()).toEqual([]);
    },
  );

  test('利用者側の呼び出し元からは入力の検証より前にforbiddenで拒否する', async () => {
    const response = await moderateImage('quarantineImage', {
      fileId: 'not-a-ulid',
    });

    expect(codesOf(response)).toEqual(['forbidden']);
  });
});

describe('画像の措置の結果', () => {
  test('公開承認は自動判定の理由を外し、繰り返しは前提を満たさずimage_action_not_applicableで拒否する', async () => {
    await seedImages();

    const first = await moderateImage(
      'approveQuarantinedImage',
      { fileId: fileIdOf(USER_FILE) },
      asModerator(),
    );
    const second = await moderateImage(
      'approveQuarantinedImage',
      { fileId: fileIdOf(USER_FILE) },
      asModerator(),
    );

    expect(first.data?.approveQuarantinedImage).toEqual({ changed: true });
    expect(await reasonsOf(USER_FILE)).toEqual([]);
    expect(codesOf(second)).toEqual(['image_action_not_applicable']);
  });

  test('個別の隔離は理由が無くても管理者操作の理由を加え、移動を依頼し、繰り返しは変化なしを返す', async () => {
    await seedImages();

    const first = await moderateImage(
      'quarantineImage',
      { fileId: fileIdOf(USER_FILE), reason: null },
      asModerator(),
    );
    const second = await moderateImage(
      'quarantineImage',
      { fileId: fileIdOf(USER_FILE), reason: REASON },
      asModerator(),
    );

    expect(first.data?.quarantineImage).toEqual({ changed: true });
    expect(second.data?.quarantineImage).toEqual({ changed: false });
    expect((await reasonsOf(USER_FILE)).toSorted()).toEqual([
      'admin_action',
      'auto',
    ]);
    expect(readPublishedTypes()).toContain(RELOCATE_FILES_MESSAGE.type);
    expect(
      (await readModerationRows()).map(({ action, reason }) => ({
        action,
        reason,
      })),
    ).toEqual([{ action: 'image.quarantine', reason: null }]);
  });

  test('隔離の解除は管理者操作の理由を外す', async () => {
    await seedImages();

    const response = await moderateImage(
      'releaseQuarantinedImage',
      { fileId: fileIdOf(SYSTEM_FILE), reason: REASON },
      asModerator(),
    );

    expect(response.data?.releaseQuarantinedImage).toEqual({ changed: true });
    expect(await reasonsOf(SYSTEM_FILE)).toEqual([]);
  });

  test('管理者操作の理由が無い画像の隔離の解除はimage_action_not_applicableで拒否する', async () => {
    await seedImages();

    const response = await moderateImage(
      'releaseQuarantinedImage',
      { fileId: fileIdOf(USER_FILE) },
      asModerator(),
    );

    expect(codesOf(response)).toEqual(['image_action_not_applicable']);
  });

  test('削除は隔離画像を一覧から除いて即時に物理削除し、記録の無くなった画像の繰り返しはimage_not_foundで拒否する', async () => {
    await seedImages();

    const first = await moderateImage(
      'deleteQuarantinedImage',
      { fileId: fileIdOf(ADMIN_FILE), reason: REASON },
      asModerator(),
    );
    const second = await moderateImage(
      'deleteQuarantinedImage',
      { fileId: fileIdOf(ADMIN_FILE), reason: REASON },
      asModerator(),
    );
    const listed = await fetchQuarantinedImages({ reason: 'AUTO' }, asViewer());

    expect(first.data?.deleteQuarantinedImage).toEqual({ changed: true });
    expect(await readFile(ADMIN_FILE)).toBeUndefined();
    expect(codesOf(second)).toEqual(['image_not_found']);
    expect(listed.data?.adminQuarantinedImages?.items).toEqual([IMAGES.user]);
  });

  test('既に削除待ちの画像の削除は変化なしを返す', async () => {
    await seedImages();
    await insertFile(PENDING_ERASE_FILE, { eraseRequestedAt: after(4_000) });
    await insertReason(PENDING_ERASE_FILE, 'auto', after(4_000));

    const response = await moderateImage(
      'deleteQuarantinedImage',
      { fileId: fileIdOf(PENDING_ERASE_FILE) },
      asModerator(),
    );

    expect(response.data?.deleteQuarantinedImage).toEqual({ changed: false });
    expect(await readModerationRows()).toEqual([]);
  });

  test.each<readonly [string, string]>([
    ['存在しない', MISSING_FILE_ID],
    ['画像用でない用途の', fileIdOf(DOCUMENT_FILE)],
  ])(
    '%sファイルの個別の隔離はimage_not_foundで拒否する',
    async (_label, fileId) => {
      await seedImages();

      const response = await moderateImage(
        'quarantineImage',
        { fileId },
        asModerator(),
      );

      expect(codesOf(response)).toEqual(['image_not_found']);
      expect(response.errors?.[0]?.message).toBe('画像が見つかりません。');
    },
  );

  test.each<ImageModeration>([
    'approveQuarantinedImage',
    'releaseQuarantinedImage',
    'deleteQuarantinedImage',
  ])('存在しない画像の%sはimage_not_foundで拒否する', async (operation) => {
    const response = await moderateImage(
      operation,
      { fileId: MISSING_FILE_ID },
      asModerator(),
    );

    expect(codesOf(response)).toEqual(['image_not_found']);
  });

  test('形式の違うIDは存在しない画像と同じ文言のvalidation_errorで拒否する', async () => {
    const response = await moderateImage(
      'quarantineImage',
      { fileId: 'not-a-ulid' },
      asModerator(),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'fileId',
        code: 'invalid_format',
        message: '画像が見つかりません。',
      },
    ]);
  });

  test('理由が500文字を超えればvalidation_errorで拒否する', async () => {
    await seedImages();

    const response = await moderateImage(
      'approveQuarantinedImage',
      { fileId: fileIdOf(USER_FILE), reason: 'あ'.repeat(501) },
      asModerator(),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response).map(({ field }) => field)).toEqual(['reason']);
    expect(await reasonsOf(USER_FILE)).toEqual(['auto']);
  });

  test('確定の後の移動の依頼に失敗したらstorage_unavailableを返し、理由と記録は確定したまま残す', async () => {
    await seedImages();
    failPublishing(RELOCATE_FILES_MESSAGE.type);

    const response = await moderateImage(
      'quarantineImage',
      { fileId: fileIdOf(USER_FILE), reason: REASON },
      asModerator(),
    );

    expect(codesOf(response)).toEqual(['storage_unavailable']);
    expect((await reasonsOf(USER_FILE)).toSorted()).toEqual([
      'admin_action',
      'auto',
    ]);
    expect((await readModerationRows()).map(({ action }) => action)).toEqual([
      'image.quarantine',
    ]);
    expect((await readFile(USER_FILE))?.eraseRequestedAt).toBeNull();
  });
});
