import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import type { MediaOwner } from '../../../lib/core/media/media-file.ts';
import {
  imageFileViewOf,
  mediaFileViewOf,
} from '../../../test/support/media-file-view.ts';
import {
  FILE_ACCESS_TYPES,
  type FileReadPolicy,
} from '../../application/media/file-access-policies.ts';
import type { AuthenticatedPrincipal } from '../../application/session/session-verifier.ts';
import { OwnerOnlyFileReadPolicy } from './owner-only-file-read-policy.ts';

const USER_ID = '01JC0USER00000000000000001';

const principalOf = (
  subjectKind: AuthenticatedPrincipal['subjectKind'],
  subjectId: string,
): AuthenticatedPrincipal =>
  Object.freeze({
    kind: 'authenticated',
    subjectKind,
    subjectId,
    sessionId: '01JC0SESSION0000000000001',
  });

describe('OwnerOnlyFileReadPolicy', () => {
  test('主体の種類と識別子がファイルの保有者と一致すれば閲覧を許可する', async () => {
    const policy: FileReadPolicy = new OwnerOnlyFileReadPolicy();

    const allowed = await policy.canRead({
      principal: principalOf('user', USER_ID),
      file: mediaFileViewOf({ owner: { kind: 'user', id: USER_ID } }),
    });

    expect(allowed).toBe(true);
  });

  test('管理者がアップロードしたファイルは、その管理者に閲覧を許可する', async () => {
    const policy: FileReadPolicy = new OwnerOnlyFileReadPolicy();

    const allowed = await policy.canRead({
      principal: principalOf('admin', '01JC0ADMIN0000000000000001'),
      file: mediaFileViewOf({
        owner: { kind: 'admin', id: '01JC0ADMIN0000000000000001' },
      }),
    });

    expect(allowed).toBe(true);
  });

  test.each<[string, AuthenticatedPrincipal, MediaOwner]>([
    [
      '識別子が異なる利用者',
      principalOf('user', '01JC0USER00000000000000002'),
      { kind: 'user', id: USER_ID },
    ],
    [
      '識別子が同じでも種類が異なる管理者',
      principalOf('admin', USER_ID),
      { kind: 'user', id: USER_ID },
    ],
    [
      '識別子が同じでも種類が異なる利用者',
      principalOf('user', USER_ID),
      { kind: 'admin', id: USER_ID },
    ],
    [
      '保有者がシステムのファイルを求める利用者',
      principalOf('user', USER_ID),
      { kind: 'system' },
    ],
    [
      '保有者がシステムのファイルを求める管理者',
      principalOf('admin', USER_ID),
      { kind: 'system' },
    ],
  ])('%sには閲覧を許可しない', async (_label, principal, owner) => {
    const policy: FileReadPolicy = new OwnerOnlyFileReadPolicy();

    const allowed = await policy.canRead({
      principal,
      file: mediaFileViewOf({ owner }),
    });

    expect(allowed).toBe(false);
  });

  test('保有者の判定だけを行い、用途・保存先・状態を見ない', async () => {
    const policy: FileReadPolicy = new OwnerOnlyFileReadPolicy();

    const allowed = await policy.canRead({
      principal: principalOf('user', USER_ID),
      file: imageFileViewOf({ owner: { kind: 'user', id: USER_ID } }),
    });

    expect(allowed).toBe(true);
  });

  test('既定の閲覧の可否の識別子に束縛すると、コンテナから解決した実装も保有者だけに許可する', async () => {
    const container = new Container();
    container
      .bind<FileReadPolicy>(FILE_ACCESS_TYPES.DefaultFileReadPolicy)
      .to(OwnerOnlyFileReadPolicy);
    const policy = container.get<FileReadPolicy>(
      FILE_ACCESS_TYPES.DefaultFileReadPolicy,
    );
    const file = mediaFileViewOf({ owner: { kind: 'user', id: USER_ID } });

    const results = await Promise.all([
      policy.canRead({ principal: principalOf('user', USER_ID), file }),
      policy.canRead({
        principal: principalOf('user', '01JC0USER00000000000000002'),
        file,
      }),
    ]);

    expect(results).toEqual([true, false]);
  });
});
