import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import type { MediaFileView } from '../../../lib/core/media/media-file.ts';
import {
  imageFileViewOf,
  mediaFileViewOf,
} from '../../../test/support/media-file-view.ts';
import {
  type FileAccessAuthorizer,
  PolicyFileAccessAuthorizer,
} from '../../application/media/file-access-authorizer.ts';
import {
  type AdminMediaReviewPolicy,
  FILE_ACCESS_TYPES,
  type FileReadPolicy,
  type FileReadPolicyRegistration,
} from '../../application/media/file-access-policies.ts';
import type { AuthenticatedPrincipal } from '../../application/session/session-verifier.ts';
import { DenyAllAdminMediaReviewPolicy } from './deny-all-admin-media-review-policy.ts';
import { OwnerOnlyFileReadPolicy } from './owner-only-file-read-policy.ts';

const USER: AuthenticatedPrincipal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'user',
  subjectId: '01JC0USER00000000000000001',
  sessionId: '01JC0SESSION0000000000001',
});

const ADMIN: AuthenticatedPrincipal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'admin',
  subjectId: '01JC0ADMIN0000000000000001',
  sessionId: '01JC0SESSION0000000000002',
});

const INQUIRY_POLICY: unique symbol = Symbol('InquiryAttachmentReadPolicy');

const allowAll: FileReadPolicy = Object.freeze({
  canRead: () => Promise.resolve(true),
});

function createDefaultAuthorizer(
  registrations: readonly FileReadPolicyRegistration[] = [],
): FileAccessAuthorizer {
  const container = new Container();
  container
    .bind<FileReadPolicy>(FILE_ACCESS_TYPES.DefaultFileReadPolicy)
    .to(OwnerOnlyFileReadPolicy);
  container
    .bind<AdminMediaReviewPolicy>(FILE_ACCESS_TYPES.AdminMediaReviewPolicy)
    .to(DenyAllAdminMediaReviewPolicy);
  container.bind<FileReadPolicy>(INQUIRY_POLICY).toConstantValue(allowAll);
  return new PolicyFileAccessAuthorizer({
    registrations,
    resolveReadPolicy: (identifier) => container.get(identifier),
    defaultReadPolicy: container.get(FILE_ACCESS_TYPES.DefaultFileReadPolicy),
    adminReviewPolicy: container.get(FILE_ACCESS_TYPES.AdminMediaReviewPolicy),
  });
}

describe('既定の2つの方針を束縛した閲覧の判定', () => {
  test.each<[string, MediaFileView, boolean]>([
    [
      'アップロードした主体のファイルは通す',
      mediaFileViewOf({
        owner: { kind: 'user', id: USER.subjectId },
        purpose: 'unregistered-attachment',
      }),
      true,
    ],
    [
      '他の利用者のファイルは通さない',
      mediaFileViewOf({
        owner: { kind: 'user', id: '01JC0USER00000000000000002' },
        purpose: 'unregistered-attachment',
      }),
      false,
    ],
  ])('方針の無い用途では、%s', async (_label, file, expected) => {
    const authorizer = createDefaultAuthorizer();

    const allowed = await authorizer.canAccess({
      caller: 'client',
      principal: USER,
      file,
    });

    expect(allowed).toBe(expected);
  });

  test('用途に登録された方針の識別子をコンテナから解決し、保有者以外にも許可できる', async () => {
    const authorizer = createDefaultAuthorizer([
      { purpose: 'inquiry-attachment', policy: INQUIRY_POLICY },
    ]);

    const allowed = await authorizer.canAccess({
      caller: 'admin',
      principal: ADMIN,
      file: mediaFileViewOf({ purpose: 'inquiry-attachment' }),
    });

    expect(allowed).toBe(true);
  });

  test('管理者の画像確認の判定が登録されていない間は、管理者側からの画像の要求を拒否する', async () => {
    const authorizer = createDefaultAuthorizer();

    const allowed = await authorizer.canAccess({
      caller: 'admin',
      principal: ADMIN,
      file: imageFileViewOf({ owner: { kind: 'admin', id: ADMIN.subjectId } }),
    });

    expect(allowed).toBe(false);
  });
});
