import { describe, expect, test } from 'vitest';

import {
  clearMediaTables,
  fileIdOf,
  insertFile,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  insertInvitation,
  issueAdminSession,
  prepareActiveAdmin,
  type PreparedAdmin,
} from '../../../../../test/support/admin-graphql-harness.ts';
import {
  ADMIN_BOT_ACTION_NAMES,
  ADMIN_LOGIN,
  ADMIN_LOGOUT,
  ADMIN_PASSWORD,
  ADMIN_VIEWER,
  adminLogin,
  type AdminViewerFields,
  challengeOf,
  codesOf,
  COMPLETE_ADMIN_SECOND_FACTOR_LOGIN,
  CONFIRM_ADMIN_EMAIL_CHANGE,
  COMPLETE_ADMIN_INVITATION,
  currentTotpCode,
  detailsOf,
  fetchAdminViewer,
  installAdminGraphQLTest,
  REQUEST_ADMIN_PASSWORD_RESET,
  RESET_ADMIN_PASSWORD,
  SESSION_TOKEN_PATTERN,
  START_ADMIN_INVITATION,
  uniqueAdminEmail,
  WRONG_ADMIN_PASSWORD,
} from '../../../../../test/support/admin-graphql-operations.ts';
import {
  BOT_REJECTED_TOKEN,
  BOT_UNREACHABLE_TOKEN,
  botTokenFor,
  randomClientIp,
  stubExternalServices,
} from '../../../../../test/support/graphql-gateway.ts';
import {
  adminIdOf,
  insertAdmin,
} from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';

const { gateway, logs } = installAdminGraphQLTest();

const ADMIN = 1;

const LOGIN_CATEGORY = 'api.admin.login';

const LOGIN_FAILURES_BEFORE_LOCK = 6;

function loginLogs() {
  return logs().filter((log) => log.category === LOGIN_CATEGORY);
}

function prepareAdmin(index = ADMIN): Promise<PreparedAdmin> {
  return prepareActiveAdmin(index, {
    password: ADMIN_PASSWORD,
    role: 'moderator',
  });
}

async function signIn(admin: PreparedAdmin): Promise<string> {
  const challenge = await challengeOf(gateway, admin.email, ADMIN_PASSWORD);
  const response = await gateway.call(COMPLETE_ADMIN_SECOND_FACTOR_LOGIN, {
    challenge,
    secondFactor: { totpCode: currentTotpCode(admin.totpSecret) },
  });
  if (response.issuedToken === undefined) {
    throw new Error('ログインできませんでした');
  }
  return response.issuedToken;
}

describe('adminLogin', () => {
  test('有効な管理者のパスワードが一致しても、セッションを発行せずに第2要素の入力を求め、段階の通過をログに残す', async () => {
    const calls = stubExternalServices();
    const admin = await prepareAdmin();

    const response = await adminLogin(gateway, admin.email, ADMIN_PASSWORD);

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminLogin?.challenge).toMatch(SESSION_TOKEN_PATTERN);
    expect(
      Date.parse(response.data?.adminLogin?.expiresAt ?? ''),
    ).toBeGreaterThan(Date.now());
    expect(response.issuedToken).toBeUndefined();
    expect(calls.siteverifyTokens).toEqual([
      botTokenFor(ADMIN_BOT_ACTION_NAMES.login),
    ]);
    expect(loginLogs()).toEqual([
      expect.objectContaining({
        level: 'info',
        outcome: 'second-factor-required',
        adminId: admin.adminId,
      }),
    ]);
    expect(JSON.stringify(loginLogs())).not.toContain(admin.email);
  });

  test('パスワードの誤り・未登録・招待中を区別しない失敗で拒否し、理由をログに残す', async () => {
    stubExternalServices();
    const admin = await prepareAdmin();
    await insertInvitation(2);

    const responses = [
      await adminLogin(gateway, admin.email, WRONG_ADMIN_PASSWORD),
      await adminLogin(gateway, uniqueAdminEmail('unknown'), ADMIN_PASSWORD),
      await adminLogin(gateway, 'admin2@mail.example', ADMIN_PASSWORD),
    ];

    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(codesOf(response)).toEqual(['invalid_credentials']);
      expect(response.errors?.[0]?.message).toBe(
        'メールアドレスまたはパスワードが正しくありません。',
      );
      expect(response.issuedToken).toBeUndefined();
    }
    expect(loginLogs().map(({ level, reason }) => ({ level, reason }))).toEqual(
      Array.from({ length: 3 }, () => ({
        level: 'warning',
        reason: 'invalid_credentials',
      })),
    );
  });

  test('失敗が続いてロック中なら、429と再試行の待ち時間で拒否する', async () => {
    stubExternalServices();
    const admin = await prepareAdmin(31);
    const clientIp = randomClientIp();

    for (let attempt = 0; attempt < LOGIN_FAILURES_BEFORE_LOCK; attempt += 1) {
      await adminLogin(gateway, admin.email, WRONG_ADMIN_PASSWORD, {
        clientIp,
      });
    }
    const response = await adminLogin(gateway, admin.email, ADMIN_PASSWORD, {
      clientIp,
    });

    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(codesOf(response)).toEqual(['login_throttled']);
    expect(response.errors?.[0]?.message).toBe(
      'ログイン試行が続いたため、しばらく待ってから再度お試しください。',
    );
    expect(loginLogs().at(-1)).toMatchObject({ reason: 'login_throttled' });
  });

  test.each([
    {
      label: 'メールアドレスの形式',
      variables: { email: 'not-an-address', password: ADMIN_PASSWORD },
      field: 'email',
      message: 'メールアドレスの形式が正しくありません。',
    },
    {
      label: 'パスワードの未入力',
      variables: { email: uniqueAdminEmail('empty'), password: '' },
      field: 'password',
      message: 'パスワードを入力してください。',
    },
  ])(
    '$labelの誤りは、bot判定の前に欄ごとの詳細で返す',
    async ({ variables, field, message }) => {
      const calls = stubExternalServices();

      const response = await gateway.call(ADMIN_LOGIN, variables, {
        botToken: botTokenFor(ADMIN_BOT_ACTION_NAMES.login),
      });

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({ field, message }),
      ]);
      expect(calls.siteverifyTokens).toEqual([]);
    },
  );
});

describe('completeAdminSecondFactorLogin', () => {
  test('正しい認証コードでセッションの発行を指示し、ログイン中の管理者を返す', async () => {
    stubExternalServices();
    const admin = await prepareAdmin();
    const challenge = await challengeOf(gateway, admin.email, ADMIN_PASSWORD);

    const response = await gateway.call<{
      completeAdminSecondFactorLogin: AdminViewerFields;
    }>(COMPLETE_ADMIN_SECOND_FACTOR_LOGIN, {
      challenge,
      secondFactor: { totpCode: currentTotpCode(admin.totpSecret) },
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.completeAdminSecondFactorLogin).toEqual({
      id: admin.adminId,
      nickname: '管理者1',
      title: null,
      email: admin.email,
      role: 'MODERATOR',
      avatar: null,
      remainingRecoveryCodes: admin.recoveryCodes.length,
    });
    expect(response.issuedToken).toMatch(SESSION_TOKEN_PATTERN);
    expect(loginLogs().at(-1)).toMatchObject({
      level: 'info',
      outcome: 'authenticated',
      adminId: admin.adminId,
    });
    const viewer = await fetchAdminViewer(gateway, response.issuedToken);
    expect(viewer.data?.adminViewer?.id).toBe(admin.adminId);
  });

  test('リカバリコードでログインするとそのコードを消費する', async () => {
    stubExternalServices();
    const admin = await prepareAdmin();
    const challenge = await challengeOf(gateway, admin.email, ADMIN_PASSWORD);

    const response = await gateway.call<{
      completeAdminSecondFactorLogin: AdminViewerFields;
    }>(COMPLETE_ADMIN_SECOND_FACTOR_LOGIN, {
      challenge,
      secondFactor: { recoveryCode: admin.recoveryCodes[0] },
    });

    expect(response.errors).toBeUndefined();
    expect(
      response.data?.completeAdminSecondFactorLogin.remainingRecoveryCodes,
    ).toBe(admin.recoveryCodes.length - 1);
    expect(response.issuedToken).toMatch(SESSION_TOKEN_PATTERN);
  });

  test('誤った認証コードはセッションを発行せずに拒否し、理由をログに残す', async () => {
    stubExternalServices();
    const admin = await prepareAdmin();
    const challenge = await challengeOf(gateway, admin.email, ADMIN_PASSWORD);

    const response = await gateway.call(COMPLETE_ADMIN_SECOND_FACTOR_LOGIN, {
      challenge,
      secondFactor: { totpCode: '000000' },
    });

    expect(codesOf(response)).toEqual(['invalid_second_factor']);
    expect(response.issuedToken).toBeUndefined();
    expect(loginLogs().at(-1)).toMatchObject({
      level: 'warning',
      reason: 'invalid_second_factor',
    });
  });

  test.each([
    { label: 'どちらも無い', secondFactor: {} },
    {
      label: '両方ある',
      secondFactor: { totpCode: '123456', recoveryCode: 'abcd'.repeat(4) },
    },
  ])(
    '認証コードとリカバリコードが$labelなら、入力の誤りとして返す',
    async ({ secondFactor }) => {
      const response = await gateway.call(COMPLETE_ADMIN_SECOND_FACTOR_LOGIN, {
        challenge: 'x'.repeat(43),
        secondFactor,
      });

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({
          field: 'secondFactor',
          message:
            '認証コードかリカバリコードのどちらか一方を入力してください。',
        }),
      ]);
    },
  );

  test('無効な待ちの値は期限切れとして拒否する', async () => {
    const response = await gateway.call(COMPLETE_ADMIN_SECOND_FACTOR_LOGIN, {
      challenge: 'x'.repeat(43),
      secondFactor: { totpCode: '123456' },
    });

    expect(codesOf(response)).toEqual(['login_challenge_expired']);
  });
});

describe('adminViewer', () => {
  test('ログインしていなければnullを返す', async () => {
    const response = await fetchAdminViewer(gateway, undefined);

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminViewer).toBeNull();
  });

  test('プロフィール画像があれば画像を返す', async () => {
    await clearMediaTables();
    await insertFile(1);
    await insertAdmin(ADMIN, {
      role: 'super_admin',
      title: '運営責任者',
      avatarFileId: fileIdOf(1),
    });
    const session = await issueAdminSession(adminIdOf(ADMIN));

    const response = await fetchAdminViewer(gateway, session.token);

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminViewer).toMatchObject({
      role: 'SUPER_ADMIN',
      title: '運営責任者',
      avatar: { id: fileIdOf(1) },
      remainingRecoveryCodes: 0,
    });
  });
});

describe('adminLogout', () => {
  test('この端末のセッションを削除してCookieの削除を指示する', async () => {
    stubExternalServices();
    const admin = await prepareAdmin();
    const sessionToken = await signIn(admin);

    const response = await gateway.call(ADMIN_LOGOUT, {}, { sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data).toEqual({ adminLogout: true });
    expect(response.cleared).toBe(true);
    const viewer = await fetchAdminViewer(gateway, sessionToken);
    expect(viewer.data?.adminViewer).toBeNull();
  });

  test('ログインしていなければ削除を指示せずにunauthenticatedで拒否する', async () => {
    const response = await gateway.call(ADMIN_LOGOUT, {});

    expect(codesOf(response)).toEqual(['unauthenticated']);
    expect(response.cleared).toBe(false);
  });
});

describe('bot判定', () => {
  const BOT_PROTECTED = [
    {
      name: 'adminLogin',
      document: ADMIN_LOGIN,
      action: ADMIN_BOT_ACTION_NAMES.login,
      variables: () => ({
        email: uniqueAdminEmail('bot'),
        password: ADMIN_PASSWORD,
      }),
    },
    {
      name: 'requestAdminPasswordReset',
      document: REQUEST_ADMIN_PASSWORD_RESET,
      action: ADMIN_BOT_ACTION_NAMES.passwordReset,
      variables: () => ({ email: uniqueAdminEmail('bot') }),
    },
  ];

  test.each(BOT_PROTECTED)(
    '$nameはbot判定に失敗すると403の種類のエラーで拒否する',
    async ({ document, variables }) => {
      stubExternalServices();

      const response = await gateway.call(document, variables(), {
        botToken: BOT_REJECTED_TOKEN,
      });

      expect(response.status).toBe(200);
      expect(codesOf(response)).toEqual(['bot_verification_failed']);
      expect(response.issuedToken).toBeUndefined();
    },
  );

  test.each(BOT_PROTECTED)(
    '$nameは利用者側の操作名のbot判定の結果を受け付けない',
    async ({ document, variables }) => {
      stubExternalServices();

      const response = await gateway.call(document, variables(), {
        botToken: botTokenFor('login'),
      });

      expect(codesOf(response)).toEqual(['bot_verification_failed']);
    },
  );

  test.each(BOT_PROTECTED)(
    '$nameはbot判定のサービスに到達できなければ503で拒否する',
    async ({ document, variables }) => {
      stubExternalServices();

      const response = await gateway.call(document, variables(), {
        botToken: BOT_UNREACHABLE_TOKEN,
      });

      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).not.toBeNull();
      expect(codesOf(response)).toEqual(['bot_verification_unavailable']);
    },
  );
});

describe('呼び出し元', () => {
  const token = 'x'.repeat(43);

  test.each([
    { name: 'adminViewer', document: ADMIN_VIEWER, variables: {} },
    {
      name: 'adminLogin',
      document: ADMIN_LOGIN,
      variables: {
        email: uniqueAdminEmail('client'),
        password: ADMIN_PASSWORD,
      },
    },
    {
      name: 'completeAdminSecondFactorLogin',
      document: COMPLETE_ADMIN_SECOND_FACTOR_LOGIN,
      variables: { challenge: token, secondFactor: { totpCode: '123456' } },
    },
    { name: 'adminLogout', document: ADMIN_LOGOUT, variables: {} },
    {
      name: 'requestAdminPasswordReset',
      document: REQUEST_ADMIN_PASSWORD_RESET,
      variables: { email: uniqueAdminEmail('client') },
    },
    {
      name: 'resetAdminPassword',
      document: RESET_ADMIN_PASSWORD,
      variables: { token, newPassword: ADMIN_PASSWORD },
    },
    {
      name: 'startAdminInvitation',
      document: START_ADMIN_INVITATION,
      variables: { token, nickname: '運営', password: ADMIN_PASSWORD },
    },
    {
      name: 'completeAdminInvitation',
      document: COMPLETE_ADMIN_INVITATION,
      variables: { token, totpCode: '123456' },
    },
    {
      name: 'confirmAdminEmailChange',
      document: CONFIRM_ADMIN_EMAIL_CHANGE,
      variables: { token },
    },
  ])(
    '利用者側の呼び出し元からの$nameは、入力の検証とbot判定の前にforbiddenで拒否する',
    async ({ document, variables }) => {
      const calls = stubExternalServices();

      const response = await gateway.call(document, variables, {
        caller: 'client',
        botToken: botTokenFor(ADMIN_BOT_ACTION_NAMES.login),
      });

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(response.errors?.[0]?.message).toBe('この操作はできません。');
      expect(calls.siteverifyTokens).toEqual([]);
      expect(response.issuedToken).toBeUndefined();
    },
  );
});
