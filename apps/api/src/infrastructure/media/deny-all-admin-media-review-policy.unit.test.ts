import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import type { MediaFileView } from '../../../lib/core/media/media-file.ts';
import type { AuthenticatedPrincipal } from '../../../lib/core/session/session-view.ts';
import { imageFileViewOf } from '../../../test/support/media-file-view.ts';
import {
  type AdminMediaReviewPolicy,
  FILE_ACCESS_TYPES,
} from '../../application/media/file-access-policies.ts';
import { DenyAllAdminMediaReviewPolicy } from './deny-all-admin-media-review-policy.ts';

const ADMIN_ID = '01JC0ADMIN0000000000000001';

const ADMIN: AuthenticatedPrincipal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'admin',
  subjectId: ADMIN_ID,
  sessionId: '01JC0SESSION0000000000001',
});

describe('DenyAllAdminMediaReviewPolicy', () => {
  test.each<[string, MediaFileView]>([
    ['隔離バケットの画像', imageFileViewOf()],
    [
      '画像用非公開バケットの画像',
      imageFileViewOf({
        location: 'images',
        moderationStatus: 'passed',
        quarantineReasons: [],
        quarantined: false,
      }),
    ],
    [
      'その管理者がアップロードした画像',
      imageFileViewOf({ owner: { kind: 'admin', id: ADMIN_ID } }),
    ],
  ])('%sでも、管理者の画像確認を常に拒否する', async (_label, file) => {
    const policy: AdminMediaReviewPolicy = new DenyAllAdminMediaReviewPolicy();

    const allowed = await policy.canReview({ principal: ADMIN, file });

    expect(allowed).toBe(false);
  });

  test('管理者の画像確認の識別子に束縛すると、コンテナから解決した実装も拒否する', async () => {
    const container = new Container();
    container
      .bind<AdminMediaReviewPolicy>(FILE_ACCESS_TYPES.AdminMediaReviewPolicy)
      .to(DenyAllAdminMediaReviewPolicy);

    const allowed = await container
      .get<AdminMediaReviewPolicy>(FILE_ACCESS_TYPES.AdminMediaReviewPolicy)
      .canReview({ principal: ADMIN, file: imageFileViewOf() });

    expect(allowed).toBe(false);
  });
});
