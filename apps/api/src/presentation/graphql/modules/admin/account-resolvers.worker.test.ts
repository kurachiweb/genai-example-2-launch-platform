import { describe, expect, test } from 'vitest';

import type { AdminRole } from '../../../../../common-lib/admin/admin-roles.ts';
import {
  ADMIN_ACCOUNT_DELETE_ACTION,
  ADMIN_ACCOUNT_INVITE_ACTION,
  ADMIN_ACCOUNT_ROLE_CHANGE_ACTION,
} from '../../../../../common-lib/admin/audit-actions/admin-foundation.ts';
import {
  insertInvitation,
  issueAdminSession,
  lastAdminMailOf,
  sentAdminMails,
} from '../../../../../test/support/admin-graphql-harness.ts';
import {
  ADMIN_ACCOUNTS,
  type AdminAccountFields,
  type AdminRoleValue,
  CHANGE_ADMIN_ROLE,
  codesOf,
  DELETE_ADMIN,
  detailsOf,
  installAdminGraphQLTest,
  INVITE_ADMIN,
  RESEND_ADMIN_INVITATION,
  uniqueAdminEmail,
  UPDATE_ADMIN_PROFILE,
} from '../../../../../test/support/admin-graphql-operations.ts';
import {
  adminEmailOf,
  adminIdOf,
  insertAdmin,
  insertInvitedAdmin,
  readAdminRow,
  readAuditLogSummaries,
  readAuditLogTargetIds,
} from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';

const { gateway, logs } = installAdminGraphQLTest();

const SUPER_ADMIN = 1;

const MODERATOR = 2;

const VIEWER = 3;

const INVITED = 4;

const AUTHORIZATION_CATEGORY = 'api.admin.authorization';

const REASON_TOO_LONG_MESSAGE = '理由は500文字以内で入力してください。';

async function sessionOf(index: number, role: AdminRole): Promise<string> {
  await insertAdmin(index, { role });
  return (await issueAdminSession(adminIdOf(index))).token;
}

function denialLogs() {
  return logs().filter((log) => log.category === AUTHORIZATION_CATEGORY);
}

function invite(sessionToken: string, email: string, reason?: string) {
  return gateway.call<{ inviteAdmin: AdminAccountFields | null }>(
    INVITE_ADMIN,
    { email, ...(reason !== undefined && { reason }) },
    { sessionToken },
  );
}

function deleteAdmin(sessionToken: string, id: string, reason?: string) {
  return gateway.call<{ deleteAdmin: boolean | null }>(
    DELETE_ADMIN,
    { id, ...(reason !== undefined && { reason }) },
    { sessionToken },
  );
}

function changeRole(
  sessionToken: string,
  id: string,
  role: AdminRoleValue,
  reason?: string,
) {
  return gateway.call<{ changeAdminRole: AdminAccountFields | null }>(
    CHANGE_ADMIN_ROLE,
    { id, role, ...(reason !== undefined && { reason }) },
    { sessionToken },
  );
}

function updateProfile(
  sessionToken: string,
  variables: {
    readonly id: string;
    readonly nickname: string;
    readonly title?: string | null;
  },
) {
  return gateway.call<{ updateAdminProfile: AdminAccountFields | null }>(
    UPDATE_ADMIN_PROFILE,
    variables,
    { sessionToken },
  );
}

describe('adminAccounts', () => {
  test('閲覧のみの管理者にも、招待中を含む全管理者を表示の状態とともに返す', async () => {
    const sessionToken = await sessionOf(VIEWER, 'viewer');
    await insertInvitation(INVITED);

    const response = await gateway.call<{
      adminAccounts: readonly AdminAccountFields[];
    }>(ADMIN_ACCOUNTS, {}, { sessionToken });

    expect(response.errors).toBeUndefined();
    const accounts = response.data?.adminAccounts ?? [];
    expect(accounts).toHaveLength(2);
    expect(accounts).toEqual(
      expect.arrayContaining([
        {
          id: adminIdOf(VIEWER),
          email: adminEmailOf(VIEWER),
          nickname: `管理者${String(VIEWER)}`,
          title: null,
          avatar: null,
          role: 'VIEWER',
          status: 'ACTIVE',
          createdAt: '2026-11-01T00:00:00.000Z',
        },
        expect.objectContaining({
          id: adminIdOf(INVITED),
          nickname: null,
          status: 'INVITED',
        }),
      ]),
    );
  });

  test('ログインしていなければ未認証として拒否する', async () => {
    const response = await gateway.call(ADMIN_ACCOUNTS);

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test('利用者側の呼び出し元からは拒否する', async () => {
    const sessionToken = await sessionOf(SUPER_ADMIN, 'super_admin');

    const response = await gateway.call(
      ADMIN_ACCOUNTS,
      {},
      { caller: 'client', sessionToken },
    );

    expect(codesOf(response)).toEqual(['forbidden']);
  });
});

describe('inviteAdmin', () => {
  test('閲覧のみの管理者の招待は403に当たる禁止のコードで拒否し、何も書き込まずに必要なロールをログに残す', async () => {
    const sessionToken = await sessionOf(VIEWER, 'viewer');
    const email = uniqueAdminEmail('invitee');

    const response = await invite(sessionToken, email);

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(response.data).toBeNull();
    expect(sentAdminMails).toEqual([]);
    expect(await readAuditLogSummaries()).toEqual([]);
    expect(denialLogs()).toEqual([
      expect.objectContaining({
        level: 'warning',
        requiredRole: 'moderator',
      }),
    ]);
  });

  test('モデレーターの招待は閲覧のみの招待中の管理者を作り、招待のメールを送り、理由とともに監査ログに記録する', async () => {
    const sessionToken = await sessionOf(MODERATOR, 'moderator');
    const email = uniqueAdminEmail('invitee');

    const response = await invite(sessionToken, ` ${email} `, '新しい運営者');

    expect(response.errors).toBeUndefined();
    const account = response.data?.inviteAdmin;
    expect(account).toMatchObject({
      email,
      nickname: null,
      title: null,
      avatar: null,
      role: 'VIEWER',
      status: 'INVITED',
    });
    expect(lastAdminMailOf('invitation').to).toBe(email);
    expect(await readAuditLogSummaries()).toEqual([
      expect.objectContaining({
        operatorAdminId: adminIdOf(MODERATOR),
        action: ADMIN_ACCOUNT_INVITE_ACTION.name,
      }),
    ]);
    expect(await readAuditLogTargetIds()).toEqual([account?.id]);
    expect(denialLogs()).toEqual([]);
  });

  test('既存の管理者のメールアドレスは、大文字小文字を問わずadmin_email_in_useで拒否する', async () => {
    const sessionToken = await sessionOf(MODERATOR, 'moderator');

    const response = await invite(
      sessionToken,
      adminEmailOf(MODERATOR).toUpperCase(),
    );

    expect(codesOf(response)).toEqual(['admin_email_in_use']);
    expect(response.errors?.[0]?.message).toBe(
      'このメールアドレスは既に管理者として登録されています。',
    );
  });

  test('メールアドレスの形式の誤りと長すぎる理由は、欄ごとの詳細で返す', async () => {
    const sessionToken = await sessionOf(MODERATOR, 'moderator');

    const response = await invite(
      sessionToken,
      'not-an-address',
      'あ'.repeat(501),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'email',
        message: 'メールアドレスの形式が正しくありません。',
      }),
      expect.objectContaining({
        field: 'reason',
        message: REASON_TOO_LONG_MESSAGE,
      }),
    ]);
  });
});

describe('resendAdminInvitation', () => {
  test('モデレーターの再送は新しい招待のリンクを送り、招待中の管理者を返す', async () => {
    const sessionToken = await sessionOf(MODERATOR, 'moderator');
    await insertInvitation(INVITED);

    const response = await gateway.call<{
      resendAdminInvitation: AdminAccountFields | null;
    }>(RESEND_ADMIN_INVITATION, { id: adminIdOf(INVITED) }, { sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.resendAdminInvitation).toMatchObject({
      id: adminIdOf(INVITED),
      status: 'INVITED',
    });
    expect(lastAdminMailOf('invitation').to).toBe(adminEmailOf(INVITED));
    expect(await readAuditLogSummaries()).toEqual([
      expect.objectContaining({ action: ADMIN_ACCOUNT_INVITE_ACTION.name }),
    ]);
  });

  test('閲覧のみの管理者の再送は禁止のコードで拒否する', async () => {
    const sessionToken = await sessionOf(VIEWER, 'viewer');
    await insertInvitation(INVITED);

    const response = await gateway.call(
      RESEND_ADMIN_INVITATION,
      { id: adminIdOf(INVITED) },
      { sessionToken },
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(sentAdminMails).toEqual([]);
  });

  test('有効な管理者への再送は対象が見つからないとして拒否する', async () => {
    const sessionToken = await sessionOf(MODERATOR, 'moderator');

    const response = await gateway.call(
      RESEND_ADMIN_INVITATION,
      { id: adminIdOf(MODERATOR) },
      { sessionToken },
    );

    expect(codesOf(response)).toEqual(['not_found']);
  });
});

describe('deleteAdmin', () => {
  test('モデレーターによる最上位管理者の削除は403に当たる禁止のコードで拒否し、削除しない', async () => {
    const sessionToken = await sessionOf(MODERATOR, 'moderator');
    await insertAdmin(SUPER_ADMIN, { role: 'super_admin' });

    const response = await deleteAdmin(sessionToken, adminIdOf(SUPER_ADMIN));

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readAdminRow(SUPER_ADMIN)).toBeDefined();
    expect(await readAuditLogSummaries()).toEqual([]);
  });

  test('モデレーターは閲覧のみの管理者を削除でき、監査ログに記録する', async () => {
    const sessionToken = await sessionOf(MODERATOR, 'moderator');
    await insertAdmin(VIEWER, { role: 'viewer' });

    const response = await deleteAdmin(
      sessionToken,
      adminIdOf(VIEWER),
      '退職のため',
    );

    expect(response.errors).toBeUndefined();
    expect(response.data).toEqual({ deleteAdmin: true });
    expect(await readAdminRow(VIEWER)).toBeUndefined();
    expect(await readAuditLogSummaries()).toEqual([
      expect.objectContaining({
        operatorAdminId: adminIdOf(MODERATOR),
        action: ADMIN_ACCOUNT_DELETE_ACTION.name,
      }),
    ]);
  });

  test('自分自身の削除はself_deletion_forbiddenで拒否する', async () => {
    const sessionToken = await sessionOf(SUPER_ADMIN, 'super_admin');

    const response = await deleteAdmin(sessionToken, adminIdOf(SUPER_ADMIN));

    expect(codesOf(response)).toEqual(['self_deletion_forbidden']);
  });

  test('閲覧のみの管理者の削除は禁止のコードで拒否する', async () => {
    const sessionToken = await sessionOf(VIEWER, 'viewer');
    await insertInvitation(INVITED);

    const response = await deleteAdmin(sessionToken, adminIdOf(INVITED));

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readAdminRow(INVITED)).toBeDefined();
  });
});

describe('changeAdminRole', () => {
  test('最上位管理者以外のロールの変更は403に当たる禁止のコードで拒否し、必要なロールをログに残す', async () => {
    const sessionToken = await sessionOf(MODERATOR, 'moderator');
    await insertAdmin(VIEWER, { role: 'viewer' });

    const response = await changeRole(
      sessionToken,
      adminIdOf(VIEWER),
      'MODERATOR',
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect((await readAdminRow(VIEWER))?.role).toBe('viewer');
    expect(denialLogs()).toEqual([
      expect.objectContaining({ requiredRole: 'super_admin' }),
    ]);
  });

  test('最上位管理者はロールを変更でき、変更後の管理者と変更前後のロールの監査ログを残す', async () => {
    const sessionToken = await sessionOf(SUPER_ADMIN, 'super_admin');
    await insertAdmin(VIEWER, { role: 'viewer' });

    const response = await changeRole(
      sessionToken,
      adminIdOf(VIEWER),
      'MODERATOR',
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.changeAdminRole).toMatchObject({
      id: adminIdOf(VIEWER),
      role: 'MODERATOR',
      status: 'ACTIVE',
    });
    expect((await readAdminRow(VIEWER))?.role).toBe('moderator');
    expect(await readAuditLogSummaries()).toEqual([
      expect.objectContaining({
        action: ADMIN_ACCOUNT_ROLE_CHANGE_ACTION.name,
        detail: { fromRole: 'viewer', toRole: 'moderator' },
      }),
    ]);
  });

  test('最後の最上位管理者の自己降格はlast_super_adminで拒否する', async () => {
    const sessionToken = await sessionOf(SUPER_ADMIN, 'super_admin');

    const response = await changeRole(
      sessionToken,
      adminIdOf(SUPER_ADMIN),
      'VIEWER',
    );

    expect(codesOf(response)).toEqual(['last_super_admin']);
    expect(response.errors?.[0]?.message).toBe(
      '最上位管理者が1人だけのため、この操作はできません。',
    );
  });

  test('未定義のロールの値はGraphQLの検証で拒否する', async () => {
    const sessionToken = await sessionOf(SUPER_ADMIN, 'super_admin');

    const response = await gateway.call(
      CHANGE_ADMIN_ROLE,
      { id: adminIdOf(VIEWER), role: 'OWNER' },
      { sessionToken },
    );

    expect(response.errors).toBeDefined();
    expect(response.data ?? null).toBeNull();
  });
});

describe('updateAdminProfile', () => {
  test('閲覧のみの管理者も自分のプロフィールを更新でき、前後の空白を除き空白だけの肩書きを未設定にする', async () => {
    const sessionToken = await sessionOf(VIEWER, 'viewer');

    const response = await updateProfile(sessionToken, {
      id: adminIdOf(VIEWER),
      nickname: '  新しい名前  ',
      title: '   ',
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.updateAdminProfile).toMatchObject({
      id: adminIdOf(VIEWER),
      nickname: '新しい名前',
      title: null,
      avatar: null,
    });
    expect((await readAdminRow(VIEWER))?.nickname).toBe('新しい名前');
  });

  test('最上位管理者でない管理者による他人のプロフィールの更新は禁止のコードで拒否する', async () => {
    const sessionToken = await sessionOf(MODERATOR, 'moderator');
    await insertAdmin(VIEWER, { role: 'viewer' });

    const response = await updateProfile(sessionToken, {
      id: adminIdOf(VIEWER),
      nickname: '書き換え',
    });

    expect(codesOf(response)).toEqual(['forbidden']);
    expect((await readAdminRow(VIEWER))?.nickname).toBe(
      `管理者${String(VIEWER)}`,
    );
    expect(denialLogs()).toEqual([
      expect.objectContaining({ requiredRole: 'super_admin' }),
    ]);
  });

  test('最上位管理者は他の管理者のプロフィールを更新できる', async () => {
    const sessionToken = await sessionOf(SUPER_ADMIN, 'super_admin');
    await insertAdmin(VIEWER, { role: 'viewer' });

    const response = await updateProfile(sessionToken, {
      id: adminIdOf(VIEWER),
      nickname: '運営の担当者',
      title: 'サポート担当',
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.updateAdminProfile).toMatchObject({
      nickname: '運営の担当者',
      title: 'サポート担当',
    });
  });

  test.each([
    ['招待中', 60 * 60 * 1000],
    ['招待期限切れ', -60 * 60 * 1000],
  ] as const)(
    '最上位管理者でも%sの管理者のプロフィールは更新できず、対象なしのコードで拒否する',
    async (_label, expiresInMs) => {
      const sessionToken = await sessionOf(SUPER_ADMIN, 'super_admin');
      await insertInvitedAdmin(INVITED, {
        invitationExpiresAt: new Date(Date.now() + expiresInMs),
      });

      const response = await updateProfile(sessionToken, {
        id: adminIdOf(INVITED),
        nickname: '書き換え',
      });

      expect(codesOf(response)).toEqual(['not_found']);
      expect((await readAdminRow(INVITED))?.nickname).toBeNull();
    },
  );

  test('ニックネームと肩書きの規則の違反は、管理者の文言で欄ごとの詳細にする', async () => {
    const sessionToken = await sessionOf(VIEWER, 'viewer');

    const response = await updateProfile(sessionToken, {
      id: adminIdOf(VIEWER),
      nickname: 'あ'.repeat(26),
      title: 'い'.repeat(51),
    });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'nickname',
        message: 'ニックネームは25文字以内で入力してください。',
      }),
      expect.objectContaining({
        field: 'title',
        message: '肩書きは50文字以内で入力してください。',
      }),
    ]);
  });

  test('空のニックネームは入力を求める文言で拒否する', async () => {
    const sessionToken = await sessionOf(VIEWER, 'viewer');

    const response = await updateProfile(sessionToken, {
      id: adminIdOf(VIEWER),
      nickname: ' ',
    });

    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'nickname',
        message: 'ニックネームを入力してください。',
      }),
    ]);
  });

  test('紐付けられないプロフィール画像はinvalid_uploadで拒否する', async () => {
    const sessionToken = await sessionOf(VIEWER, 'viewer');

    const response = await gateway.call(
      UPDATE_ADMIN_PROFILE,
      {
        id: adminIdOf(VIEWER),
        nickname: '名前',
        avatarFileId: '01JC0MEDIA0000000000000001',
      },
      { sessionToken },
    );

    expect(codesOf(response)).toEqual(['invalid_upload']);
  });
});
