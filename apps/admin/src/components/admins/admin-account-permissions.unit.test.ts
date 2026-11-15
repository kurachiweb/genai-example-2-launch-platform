import { describe, expect, test } from 'bun:test';

import type { AdminRole } from '../../../common-lib/admin/admin-roles.ts';
import {
  accountActionsOf,
  type AdminAccountTarget,
  canInviteAdmins,
} from './admin-account-permissions.ts';

const OPERATOR_ID = '01JC0ADMIN000000000000000000';

const operator = (role: AdminRole) => ({ id: OPERATOR_ID, role });

const target = (
  overrides: Partial<AdminAccountTarget> = {},
): AdminAccountTarget => ({
  id: '01JC0ADMIN000000000000000001',
  role: 'viewer',
  status: 'active',
  ...overrides,
});

describe('canInviteAdmins', () => {
  test.each([
    ['viewer', false],
    ['moderator', true],
    ['super_admin', true],
  ] as const)('%sの招待の可否は%s', (role, expected) => {
    expect(canInviteAdmins(role)).toBe(expected);
  });
});

describe('accountActionsOf', () => {
  test('閲覧のみは、他の管理者へのどの操作もできない', () => {
    expect(
      accountActionsOf(operator('viewer'), target({ status: 'invited' })),
    ).toStrictEqual({
      resend: false,
      changeRole: false,
      editProfile: false,
      delete: false,
    });
  });

  test('モデレーターは、招待中の管理者の再送と、最上位管理者でない管理者の削除ができる', () => {
    expect(
      accountActionsOf(operator('moderator'), target({ status: 'invited' })),
    ).toStrictEqual({
      resend: true,
      changeRole: false,
      editProfile: false,
      delete: true,
    });
  });

  test('モデレーターは、最上位管理者を削除できない', () => {
    expect(
      accountActionsOf(operator('moderator'), target({ role: 'super_admin' }))
        .delete,
    ).toBe(false);
  });

  test('最上位管理者は、他の最上位管理者の削除・ロールの変更・プロフィールの編集ができる', () => {
    expect(
      accountActionsOf(
        operator('super_admin'),
        target({ role: 'super_admin' }),
      ),
    ).toStrictEqual({
      resend: false,
      changeRole: true,
      editProfile: true,
      delete: true,
    });
  });

  test('招待期限切れの管理者にも再送できる', () => {
    expect(
      accountActionsOf(
        operator('moderator'),
        target({ status: 'invitation_expired' }),
      ).resend,
    ).toBe(true);
  });

  test('招待の完了前の管理者のプロフィールは編集できない', () => {
    expect(
      accountActionsOf(operator('super_admin'), target({ status: 'invited' }))
        .editProfile,
    ).toBe(false);
  });

  test('自分自身は削除できず、プロフィールは自分のアカウントのページで編集し、ロールは最上位管理者なら変更できる', () => {
    expect(
      accountActionsOf(
        operator('super_admin'),
        target({ id: OPERATOR_ID, role: 'super_admin' }),
      ),
    ).toStrictEqual({
      resend: false,
      changeRole: true,
      editProfile: false,
      delete: false,
    });
  });
});
