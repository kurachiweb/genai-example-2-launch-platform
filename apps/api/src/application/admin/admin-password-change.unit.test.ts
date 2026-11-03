import { describe, expect, test } from 'bun:test';

import {
  ADMIN_ID,
  adminOf,
  caught,
  currentAdminOf,
  EMAIL,
  invitedAdminOf,
  ISSUED_SESSION,
  META,
  NEW_PASSWORD,
  NICKNAME,
  NOW,
  RE_AUTHENTICATION,
  REAUTHENTICATION_FAILED,
  rejectionOf,
  setupAdminPasswordChange,
  shapeOf,
  storedHashOf,
  UNAUTHENTICATED,
} from './testing/admin-credential-change-fakes.ts';

const CHANGE_INPUT = {
  newPassword: NEW_PASSWORD,
  reAuthentication: RE_AUTHENTICATION,
} as const;

describe('StoreAdminPasswordChange.change', () => {
  test('本人確認・方針の確認・ハッシュ化の後にパスワードを直ちに更新し、完了メールを送って操作した端末にだけ新しいセッションを発行する', async () => {
    const { passwordChange, recorded } = setupAdminPasswordChange();

    const result = await passwordChange.change(
      currentAdminOf(),
      CHANGE_INPUT,
      META,
    );

    expect(result).toEqual({ session: ISSUED_SESSION });
    expect(recorded.calls).toEqual([
      'admins.findById',
      'reAuthenticator.verify',
      'policy.validateNewPassword',
      'password.hash',
      'admins.applyPasswordChange',
      'mailer.sendPasswordChanged',
      'sessions.issue',
    ]);
    expect(recorded.reAuthentications).toEqual([
      { admin: adminOf(), input: RE_AUTHENTICATION, meta: META },
    ]);
    expect(recorded.policyChecks).toEqual([
      {
        password: NEW_PASSWORD,
        identifiers: { nickname: NICKNAME, email: EMAIL },
      },
    ]);
    expect(recorded.passwordChanges).toEqual([
      { adminId: ADMIN_ID, passwordHash: storedHashOf(NEW_PASSWORD) },
    ]);
    expect(recorded.mails).toEqual([
      { method: 'sendPasswordChanged', args: [adminOf(), NOW] },
    ]);
    expect(recorded.sessionIssues).toEqual([{ adminId: ADMIN_ID, meta: META }]);
  });

  test('全セッションの削除は管理者のストアの1回のapplyPasswordChangeに任せ、確認のリンクを作らない', async () => {
    const { passwordChange, recorded } = setupAdminPasswordChange();

    await passwordChange.change(currentAdminOf(), CHANGE_INPUT, META);

    expect(recorded.passwordChanges).toHaveLength(1);
    expect(recorded.issued).toEqual([]);
    expect(recorded.calls).not.toContain('tokens.replace');
  });

  test('本人確認に失敗したら例外をそのまま投げ、方針の確認も更新もしない', async () => {
    const { passwordChange, recorded } = setupAdminPasswordChange({
      reAuthError: REAUTHENTICATION_FAILED,
    });

    const error = await caught(
      passwordChange.change(currentAdminOf(), CHANGE_INPUT, META),
    );

    expect(error).toBe(REAUTHENTICATION_FAILED);
    expect(error.details).toEqual([
      expect.objectContaining({ field: 'currentPassword' }),
    ]);
    expect(recorded.calls).toEqual([
      'admins.findById',
      'reAuthenticator.verify',
    ]);
    expect(recorded.passwordChanges).toEqual([]);
    expect(recorded.mails).toEqual([]);
    expect(recorded.sessionIssues).toEqual([]);
  });

  test('方針に反したパスワードは、新しいパスワードの欄のpassword_rejectedで拒否し、更新しない', async () => {
    const { passwordChange, recorded } = setupAdminPasswordChange({
      validation: { ok: false, violation: 'too-short' },
    });

    const error = await caught(
      passwordChange.change(currentAdminOf(), CHANGE_INPUT, META),
    );

    expect(error.kind).toBe('unprocessable');
    expect(error.code).toBe('password_rejected');
    expect(error.details).toEqual([
      expect.objectContaining({ field: 'newPassword', code: 'too_short' }),
    ]);
    expect(recorded.calls).not.toContain('password.hash');
    expect(recorded.passwordChanges).toEqual([]);
    expect(recorded.sessionIssues).toEqual([]);
  });

  test('漏洩の照合を省いたときも変更する', async () => {
    const { passwordChange, recorded } = setupAdminPasswordChange({
      validation: { ok: true, pwnedCheck: 'skipped' },
    });

    await passwordChange.change(currentAdminOf(), CHANGE_INPUT, META);

    expect(recorded.passwordChanges).toHaveLength(1);
  });

  test.each([
    ['存在しない', []],
    ['招待中の', [invitedAdminOf()]],
  ] as const)(
    '操作者が%s管理者になっていたら、本人確認をせずunauthenticatedで拒否する',
    async (_label, admins) => {
      const { passwordChange, recorded } = setupAdminPasswordChange({
        admins,
      });

      const error = await caught(
        passwordChange.change(currentAdminOf(), CHANGE_INPUT, META),
      );

      expect(shapeOf(error)).toEqual(UNAUTHENTICATED);
      expect(recorded.calls).toEqual(['admins.findById']);
    },
  );

  test('完了メールの送信要求に失敗しても、変更は完了しているため操作した端末へ発行して成功を返す', async () => {
    const { passwordChange, recorded } = setupAdminPasswordChange({
      mailError: new Error('送信の基盤の障害'),
    });

    const result = await passwordChange.change(
      currentAdminOf(),
      CHANGE_INPUT,
      META,
    );

    expect(result).toEqual({ session: ISSUED_SESSION });
    expect(recorded.passwordChanges).toHaveLength(1);
  });

  test('パスワードの更新に失敗したら、例外をそのまま投げてメールもセッションの発行もしない', async () => {
    const failure = new Error('D1の障害');
    const { passwordChange, recorded } = setupAdminPasswordChange({
      applyError: failure,
    });

    const error = await rejectionOf(
      passwordChange.change(currentAdminOf(), CHANGE_INPUT, META),
    );

    expect(error).toBe(failure);
    expect(recorded.mails).toEqual([]);
    expect(recorded.sessionIssues).toEqual([]);
  });
});
