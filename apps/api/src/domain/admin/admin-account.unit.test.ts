import { describe, expect, expectTypeOf, test } from 'bun:test';

import type { AdminRole } from '../../../common-lib/admin/admin-roles.ts';
import {
  ADMIN_STATUSES,
  type AdminDisplayStatus,
  type AdminOperationDenial,
  type AdminSnapshot,
  type AdminStatus,
  checkDeletable,
  checkInvitable,
  checkProfileEditable,
  checkRoleChangeable,
  displayStatus,
} from './admin-account.ts';

const NOW = new Date('2026-11-03T12:00:00.000Z');

const at = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs);

const admin = (
  id: string,
  role: AdminRole,
  overrides: Partial<AdminSnapshot> = {},
): AdminSnapshot => ({
  id,
  role,
  status: 'active',
  invitationExpiresAt: null,
  ...overrides,
});

const invited = (invitationExpiresAt: Date | null): AdminSnapshot =>
  admin('invited-admin', 'viewer', { status: 'invited', invitationExpiresAt });

describe('ADMIN_STATUSES', () => {
  test('状態は招待中と有効の2つで、変更できない', () => {
    expect([...ADMIN_STATUSES]).toEqual(['invited', 'active']);
    expect(Object.isFrozen(ADMIN_STATUSES)).toBe(true);
    expectTypeOf<AdminStatus>().toEqualTypeOf<'invited' | 'active'>();
  });
});

describe('displayStatus', () => {
  test('有効な管理者は有効と表示する', () => {
    expect(displayStatus(admin('active-admin', 'moderator'), NOW)).toBe(
      'active',
    );
  });

  test('招待の有効期限の直前までは招待中と表示する', () => {
    expect(displayStatus(invited(at(1)), NOW)).toBe('invited');
  });

  test('招待の有効期限ちょうど以降は招待期限切れと表示する', () => {
    expect(displayStatus(invited(NOW), NOW)).toBe('invitation_expired');
    expect(displayStatus(invited(at(-1)), NOW)).toBe('invitation_expired');
  });

  test('有効期限の無い招待中の管理者は招待中と表示する', () => {
    expect(displayStatus(invited(null), NOW)).toBe('invited');
  });

  test('有効な管理者は招待の有効期限が残っていても期限を問わず有効と表示する', () => {
    expect(
      displayStatus(
        admin('active-admin', 'viewer', { invitationExpiresAt: at(-1) }),
        NOW,
      ),
    ).toBe('active');
  });

  test('表示の状態は有効・招待中・招待期限切れの3つに分かれる', () => {
    const statuses = new Set([
      displayStatus(admin('active-admin', 'viewer'), NOW),
      displayStatus(invited(at(1)), NOW),
      displayStatus(invited(at(-1)), NOW),
    ]);

    expect([...statuses].toSorted()).toEqual([
      'active',
      'invitation_expired',
      'invited',
    ]);
    expectTypeOf<AdminDisplayStatus>().toEqualTypeOf<
      'active' | 'invited' | 'invitation_expired'
    >();
  });
});

describe('checkDeletable', () => {
  test.each<[AdminRole, AdminRole, AdminOperationDenial | undefined]>([
    ['moderator', 'viewer', undefined],
    ['moderator', 'moderator', undefined],
    ['moderator', 'super_admin', 'super_admin_target'],
    ['super_admin', 'viewer', undefined],
    ['super_admin', 'moderator', undefined],
    ['super_admin', 'super_admin', undefined],
    ['viewer', 'viewer', 'insufficient_role'],
    ['viewer', 'moderator', 'insufficient_role'],
    ['viewer', 'super_admin', 'insufficient_role'],
  ])(
    '%sが他の%sを削除する判定は%sになる',
    (operatorRole, targetRole, expected) => {
      expect(
        checkDeletable(
          admin('operator', operatorRole),
          admin('target', targetRole),
        ),
      ).toBe(expected);
    },
  );

  test.each<AdminRole>(['viewer', 'moderator', 'super_admin'])(
    '%sが自分自身を削除することは拒否する',
    (role) => {
      expect(checkDeletable(admin('same', role), admin('same', role))).toBe(
        'self',
      );
    },
  );

  test('招待中の管理者もロールに従って削除できる', () => {
    expect(
      checkDeletable(admin('operator', 'moderator'), invited(at(1))),
    ).toBeUndefined();
  });
});

describe('checkRoleChangeable', () => {
  test.each<[AdminRole, AdminOperationDenial | undefined]>([
    ['super_admin', undefined],
    ['moderator', 'insufficient_role'],
    ['viewer', 'insufficient_role'],
  ])('%sがロールを変更する判定は%sになる', (role, expected) => {
    expect(checkRoleChangeable(admin('operator', role))).toBe(expected);
  });
});

describe('checkProfileEditable', () => {
  test.each<AdminRole>(['viewer', 'moderator', 'super_admin'])(
    '%sは自分のプロフィールを編集できる',
    (role) => {
      expect(checkProfileEditable(admin('self', role), 'self')).toBeUndefined();
    },
  );

  test.each<[AdminRole, AdminOperationDenial | undefined]>([
    ['super_admin', undefined],
    ['moderator', 'insufficient_role'],
    ['viewer', 'insufficient_role'],
  ])(
    '%sが他の管理者のプロフィールを編集する判定は%sになる',
    (role, expected) => {
      expect(checkProfileEditable(admin('operator', role), 'other')).toBe(
        expected,
      );
    },
  );
});

describe('checkInvitable', () => {
  test.each<[AdminRole, AdminOperationDenial | undefined]>([
    ['super_admin', undefined],
    ['moderator', undefined],
    ['viewer', 'insufficient_role'],
  ])('%sが招待・再送する判定は%sになる', (role, expected) => {
    expect(checkInvitable(admin('operator', role))).toBe(expected);
  });
});
