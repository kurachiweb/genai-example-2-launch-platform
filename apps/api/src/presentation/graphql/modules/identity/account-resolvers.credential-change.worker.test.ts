import { describe, expect, test } from 'vitest';

import {
  BOT_REJECTED_TOKEN,
  BOT_UNREACHABLE_TOKEN,
  botTokenFor,
  enableTotpWithRecoveryCodes,
  lastMailOf,
  sentMails,
  stubExternalServices,
  suspendUser,
  uniqueEmail,
} from '../../../../../test/support/identity-graphql-harness.ts';
import {
  ACCOUNT_OPERATIONS,
  codesOf,
  CONFIRM_EMAIL_CHANGE,
  CONFIRM_PASSWORD_CHANGE,
  type ConfirmationFields,
  detailsOf,
  fetchViewer,
  installIdentityGraphQLTest,
  login,
  NEW_PASSWORD,
  PASSWORD,
  reAuthenticationInput,
  register,
  REQUEST_EMAIL_CHANGE,
  REQUEST_PASSWORD_CHANGE,
  SECURITY_OPERATIONS,
  SESSION_TOKEN_PATTERN,
  WITHDRAW,
  WRONG_PASSWORD,
} from '../../../../../test/support/identity-graphql-operations.ts';

const { gateway } = installIdentityGraphQLTest([
  ...ACCOUNT_OPERATIONS,
  ...SECURITY_OPERATIONS,
]);

const RECOVERY_CODE = 'abcd'.repeat(4);

const UNKNOWN_RECOVERY_CODE = 'wxyz'.repeat(4);

const CURRENT_PASSWORD_INCORRECT = '現在のパスワードが正しくありません。';

const SECOND_FACTOR_INCORRECT = '認証コードが正しくありません。';

function requestEmailChange(
  sessionToken: string,
  newEmail: string,
  reAuthentication = reAuthenticationInput(PASSWORD),
) {
  return gateway.call(
    REQUEST_EMAIL_CHANGE,
    { input: { newEmail, reAuthentication } },
    { sessionToken, botToken: botTokenFor('email_change') },
  );
}

function requestPasswordChange(
  sessionToken: string,
  newPassword: string,
  reAuthentication = reAuthenticationInput(PASSWORD),
) {
  return gateway.call(
    REQUEST_PASSWORD_CHANGE,
    { input: { newPassword, reAuthentication } },
    { sessionToken, botToken: botTokenFor('password_change') },
  );
}

describe('requestEmailChange・confirmEmailChange', () => {
  test('新しいメールアドレスの重複の有無を問わず同じ応答を返し、重複しないときだけ確認メールを送る', async () => {
    stubExternalServices();
    const user = await register(gateway);
    const other = await register(gateway);
    sentMails.splice(0);

    const duplicated = await requestEmailChange(user.sessionToken, other.email);
    const fresh = await requestEmailChange(
      user.sessionToken,
      uniqueEmail('changed'),
    );

    expect(duplicated.status).toBe(fresh.status);
    expect(duplicated.data).toEqual({ requestEmailChange: true });
    expect(fresh.data).toEqual({ requestEmailChange: true });
    expect(duplicated.errors).toBeUndefined();
    expect(fresh.issuedToken).toBeUndefined();
    expect(sentMails.map(({ kind }) => kind)).toEqual([
      'email-change-confirmation',
    ]);
  });

  test('確定の操作をした端末が同じ利用者なら、入れ替えたセッションの発行を指示して変更後の利用者を返す', async () => {
    stubExternalServices();
    const user = await register(gateway);
    const newEmail = uniqueEmail('changed');
    await requestEmailChange(user.sessionToken, newEmail);
    const { token } = lastMailOf('email-change-confirmation');

    const response = await gateway.call<{
      confirmEmailChange: ConfirmationFields;
    }>(CONFIRM_EMAIL_CHANGE, { token }, { sessionToken: user.sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.confirmEmailChange.viewer).toMatchObject({
      id: user.viewer.id,
      email: newEmail,
      emailVerified: true,
    });
    expect(response.issuedToken).toMatch(SESSION_TOKEN_PATTERN);
    expect(lastMailOf('email-changed').userId).toBe(user.viewer.id);
    expect((await fetchViewer(gateway, user.sessionToken)).data).toEqual({
      viewer: null,
    });
    const reissued = await fetchViewer(gateway, response.issuedToken);
    expect(reissued.data?.viewer?.email).toBe(newEmail);
  });

  test('ログインしていない端末で確定すると、セッションを発行せずに利用者を返さない', async () => {
    stubExternalServices();
    const user = await register(gateway);
    await requestEmailChange(user.sessionToken, uniqueEmail('changed'));
    const { token } = lastMailOf('email-change-confirmation');

    const response = await gateway.call<{
      confirmEmailChange: ConfirmationFields;
    }>(CONFIRM_EMAIL_CHANGE, { token });

    expect(response.data).toEqual({ confirmEmailChange: { viewer: null } });
    expect(response.issuedToken).toBeUndefined();
  });

  test('無効なリンクは定めた文言で拒否する', async () => {
    stubExternalServices();

    const response = await gateway.call(CONFIRM_EMAIL_CHANGE, {
      token: 'x'.repeat(43),
    });

    expect(codesOf(response)).toEqual(['invalid_link']);
    expect(response.errors?.[0]?.message).toBe(
      'このリンクは無効か、有効期限が切れています。',
    );
  });

  test('新しいメールアドレスの形式の誤りは、入力の形のとおりの経路で返す', async () => {
    const calls = stubExternalServices();
    const user = await register(gateway);
    calls.siteverifyTokens.splice(0);

    const response = await requestEmailChange(user.sessionToken, 'not-mail');

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'input.newEmail',
        message: 'メールアドレスの形式が正しくありません。',
      }),
    ]);
    expect(calls.siteverifyTokens).toEqual([]);
  });
});

describe('本人確認の失敗の詳細の経路', () => {
  test('現在のパスワードの誤りは、本人確認の入力の中の経路で返す', async () => {
    stubExternalServices();
    const user = await register(gateway);
    sentMails.splice(0);

    const response = await requestEmailChange(
      user.sessionToken,
      uniqueEmail('changed'),
      reAuthenticationInput(WRONG_PASSWORD),
    );

    expect(codesOf(response)).toEqual(['reauthentication_failed']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'input.reAuthentication.currentPassword',
        code: 'incorrect',
        message: CURRENT_PASSWORD_INCORRECT,
      },
    ]);
    expect(sentMails).toEqual([]);
  });

  test.each([
    {
      label: '第2要素が無い',
      secondFactor: undefined,
      field: 'input.reAuthentication.secondFactor',
      code: 'required',
    },
    {
      label: '認証コードが誤り',
      secondFactor: { totpCode: '000000' },
      field: 'input.reAuthentication.secondFactor.totpCode',
      code: 'incorrect',
    },
    {
      label: 'リカバリコードが誤り',
      secondFactor: { recoveryCode: UNKNOWN_RECOVERY_CODE },
      field: 'input.reAuthentication.secondFactor.recoveryCode',
      code: 'incorrect',
    },
  ])(
    '多要素認証が有効な利用者の$labelなら、その欄の経路で返す',
    async ({ secondFactor, field, code }) => {
      stubExternalServices();
      const user = await register(gateway);
      await enableTotpWithRecoveryCodes(user.viewer.id, [RECOVERY_CODE]);

      const response = await requestPasswordChange(
        user.sessionToken,
        NEW_PASSWORD,
        reAuthenticationInput(PASSWORD, secondFactor),
      );

      expect(codesOf(response)).toEqual(['reauthentication_failed']);
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({ field, code }),
      ]);
    },
  );

  test('入力が本人確認の入力そのものの操作は、入力の直下の経路で返す', async () => {
    stubExternalServices();
    const user = await register(gateway);

    const response = await gateway.call(
      WITHDRAW,
      { input: reAuthenticationInput(WRONG_PASSWORD) },
      { sessionToken: user.sessionToken, botToken: botTokenFor('withdraw') },
    );

    expect(codesOf(response)).toEqual(['reauthentication_failed']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'input.currentPassword',
        message: CURRENT_PASSWORD_INCORRECT,
      }),
    ]);
    expect(response.cleared).toBe(false);
  });

  test('多要素認証が有効な利用者の正しいリカバリコードは、本人確認を通して消費する', async () => {
    stubExternalServices();
    const user = await register(gateway);
    await enableTotpWithRecoveryCodes(user.viewer.id, [RECOVERY_CODE]);

    const first = await requestPasswordChange(
      user.sessionToken,
      NEW_PASSWORD,
      reAuthenticationInput(PASSWORD, { recoveryCode: RECOVERY_CODE }),
    );
    const reused = await requestPasswordChange(
      user.sessionToken,
      NEW_PASSWORD,
      reAuthenticationInput(PASSWORD, { recoveryCode: RECOVERY_CODE }),
    );

    expect(first.data).toEqual({ requestPasswordChange: true });
    expect(codesOf(reused)).toEqual(['reauthentication_failed']);
    expect(detailsOf(reused)[0]?.message).toBe(SECOND_FACTOR_INCORRECT);
  });
});

describe('requestPasswordChange・confirmPasswordChange', () => {
  test('リンクで確定すると操作した端末へ発行を指示し、新しいパスワードでだけログインできる', async () => {
    stubExternalServices();
    const user = await register(gateway);

    const requested = await requestPasswordChange(
      user.sessionToken,
      NEW_PASSWORD,
    );
    const { token } = lastMailOf('password-change-confirmation');
    const confirmed = await gateway.call<{
      confirmPasswordChange: ConfirmationFields;
    }>(CONFIRM_PASSWORD_CHANGE, { token }, { sessionToken: user.sessionToken });

    expect(requested.data).toEqual({ requestPasswordChange: true });
    expect(confirmed.data?.confirmPasswordChange.viewer?.id).toBe(
      user.viewer.id,
    );
    expect(confirmed.issuedToken).toMatch(SESSION_TOKEN_PATTERN);
    expect(lastMailOf('password-changed').userId).toBe(user.viewer.id);
    expect(codesOf(await login(gateway, user.email, PASSWORD))).toEqual([
      'invalid_credentials',
    ]);
    expect(
      (await login(gateway, user.email, NEW_PASSWORD)).issuedToken,
    ).toMatch(SESSION_TOKEN_PATTERN);
  });

  test('新しいパスワードの方針の違反は、入力の形のとおりの経路で返す', async () => {
    stubExternalServices();
    const user = await register(gateway);

    const response = await requestPasswordChange(
      user.sessionToken,
      user.viewer.handle,
    );

    expect(codesOf(response)).toEqual(['password_rejected']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'input.newPassword',
        code: 'matches_identity',
      }),
    ]);
  });
});

describe('withdraw', () => {
  test('退会させてCookieの失効を指示し、そのセッションは使えなくなる', async () => {
    stubExternalServices();
    const user = await register(gateway);

    const response = await gateway.call(
      WITHDRAW,
      { input: reAuthenticationInput(PASSWORD) },
      { sessionToken: user.sessionToken, botToken: botTokenFor('withdraw') },
    );

    expect(response.errors).toBeUndefined();
    expect(response.data).toEqual({ withdraw: true });
    expect(response.cleared).toBe(true);
    expect(response.issuedToken).toBeUndefined();
    expect((await fetchViewer(gateway, user.sessionToken)).data).toEqual({
      viewer: null,
    });
  });

  test('停止中の利用者も退会できる', async () => {
    stubExternalServices();
    const user = await register(gateway);
    await suspendUser(user.viewer.id);

    const response = await gateway.call(
      WITHDRAW,
      { input: reAuthenticationInput(PASSWORD) },
      { sessionToken: user.sessionToken, botToken: botTokenFor('withdraw') },
    );

    expect(response.data).toEqual({ withdraw: true });
    expect(response.cleared).toBe(true);
  });

  test('未ログインならログインを求める', async () => {
    stubExternalServices();

    const response = await gateway.call(
      WITHDRAW,
      { input: reAuthenticationInput(PASSWORD) },
      { botToken: botTokenFor('withdraw') },
    );

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });
});

describe('呼び出し元・停止中・bot判定', () => {
  const BOT_PROTECTED = [
    {
      name: 'requestEmailChange',
      document: REQUEST_EMAIL_CHANGE,
      action: 'email_change',
      variables: () => ({
        input: {
          newEmail: uniqueEmail('bot'),
          reAuthentication: reAuthenticationInput(PASSWORD),
        },
      }),
    },
    {
      name: 'requestPasswordChange',
      document: REQUEST_PASSWORD_CHANGE,
      action: 'password_change',
      variables: () => ({
        input: {
          newPassword: NEW_PASSWORD,
          reAuthentication: reAuthenticationInput(PASSWORD),
        },
      }),
    },
    {
      name: 'withdraw',
      document: WITHDRAW,
      action: 'withdraw',
      variables: () => ({ input: reAuthenticationInput(PASSWORD) }),
    },
  ];

  const WRITABLE_ONLY = BOT_PROTECTED.filter(({ name }) => name !== 'withdraw');

  test.each(BOT_PROTECTED)(
    '$nameは正しい操作名のbot判定で受け付ける',
    async ({ document, action, variables }) => {
      const calls = stubExternalServices();
      const user = await register(gateway);
      calls.siteverifyTokens.splice(0);

      const response = await gateway.call(document, variables(), {
        sessionToken: user.sessionToken,
        botToken: botTokenFor(action),
      });

      expect(response.errors).toBeUndefined();
      expect(calls.siteverifyTokens).toEqual([botTokenFor(action)]);
    },
  );

  test.each(BOT_PROTECTED)(
    '$nameはbot判定に失敗すると403の種類のエラーで拒否し、操作を行わない',
    async ({ document, variables }) => {
      stubExternalServices();
      const user = await register(gateway);
      sentMails.splice(0);

      const rejected = await gateway.call(document, variables(), {
        sessionToken: user.sessionToken,
        botToken: BOT_REJECTED_TOKEN,
      });
      const otherAction = await gateway.call(document, variables(), {
        sessionToken: user.sessionToken,
        botToken: botTokenFor('register'),
      });

      expect(rejected.status).toBe(200);
      expect(codesOf(rejected)).toEqual(['bot_verification_failed']);
      expect(codesOf(otherAction)).toEqual(['bot_verification_failed']);
      expect(rejected.cleared).toBe(false);
      expect(sentMails).toEqual([]);
      const viewer = await fetchViewer(gateway, user.sessionToken);
      expect(viewer.data?.viewer?.id).toBe(user.viewer.id);
    },
  );

  test.each(BOT_PROTECTED)(
    '$nameはbot判定のサービスに到達できなければ503で拒否し、操作を行わない',
    async ({ document, variables }) => {
      stubExternalServices();
      const user = await register(gateway);
      sentMails.splice(0);

      const response = await gateway.call(document, variables(), {
        sessionToken: user.sessionToken,
        botToken: BOT_UNREACHABLE_TOKEN,
      });

      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).not.toBeNull();
      expect(codesOf(response)).toEqual(['bot_verification_unavailable']);
      expect(response.cleared).toBe(false);
      expect(sentMails).toEqual([]);
    },
  );

  test.each(WRITABLE_ONLY)(
    '停止中の利用者の$nameは、bot判定の前にaccount_unavailableで拒否する',
    async ({ document, action, variables }) => {
      const calls = stubExternalServices();
      const user = await register(gateway);
      await suspendUser(user.viewer.id);
      calls.siteverifyTokens.splice(0);
      sentMails.splice(0);

      const response = await gateway.call(document, variables(), {
        sessionToken: user.sessionToken,
        botToken: botTokenFor(action),
      });

      expect(codesOf(response)).toEqual(['account_unavailable']);
      expect(response.errors?.[0]?.message).toBe(
        'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
      );
      expect(calls.siteverifyTokens).toEqual([]);
      expect(sentMails).toEqual([]);
    },
  );

  test.each([
    ...BOT_PROTECTED,
    {
      name: 'confirmEmailChange',
      document: CONFIRM_EMAIL_CHANGE,
      action: 'email_change',
      variables: () => ({ token: 'x'.repeat(43) }),
    },
    {
      name: 'confirmPasswordChange',
      document: CONFIRM_PASSWORD_CHANGE,
      action: 'password_change',
      variables: () => ({ token: 'x'.repeat(43) }),
    },
  ])(
    '管理者側の呼び出し元からの$nameは、bot判定の前にforbiddenで拒否する',
    async ({ document, action, variables }) => {
      const calls = stubExternalServices();

      const response = await gateway.call(document, variables(), {
        caller: 'admin',
        botToken: botTokenFor(action),
      });

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(calls.siteverifyTokens).toEqual([]);
    },
  );
});
