import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { ADMIN_AUTH_TOKEN_TTL_SECONDS } from '../../domain/admin/admin-auth-token-purpose.ts';
import {
  activeAdmin,
  currentAdmin,
  hashedOf,
  INVITATION_META,
  INVITATION_NOW,
  INVITED_EMAIL,
  INVITED_ID,
  invitedAdmin,
  OPERATOR_ID,
  setupAdminInvitation,
} from './testing/admin-invitation-fakes.ts';
import { caught, errorShape } from './testing/admin-login-fakes.ts';

const MS_PER_SECOND = 1000;

const INVITATION_EXPIRES_AT = new Date(
  INVITATION_NOW.getTime() +
    ADMIN_AUTH_TOKEN_TTL_SECONDS.invitation * MS_PER_SECOND,
);

const INVITATION_HASH_PURPOSE = 'admin-auth-token-invitation';

const FORBIDDEN = {
  kind: 'forbidden',
  code: 'forbidden',
  message: 'この操作はできません。',
  status: 403,
  retryAfterSeconds: undefined,
};

const NOT_FOUND = {
  kind: 'not_found',
  code: 'not_found',
  message: '対象が見つかりません。',
  status: 404,
  retryAfterSeconds: undefined,
};

describe('StoreAdminInvitation.invite', () => {
  test.each(['moderator', 'super_admin'] as const)(
    '%sは閲覧のみの招待中の管理者・24時間の招待のトークン・監査ログを1つの書き込みで作り、その後にリンクのメールを送る',
    async (role) => {
      const fakes = setupAdminInvitation();

      await fakes.invitation.invite(
        currentAdmin(role),
        { email: `  ${INVITED_EMAIL}\u3000`, reason: '  運用の担当  ' },
        INVITATION_META,
      );

      const [inserted] = fakes.state.inserted;
      const adminId = inserted?.admin.id ?? '';
      expect(fakes.state.inserted).toHaveLength(1);
      expect(inserted?.admin).toEqual({
        id: adminId,
        email: INVITED_EMAIL,
        invitedAt: INVITATION_NOW,
      });
      expect(inserted?.token).toEqual({
        tokenHash: hashedOf(INVITATION_HASH_PURPOSE, 'secret-plain-1'),
        expiresAt: INVITATION_EXPIRES_AT,
      });
      expect(inserted?.audit).toMatchObject({
        operatorAdminId: OPERATOR_ID,
        action: 'admin-account.invite',
        targetKind: 'admin',
        targetIds: [adminId],
        reason: '運用の担当',
        detail: {},
        occurredAt: INVITATION_NOW,
      });
      expect(fakes.state.directAuditInserts).toEqual([]);
      expect(fakes.state.mails).toEqual([
        {
          to: INVITED_EMAIL,
          token: 'secret-plain-1',
          expiresAt: INVITATION_EXPIRES_AT,
        },
      ]);
      expect(fakes.state.calls).toEqual([
        'admins.insertInvited',
        'mailer.sendInvitation',
      ]);
      expect(fakes.state.admins.get(adminId)).toMatchObject({
        role: 'viewer',
        status: 'invited',
        nickname: null,
        title: null,
        avatarFileId: null,
      });
    },
  );

  test('理由を省くと、監査ログの理由は空として記録する', async () => {
    const fakes = setupAdminInvitation();

    await fakes.invitation.invite(
      currentAdmin('moderator'),
      { email: INVITED_EMAIL },
      INVITATION_META,
    );

    expect(fakes.state.inserted[0]?.audit.reason).toBeNull();
  });

  test('閲覧のみの管理者の招待は、監査ログの準備も書き込みもメールも行わずに拒否する', async () => {
    const fakes = setupAdminInvitation();

    const error = await caught(
      fakes.invitation.invite(
        currentAdmin('viewer'),
        { email: INVITED_EMAIL },
        INVITATION_META,
      ),
    );

    expect(errorShape(error)).toEqual(FORBIDDEN);
    expect(fakes.state.calls).toEqual([]);
  });

  test.each([
    ['有効', activeAdmin({ email: 'INVITED1@Mail.Example' })],
    ['招待中', invitedAdmin({ email: 'Invited1@MAIL.example' })],
  ] as const)(
    '大文字小文字だけが異なる%sの管理者のメールアドレスは、既に登録されている旨で拒否してメールを送らない',
    async (_label, existing) => {
      const fakes = setupAdminInvitation({ admins: [existing] });

      const error = await caught(
        fakes.invitation.invite(
          currentAdmin('super_admin'),
          { email: INVITED_EMAIL },
          INVITATION_META,
        ),
      );

      expect(errorShape(error)).toEqual({
        kind: 'conflict',
        code: 'admin_email_in_use',
        message: 'このメールアドレスは既に管理者として登録されています。',
        status: 409,
        retryAfterSeconds: undefined,
      });
      expect(fakes.state.inserted).toEqual([]);
      expect(fakes.state.mails).toEqual([]);
    },
  );

  test('監査ログの理由が上限を超えると、入力の検証の失敗として書き込みもメールも行わない', async () => {
    const fakes = setupAdminInvitation();

    const error = await caught(
      fakes.invitation.invite(
        currentAdmin('moderator'),
        { email: INVITED_EMAIL, reason: 'あ'.repeat(501) },
        INVITATION_META,
      ),
    );

    expect(error.code).toBe('validation_error');
    expect(error.details?.[0]?.field).toBe('reason');
    expect(fakes.state.calls).toEqual([]);
  });

  test('メールの送信の要求に失敗すると、招待を作った後に失敗を返す', async () => {
    const mailError = new Error('送信の要求に失敗した');
    const fakes = setupAdminInvitation({ mailError });

    const failure = fakes.invitation.invite(
      currentAdmin('moderator'),
      { email: INVITED_EMAIL },
      INVITATION_META,
    );

    const rejection = await failure.then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(rejection).toBe(mailError);
    expect(fakes.state.inserted).toHaveLength(1);
  });
});

describe('StoreAdminInvitation.resend', () => {
  test('招待中の管理者には、未使用のトークンの置き換え・招待の期限の更新・招待の操作の監査ログを1つの書き込みで行い、新しいリンクを送る', async () => {
    const fakes = setupAdminInvitation({ admins: [invitedAdmin()] });

    await fakes.invitation.resend(
      currentAdmin('moderator'),
      { adminId: INVITED_ID, reason: '期限切れのため' },
      INVITATION_META,
    );

    const [reissued] = fakes.state.reissued;
    expect(reissued?.adminId).toBe(INVITED_ID);
    expect(reissued?.token).toEqual({
      tokenHash: hashedOf(INVITATION_HASH_PURPOSE, 'secret-plain-1'),
      expiresAt: INVITATION_EXPIRES_AT,
    });
    expect(reissued?.audit).toMatchObject({
      operatorAdminId: OPERATOR_ID,
      action: 'admin-account.invite',
      targetKind: 'admin',
      targetIds: [INVITED_ID],
      reason: '期限切れのため',
      occurredAt: INVITATION_NOW,
    });
    expect(fakes.state.directAuditInserts).toEqual([]);
    expect(fakes.state.mails).toEqual([
      {
        to: INVITED_EMAIL,
        token: 'secret-plain-1',
        expiresAt: INVITATION_EXPIRES_AT,
      },
    ]);
    expect(fakes.state.calls).toEqual([
      'admins.findById',
      'admins.reissueInvitation',
      'mailer.sendInvitation',
    ]);
  });

  test('閲覧のみの管理者の再送は、対象を読まずに拒否する', async () => {
    const fakes = setupAdminInvitation({ admins: [invitedAdmin()] });

    const error = await caught(
      fakes.invitation.resend(
        currentAdmin('viewer'),
        { adminId: INVITED_ID },
        INVITATION_META,
      ),
    );

    expect(errorShape(error)).toEqual(FORBIDDEN);
    expect(fakes.state.calls).toEqual([]);
  });

  test.each([
    ['有効な管理者', [activeAdmin()]],
    ['存在しない管理者', []],
  ] as const)(
    '%sへの再送は対象が見つからない失敗にして、書き込みもメールも行わない',
    async (_label, admins) => {
      const fakes = setupAdminInvitation({ admins });

      const error = await caught(
        fakes.invitation.resend(
          currentAdmin('super_admin'),
          { adminId: INVITED_ID },
          INVITATION_META,
        ),
      );

      expect(errorShape(error)).toEqual(NOT_FOUND);
      expect(fakes.state.calls).toEqual(['admins.findById']);
    },
  );

  test('読んだ後に招待が完了・削除されて置き換えが取り消されると、対象が見つからない失敗にしてメールを送らない', async () => {
    const fakes = setupAdminInvitation({
      admins: [invitedAdmin()],
      reissueResult: 'not-invited',
    });

    const error = await caught(
      fakes.invitation.resend(
        currentAdmin('moderator'),
        { adminId: INVITED_ID },
        INVITATION_META,
      ),
    );

    expect(errorShape(error)).toEqual(NOT_FOUND);
    expect(fakes.state.mails).toEqual([]);
  });

  test('監査ログの理由が上限を超えると、入力の検証の失敗として書き込みもメールも行わない', async () => {
    const fakes = setupAdminInvitation({ admins: [invitedAdmin()] });

    const error = await caught(
      fakes.invitation.resend(
        currentAdmin('moderator'),
        { adminId: INVITED_ID, reason: 'あ'.repeat(501) },
        INVITATION_META,
      ),
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('validation_error');
    expect(fakes.state.calls).toEqual(['admins.findById']);
  });
});
