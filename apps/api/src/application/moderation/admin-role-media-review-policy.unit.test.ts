import { describe, expect, test } from 'bun:test';

import type {
  AdminDirectory,
  AdminProfileView,
} from '../../../lib/core/admin/ports.ts';
import type { MediaFileView } from '../../../lib/core/media/media-file.ts';
import type { AuthenticatedPrincipal } from '../../../lib/core/session/session-view.ts';
import {
  imageFileViewOf,
  mediaFileViewOf,
} from '../../../test/support/media-file-view.ts';
import { AdminRoleMediaReviewPolicy } from './admin-role-media-review-policy.ts';

const ADMIN_ID = '01JQ0ADM000000000000000001';
const DELETED_ADMIN_ID = '01JQ0ADM000000000000000002';
const USER_ID = '01JQ0USR000000000000000001';

const ADMIN: AuthenticatedPrincipal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'admin',
  subjectId: ADMIN_ID,
  sessionId: '01JQ0SES000000000000000001',
});

const DELETED_ADMIN: AuthenticatedPrincipal = Object.freeze({
  ...ADMIN,
  subjectId: DELETED_ADMIN_ID,
});

const USER: AuthenticatedPrincipal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'user',
  subjectId: USER_ID,
  sessionId: '01JQ0SES000000000000000002',
});

const ACTIVE_PROFILE: AdminProfileView = Object.freeze({
  id: ADMIN_ID,
  nickname: 'モデレーター',
  title: null,
  avatarFileId: null,
});

interface RecordingDirectory {
  readonly directory: AdminDirectory;
  readonly calls: (readonly string[])[];
}

// 有効な管理者だけを返す照会口の振る舞いを、ADMIN_IDだけが有効な名簿で再現する
function recordingDirectory(
  findProfiles: AdminDirectory['findProfiles'] = (ids) =>
    Promise.resolve(
      new Map(
        ids
          .filter((id) => id === ADMIN_ID)
          .map((id) => [id, ACTIVE_PROFILE] as const),
      ),
    ),
): RecordingDirectory {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    directory: {
      findProfiles: (ids) => {
        calls.push(ids);
        return findProfiles(ids);
      },
    },
  };
}

describe('AdminRoleMediaReviewPolicy', () => {
  test.each<[string, MediaFileView]>([
    ['隔離バケットの画像', imageFileViewOf()],
    [
      '画像用非公開バケットの公開中の画像',
      imageFileViewOf({
        location: 'images',
        moderationStatus: 'passed',
        quarantineReasons: [],
        quarantined: false,
      }),
    ],
    [
      '他の管理者がアップロードした画像',
      imageFileViewOf({
        purpose: 'admin-avatar',
        owner: { kind: 'admin', id: DELETED_ADMIN_ID },
      }),
    ],
  ])(
    '有効な管理者の主体なら、%sの確認を許し、管理者の名簿をその主体の識別子で1回照会する',
    async (_label, file) => {
      const { directory, calls } = recordingDirectory();
      const policy = new AdminRoleMediaReviewPolicy(directory);

      const allowed = await policy.canReview({ principal: ADMIN, file });

      expect(allowed).toBe(true);
      expect(calls).toStrictEqual([[ADMIN_ID]]);
    },
  );

  test('削除済み・招待中など名簿に無い管理者の主体には、画像の確認を許さない', async () => {
    const { directory, calls } = recordingDirectory();
    const policy = new AdminRoleMediaReviewPolicy(directory);

    const allowed = await policy.canReview({
      principal: DELETED_ADMIN,
      file: imageFileViewOf(),
    });

    expect(allowed).toBe(false);
    expect(calls).toStrictEqual([[DELETED_ADMIN_ID]]);
  });

  test('利用者の主体には、その利用者がアップロードした画像でも名簿を照会せずに許さない', async () => {
    const { directory, calls } = recordingDirectory();
    const policy = new AdminRoleMediaReviewPolicy(directory);

    const allowed = await policy.canReview({
      principal: USER,
      file: imageFileViewOf({ owner: { kind: 'user', id: USER_ID } }),
    });

    expect(allowed).toBe(false);
    expect(calls).toStrictEqual([]);
  });

  test('ファイル用の用途のファイルは、有効な管理者にも名簿を照会せずに許さない', async () => {
    const { directory, calls } = recordingDirectory();
    const policy = new AdminRoleMediaReviewPolicy(directory);

    const allowed = await policy.canReview({
      principal: ADMIN,
      file: mediaFileViewOf({ owner: { kind: 'admin', id: ADMIN_ID } }),
    });

    expect(allowed).toBe(false);
    expect(calls).toStrictEqual([]);
  });

  test('管理者の名簿の照会が失敗すれば、許可も拒否もせずに失敗を伝える', async () => {
    const failure = new Error('差し込んだ名簿の照会の失敗');
    const { directory } = recordingDirectory(() => Promise.reject(failure));
    const policy = new AdminRoleMediaReviewPolicy(directory);

    const rejection = await policy
      .canReview({ principal: ADMIN, file: imageFileViewOf() })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(rejection).toBe(failure);
  });
});
