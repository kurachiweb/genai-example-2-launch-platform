import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type { AdminRole } from '../../../common-lib/admin/admin-roles.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { AdminSnapshot } from '../../domain/admin/admin-account.ts';
import {
  adminRecordOf,
  CURRENT_AVATAR_ID,
  currentAdmin,
  MANAGEMENT_META,
  MANAGEMENT_NOW,
  OPERATOR_ID,
  rejectionOf,
  operatorRecordOf,
  OTHER_SUPER_ADMIN_ID,
  setupAccountManagement,
  TARGET_ID,
} from './testing/admin-account-management-fakes.ts';

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

const WRITE_CALLS = ['admins.deleteGuarded', 'admins.changeRoleGuarded'];

const operatorSnapshotOf = (role: AdminRole): AdminSnapshot => ({
  id: OPERATOR_ID,
  role,
  status: 'active',
  invitationExpiresAt: null,
});

describe('StoreAdminAccountManagement.list', () => {
  test('招待中を含む全管理者を、保存の順のまま表示の状態とともに返す', async () => {
    const expiredInvitation = adminRecordOf({
      id: '01JC0INVD00000000000000001',
      status: 'invited',
      role: 'viewer',
      invitationExpiresAt: MANAGEMENT_NOW,
      email: 'expired1@mail.example',
      passwordHash: null,
      nickname: null,
      activatedAt: null,
      createdAt: new Date('2026-11-02T00:00:00.000Z'),
    });
    const pendingInvitation = adminRecordOf({
      id: '01JC0INVD00000000000000002',
      status: 'invited',
      invitationExpiresAt: new Date(MANAGEMENT_NOW.getTime() + 1),
      email: 'pending1@mail.example',
      passwordHash: null,
      nickname: null,
      activatedAt: null,
    });
    const active = adminRecordOf({
      title: '運営責任者',
      avatarFileId: CURRENT_AVATAR_ID,
      role: 'moderator',
    });
    const { management } = setupAccountManagement({
      admins: [expiredInvitation, pendingInvitation, active],
    });

    const listed = await management.list(
      currentAdmin('viewer'),
      MANAGEMENT_META,
    );

    expect(listed).toEqual([
      {
        id: expiredInvitation.id,
        email: 'expired1@mail.example',
        nickname: null,
        title: null,
        avatarFileId: null,
        role: 'viewer',
        status: 'invitation_expired',
        createdAt: new Date('2026-11-02T00:00:00.000Z'),
      },
      expect.objectContaining({
        id: pendingInvitation.id,
        status: 'invited',
      }),
      {
        id: TARGET_ID,
        email: 'target1@mail.example',
        nickname: '対象の管理者',
        title: '運営責任者',
        avatarFileId: CURRENT_AVATAR_ID,
        role: 'moderator',
        status: 'active',
        createdAt: new Date('2026-11-01T00:00:00.000Z'),
      },
    ]);
  });
});

describe('StoreAdminAccountManagement.delete', () => {
  test('モデレーターは最上位管理者でない管理者を、操作者の状態を条件にした監査ログ付きの一括の書き込みで削除し、行が参照する画像を即時に削除する', async () => {
    const { management, recorded } = setupAccountManagement({
      admins: [
        operatorRecordOf('moderator'),
        adminRecordOf({ avatarFileId: CURRENT_AVATAR_ID }),
      ],
    });

    await management.delete(
      currentAdmin('moderator'),
      { adminId: TARGET_ID, reason: '  退職のため  ' },
      MANAGEMENT_META,
    );

    expect(recorded.deletions).toHaveLength(1);
    const [deletion] = recorded.deletions;
    expect(deletion?.operator).toEqual(operatorSnapshotOf('moderator'));
    expect(deletion?.targetId).toBe(TARGET_ID);
    expect(deletion?.audit).toMatchObject({
      operatorAdminId: OPERATOR_ID,
      action: 'admin-account.delete',
      targetKind: 'admin',
      targetIds: [TARGET_ID],
      reason: '退職のため',
      detail: {},
      occurredAt: MANAGEMENT_NOW,
    });
    expect(recorded.erasures).toEqual([[CURRENT_AVATAR_ID]]);
    expect(recorded.calls).toEqual([
      'admins.findById',
      'admins.deleteGuarded',
      'media.eraseNow',
    ]);
  });

  test('最上位管理者は他の最上位管理者を理由なしで削除でき、画像の無い管理者では画像の削除を要求しない', async () => {
    const { management, recorded } = setupAccountManagement({
      admins: [
        operatorRecordOf('super_admin'),
        adminRecordOf({ role: 'super_admin' }),
      ],
    });

    await management.delete(
      currentAdmin('super_admin'),
      { adminId: TARGET_ID },
      MANAGEMENT_META,
    );

    expect(recorded.deletions[0]?.audit.reason).toBeNull();
    expect(recorded.admins.has(TARGET_ID)).toBe(false);
    expect(recorded.erasures).toEqual([]);
  });

  test('自分自身の削除はロールによらず自分自身の削除の禁止で拒否し、書き込まない', async () => {
    const { management, recorded } = setupAccountManagement({
      admins: [operatorRecordOf('super_admin')],
    });

    const result = management.delete(
      currentAdmin('super_admin'),
      { adminId: OPERATOR_ID },
      MANAGEMENT_META,
    );

    expect(await rejectionOf(result)).toMatchObject({
      kind: 'forbidden',
      code: 'self_deletion_forbidden',
    });
    expect(recorded.calls).not.toContainAnyValues(WRITE_CALLS);
  });

  test.each([
    ['moderator', 'super_admin'],
    ['viewer', 'viewer'],
  ] as const)(
    '%sによる%sの削除は権限の不足で拒否し、書き込まない',
    async (operatorRole, targetRole) => {
      const { management, recorded } = setupAccountManagement({
        admins: [
          operatorRecordOf(operatorRole),
          adminRecordOf({
            role: targetRole,
            avatarFileId: CURRENT_AVATAR_ID,
          }),
        ],
      });

      const result = management.delete(
        currentAdmin(operatorRole),
        { adminId: TARGET_ID },
        MANAGEMENT_META,
      );

      expect(await rejectionOf(result)).toMatchObject({
        kind: 'forbidden',
        code: 'forbidden',
      });
      expect(recorded.calls).not.toContainAnyValues([
        ...WRITE_CALLS,
        'media.eraseNow',
      ]);
    },
  );

  test('対象が存在しなければ対象なしで拒否する', async () => {
    const { management, recorded } = setupAccountManagement({
      admins: [operatorRecordOf('super_admin')],
    });

    const result = management.delete(
      currentAdmin('super_admin'),
      { adminId: TARGET_ID },
      MANAGEMENT_META,
    );

    expect(await rejectionOf(result)).toMatchObject({ code: 'not_found' });
    expect(recorded.calls).not.toContainAnyValues(WRITE_CALLS);
  });

  test('理由が監査ログの規則に違反すれば、削除を行わずに入力の検証の失敗にする', async () => {
    const { management, recorded } = setupAccountManagement();

    const result = management.delete(
      currentAdmin('super_admin'),
      { adminId: TARGET_ID, reason: 'あ'.repeat(501) },
      MANAGEMENT_META,
    );

    expect(await rejectionOf(result)).toMatchObject({
      code: 'validation_error',
      details: [expect.objectContaining({ field: 'reason' })],
    });
    expect(recorded.calls).not.toContainAnyValues(WRITE_CALLS);
  });

  test('書き込みが取り消された後に対象が無ければ対象なしにし、画像の削除を要求しない', async () => {
    const { management, recorded } = setupAccountManagement({
      admins: [
        operatorRecordOf('super_admin'),
        adminRecordOf({ avatarFileId: CURRENT_AVATAR_ID }),
      ],
      beforeGuardedWrite: (admins) => {
        admins.delete(TARGET_ID);
        return 'rejected';
      },
    });

    const result = management.delete(
      currentAdmin('super_admin'),
      { adminId: TARGET_ID },
      MANAGEMENT_META,
    );

    expect(await rejectionOf(result)).toMatchObject({
      kind: 'not_found',
      code: 'not_found',
    });
    expect(recorded.erasures).toEqual([]);
  });

  test('書き込みが取り消された後に対象が最後の有効な最上位管理者なら、最上位管理者が1人だけの旨で拒否する', async () => {
    const { management } = setupAccountManagement({
      admins: [
        operatorRecordOf('super_admin'),
        adminRecordOf({ role: 'super_admin' }),
      ],
      // 操作者が同時に降格され、対象だけが有効な最上位管理者として残った
      beforeGuardedWrite: (admins) => {
        admins.set(OPERATOR_ID, operatorRecordOf('moderator'));
        return 'rejected';
      },
    });

    const result = management.delete(
      currentAdmin('super_admin'),
      { adminId: TARGET_ID },
      MANAGEMENT_META,
    );

    expect(await rejectionOf(result)).toMatchObject({
      kind: 'conflict',
      code: 'last_super_admin',
      message: '最上位管理者が1人だけのため、この操作はできません。',
    });
  });

  test('書き込みが取り消された後に対象が残り最後の最上位管理者でもなければ、競合にする', async () => {
    const { management } = setupAccountManagement({
      admins: [
        operatorRecordOf('moderator'),
        adminRecordOf({ role: 'moderator' }),
        adminRecordOf({
          id: OTHER_SUPER_ADMIN_ID,
          role: 'super_admin',
          email: 'super2@mail.example',
        }),
      ],
      beforeGuardedWrite: (admins) => {
        admins.set(TARGET_ID, adminRecordOf({ role: 'super_admin' }));
        return 'rejected';
      },
    });

    const result = management.delete(
      currentAdmin('moderator'),
      { adminId: TARGET_ID },
      MANAGEMENT_META,
    );

    expect(await rejectionOf(result)).toMatchObject({
      kind: 'conflict',
      code: 'admin_state_conflict',
    });
  });

  test('画像の削除に失敗しても削除は成功させ、管理者のIDだけを属性にした警告のログに残す', async () => {
    const { management, recorded } = setupAccountManagement({
      admins: [
        operatorRecordOf('super_admin'),
        adminRecordOf({ avatarFileId: CURRENT_AVATAR_ID }),
      ],
      eraseError: new AppError({
        kind: 'unavailable',
        code: 'storage_unavailable',
        message: '現在ご利用いただけません。',
      }),
    });

    await management.delete(
      currentAdmin('super_admin'),
      { adminId: TARGET_ID },
      MANAGEMENT_META,
    );

    expect(recorded.deletions).toHaveLength(1);
    const warnings = records.filter((record) => record.level === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.category).toEqual(['api', 'admin', 'account']);
    expect(Object.keys(warnings[0]?.properties ?? {}).toSorted()).toEqual([
      'adminId',
      'error',
    ]);
    expect(warnings[0]?.properties['adminId']).toBe(TARGET_ID);
  });
});

describe('StoreAdminAccountManagement.changeRole', () => {
  test('最上位管理者は、読み取った変更前のロールを条件と監査ログの詳細に含めてロールを変え、変更後の管理者を返す', async () => {
    const { management, recorded } = setupAccountManagement();

    const changed = await management.changeRole(
      currentAdmin('super_admin'),
      { adminId: TARGET_ID, role: 'moderator', reason: '担当の変更' },
      MANAGEMENT_META,
    );

    expect(recorded.roleChanges).toHaveLength(1);
    const [roleChange] = recorded.roleChanges;
    expect(roleChange?.operator).toEqual(operatorSnapshotOf('super_admin'));
    expect(roleChange?.change).toEqual({
      targetId: TARGET_ID,
      fromRole: 'viewer',
      toRole: 'moderator',
    });
    expect(roleChange?.audit).toMatchObject({
      operatorAdminId: OPERATOR_ID,
      action: 'admin-account.role-change',
      targetKind: 'admin',
      targetIds: [TARGET_ID],
      reason: '担当の変更',
      detail: { fromRole: 'viewer', toRole: 'moderator' },
      occurredAt: MANAGEMENT_NOW,
    });
    expect(changed).toMatchObject({
      id: TARGET_ID,
      role: 'moderator',
      status: 'active',
    });
  });

  test.each(['moderator', 'viewer'] as const)(
    '%sによるロールの変更は権限の不足で拒否し、対象を読まずに書き込まない',
    async (role) => {
      const { management, recorded } = setupAccountManagement({
        admins: [operatorRecordOf(role), adminRecordOf()],
      });

      const result = management.changeRole(
        currentAdmin(role),
        { adminId: TARGET_ID, role: 'moderator' },
        MANAGEMENT_META,
      );

      expect(await rejectionOf(result)).toMatchObject({
        kind: 'forbidden',
        code: 'forbidden',
      });
      expect(recorded.calls).toEqual([]);
    },
  );

  test('対象が存在しなければ対象なしで拒否する', async () => {
    const { management, recorded } = setupAccountManagement({
      admins: [operatorRecordOf('super_admin')],
    });

    const result = management.changeRole(
      currentAdmin('super_admin'),
      { adminId: TARGET_ID, role: 'moderator' },
      MANAGEMENT_META,
    );

    expect(await rejectionOf(result)).toMatchObject({ code: 'not_found' });
    expect(recorded.calls).not.toContainAnyValues(WRITE_CALLS);
  });

  test('書き込みが取り消された後に対象が無ければ対象なしにする', async () => {
    const { management } = setupAccountManagement({
      beforeGuardedWrite: (admins) => {
        admins.delete(TARGET_ID);
        return 'rejected';
      },
    });

    const result = management.changeRole(
      currentAdmin('super_admin'),
      { adminId: TARGET_ID, role: 'moderator' },
      MANAGEMENT_META,
    );

    expect(await rejectionOf(result)).toMatchObject({ code: 'not_found' });
  });

  test('最後の有効な最上位管理者を最上位管理者以外へ変える書き込みが取り消されたら、最上位管理者が1人だけの旨で拒否する', async () => {
    const { management } = setupAccountManagement({
      admins: [operatorRecordOf('super_admin')],
      beforeGuardedWrite: () => 'rejected',
    });

    const result = management.changeRole(
      currentAdmin('super_admin'),
      { adminId: OPERATOR_ID, role: 'viewer' },
      MANAGEMENT_META,
    );

    expect(await rejectionOf(result)).toMatchObject({
      kind: 'conflict',
      code: 'last_super_admin',
    });
  });

  test.each([
    [
      '対象のロールが読み取った後に変わった',
      'viewer',
      'moderator',
      (admins: Map<string, ReturnType<typeof adminRecordOf>>) => {
        admins.set(TARGET_ID, adminRecordOf({ role: 'moderator' }));
      },
    ],
    [
      '最後の最上位管理者のまま最上位管理者へ変えようとした',
      'super_admin',
      'super_admin',
      (admins: Map<string, ReturnType<typeof adminRecordOf>>) => {
        admins.set(OPERATOR_ID, operatorRecordOf('moderator'));
      },
    ],
  ] as const)(
    '%s場合の取り消しは競合にする',
    async (_label, targetRole, toRole, interfere) => {
      const { management } = setupAccountManagement({
        admins: [
          operatorRecordOf('super_admin'),
          adminRecordOf({ role: targetRole }),
        ],
        beforeGuardedWrite: (admins) => {
          interfere(admins);
          return 'rejected';
        },
      });

      const result = management.changeRole(
        currentAdmin('super_admin'),
        { adminId: TARGET_ID, role: toRole },
        MANAGEMENT_META,
      );

      expect(await rejectionOf(result)).toMatchObject({
        kind: 'conflict',
        code: 'admin_state_conflict',
      });
    },
  );
});
