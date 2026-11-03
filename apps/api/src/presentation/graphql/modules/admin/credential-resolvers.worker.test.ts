import { describe, expect, test } from 'vitest';

import {
  insertEmailChangeToken,
  insertInvitation,
  lastAdminMailOf,
  prepareActiveAdmin,
  type PreparedAdmin,
  sentAdminMails,
} from '../../../../../test/support/admin-graphql-harness.ts';
import {
  ADMIN_BOT_ACTION_NAMES,
  ADMIN_PASSWORD,
  adminLogin,
  type AdminTotpSetupFields,
  type AdminViewerFields,
  challengeOf,
  codesOf,
  COMPLETE_ADMIN_INVITATION,
  COMPLETE_ADMIN_SECOND_FACTOR_LOGIN,
  CONFIRM_ADMIN_EMAIL_CHANGE,
  currentTotpCode,
  detailsOf,
  fetchAdminViewer,
  installAdminGraphQLTest,
  NEW_ADMIN_PASSWORD,
  REQUEST_ADMIN_PASSWORD_RESET,
  RESET_ADMIN_PASSWORD,
  SESSION_TOKEN_PATTERN,
  START_ADMIN_INVITATION,
  uniqueAdminEmail,
} from '../../../../../test/support/admin-graphql-operations.ts';
import {
  botTokenFor,
  stubExternalServices,
} from '../../../../../test/support/graphql-gateway.ts';
import {
  adminEmailOf,
  adminIdOf,
} from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';

const { gateway } = installAdminGraphQLTest();

const ADMIN = 1;

const INVITED = 2;

const OTHER_ADMIN = 3;

const INVALID_LINK_MESSAGE = 'このリンクは無効か、有効期限が切れています。';

const NICKNAME = '運営の担当者';

const SHORT_PASSWORD = ['sh', 'ort'].join('');

function prepareAdmin(index = ADMIN): Promise<PreparedAdmin> {
  return prepareActiveAdmin(index, { password: ADMIN_PASSWORD });
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

function requestReset(email: string) {
  return gateway.call<{ requestAdminPasswordReset: boolean }>(
    REQUEST_ADMIN_PASSWORD_RESET,
    { email },
    { botToken: botTokenFor(ADMIN_BOT_ACTION_NAMES.passwordReset) },
  );
}

function startInvitation(
  token: string,
  overrides: { readonly nickname?: string; readonly password?: string } = {},
) {
  return gateway.call<{ startAdminInvitation: AdminTotpSetupFields }>(
    START_ADMIN_INVITATION,
    { token, nickname: NICKNAME, password: ADMIN_PASSWORD, ...overrides },
  );
}

function completeInvitation(token: string, totpCode: string) {
  return gateway.call<{
    completeAdminInvitation: { readonly codes: readonly string[] };
  }>(COMPLETE_ADMIN_INVITATION, { token, totpCode });
}

function confirmEmailChange(token: string, sessionToken?: string) {
  return gateway.call<{
    confirmAdminEmailChange: { readonly viewer: AdminViewerFields | null };
  }>(
    CONFIRM_ADMIN_EMAIL_CHANGE,
    { token },
    sessionToken === undefined ? {} : { sessionToken },
  );
}

describe('requestAdminPasswordReset', () => {
  test('有効な管理者・未登録・招待中のどれでも同じ応答を返し、有効な管理者にだけリンクを送る', async () => {
    stubExternalServices();
    const admin = await prepareAdmin();
    await insertInvitation(INVITED);
    sentAdminMails.splice(0);

    const responses = [
      await requestReset(admin.email),
      await requestReset(uniqueAdminEmail('unknown')),
      await requestReset(adminEmailOf(INVITED)),
    ];

    for (const response of responses) {
      expect(response.errors).toBeUndefined();
      expect(response.data).toEqual({ requestAdminPasswordReset: true });
    }
    expect(sentAdminMails).toEqual([
      expect.objectContaining({ kind: 'password-reset', to: admin.email }),
    ]);
  });

  test('メールアドレスの形式の誤りは、bot判定の前に欄ごとの詳細で返す', async () => {
    const calls = stubExternalServices();

    const response = await requestReset('not-an-address');

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'email',
        message: 'メールアドレスの形式が正しくありません。',
      }),
    ]);
    expect(calls.siteverifyTokens).toEqual([]);
  });
});

describe('resetAdminPassword', () => {
  test('リンクのトークンで新しいパスワードを設定し、既存のセッションを無効にする', async () => {
    stubExternalServices();
    const admin = await prepareAdmin();
    const sessionToken = await signIn(admin);
    await requestReset(admin.email);
    const token = lastAdminMailOf('password-reset').token;

    const response = await gateway.call(RESET_ADMIN_PASSWORD, {
      token,
      newPassword: NEW_ADMIN_PASSWORD,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data).toEqual({ resetAdminPassword: true });
    expect(lastAdminMailOf('password-reset-completed').to).toBe(admin.email);
    const viewer = await fetchAdminViewer(gateway, sessionToken);
    expect(viewer.data?.adminViewer).toBeNull();
    const login = await adminLogin(gateway, admin.email, NEW_ADMIN_PASSWORD);
    expect(login.errors).toBeUndefined();
  });

  test('無効なリンクはinvalid_linkで拒否する', async () => {
    stubExternalServices();

    const response = await gateway.call(RESET_ADMIN_PASSWORD, {
      token: 'x'.repeat(43),
      newPassword: NEW_ADMIN_PASSWORD,
    });

    expect(codesOf(response)).toEqual(['invalid_link']);
    expect(response.errors?.[0]?.message).toBe(INVALID_LINK_MESSAGE);
  });

  test('短すぎるパスワードは欄ごとの詳細で返す', async () => {
    const response = await gateway.call(RESET_ADMIN_PASSWORD, {
      token: 'x'.repeat(43),
      newPassword: SHORT_PASSWORD,
    });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'newPassword',
        message: 'パスワードは8文字以上128文字以内で入力してください。',
      }),
    ]);
  });
});

describe('startAdminInvitation・completeAdminInvitation', () => {
  test('ニックネームとパスワードの後に認証コードで完了し、リカバリコードとセッションの発行の指示を返す', async () => {
    stubExternalServices();
    const token = await insertInvitation(INVITED);

    const started = await startInvitation(token);

    expect(started.errors).toBeUndefined();
    expect(started.issuedToken).toBeUndefined();
    const setup = started.data?.startAdminInvitation;
    if (setup === undefined) {
      throw new Error('多要素認証の設定を始められませんでした');
    }
    expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\//u);
    expect(Date.parse(setup.expiresAt)).toBeGreaterThan(Date.now());

    const completed = await completeInvitation(
      token,
      currentTotpCode(setup.secret),
    );

    expect(completed.errors).toBeUndefined();
    expect(
      completed.data?.completeAdminInvitation.codes.length,
    ).toBeGreaterThan(0);
    expect(completed.issuedToken).toMatch(SESSION_TOKEN_PATTERN);
    const viewer = await fetchAdminViewer(gateway, completed.issuedToken);
    expect(viewer.data?.adminViewer).toMatchObject({
      id: adminIdOf(INVITED),
      nickname: NICKNAME,
      role: 'VIEWER',
    });
    const reused = await completeInvitation(
      token,
      currentTotpCode(setup.secret),
    );
    expect(codesOf(reused)).toEqual(['invalid_link']);
  });

  test('誤った認証コードではトークンを消費せず、正しい認証コードで完了できる', async () => {
    stubExternalServices();
    const token = await insertInvitation(INVITED);
    const setup = (await startInvitation(token)).data?.startAdminInvitation;
    if (setup === undefined) {
      throw new Error('多要素認証の設定を始められませんでした');
    }

    const wrong = await completeInvitation(token, '000000');
    const completed = await completeInvitation(
      token,
      currentTotpCode(setup.secret),
    );

    expect(codesOf(wrong)).toEqual(['invalid_second_factor']);
    expect(wrong.issuedToken).toBeUndefined();
    expect(completed.errors).toBeUndefined();
  });

  test.each([
    {
      label: '空',
      nickname: '  ',
      message: 'ニックネームを入力してください。',
    },
    {
      label: '26書記素',
      nickname: 'あ'.repeat(26),
      message: 'ニックネームは25文字以内で入力してください。',
    },
  ])(
    'ニックネームが$labelなら欄ごとの詳細で返す',
    async ({ nickname, message }) => {
      const response = await startInvitation('x'.repeat(43), { nickname });

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({ field: 'nickname', message }),
      ]);
    },
  );

  test('ニックネームと同じパスワードは、管理者の文言の詳細で拒否する', async () => {
    stubExternalServices();
    const token = await insertInvitation(INVITED);
    const nickname = 'launchoperator';

    const response = await startInvitation(token, {
      nickname,
      password: nickname,
    });

    expect(codesOf(response)).toEqual(['password_rejected']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'password',
        code: 'matches_identity',
        message:
          'ニックネーム・メールアドレス(@より前の部分を含む)と同じパスワードは使えません。',
      }),
    ]);
  });

  test('無効な招待のリンクは再送の依頼を添えてinvalid_linkで拒否する', async () => {
    const started = await startInvitation('x'.repeat(43));
    const completed = await completeInvitation('x'.repeat(43), '123456');

    for (const response of [started, completed]) {
      expect(codesOf(response)).toEqual(['invalid_link']);
      expect(response.errors?.[0]?.message).toBe(
        `${INVALID_LINK_MESSAGE}招待した管理者に再送を依頼してください。`,
      );
    }
  });
});

describe('confirmAdminEmailChange', () => {
  const NEW_EMAIL = 'renamed@mail.example';

  test('操作した端末が同じ管理者としてログイン中なら、セッションを発行し直して変更後の管理者を返す', async () => {
    stubExternalServices();
    const admin = await prepareAdmin();
    const sessionToken = await signIn(admin);
    const token = await insertEmailChangeToken(admin.adminId, NEW_EMAIL);

    const response = await confirmEmailChange(token, sessionToken);

    expect(response.errors).toBeUndefined();
    expect(response.data?.confirmAdminEmailChange.viewer).toMatchObject({
      id: admin.adminId,
      email: NEW_EMAIL,
    });
    expect(response.issuedToken).toMatch(SESSION_TOKEN_PATTERN);
    expect(response.issuedToken).not.toBe(sessionToken);
    expect(lastAdminMailOf('email-changed').to).toBe(admin.email);
    const previous = await fetchAdminViewer(gateway, sessionToken);
    expect(previous.data?.adminViewer).toBeNull();
    const renewed = await fetchAdminViewer(gateway, response.issuedToken);
    expect(renewed.data?.adminViewer?.email).toBe(NEW_EMAIL);
  });

  test.each([
    { label: 'ログインしていない', signedInAs: undefined },
    { label: '別の管理者としてログイン中', signedInAs: OTHER_ADMIN },
  ])(
    '$label端末では変更を確定し、セッションを発行せずに管理者を返さない',
    async ({ signedInAs }) => {
      stubExternalServices();
      const admin = await prepareAdmin();
      const sessionToken =
        signedInAs === undefined
          ? undefined
          : await signIn(await prepareAdmin(signedInAs));
      const token = await insertEmailChangeToken(admin.adminId, NEW_EMAIL);

      const response = await confirmEmailChange(token, sessionToken);

      expect(response.errors).toBeUndefined();
      expect(response.data?.confirmAdminEmailChange).toEqual({ viewer: null });
      expect(response.issuedToken).toBeUndefined();
      expect(lastAdminMailOf('email-changed').to).toBe(admin.email);
    },
  );

  test('無効なリンクはinvalid_linkで拒否する', async () => {
    const response = await confirmEmailChange('x'.repeat(43));

    expect(codesOf(response)).toEqual(['invalid_link']);
    expect(response.errors?.[0]?.message).toBe(INVALID_LINK_MESSAGE);
  });
});
