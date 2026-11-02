import { Secret, TOTP } from 'otpauth';
import { describe, expect, test } from 'vitest';

import {
  BOT_REJECTED_TOKEN,
  BOT_UNREACHABLE_TOKEN,
  botTokenFor,
  enableTotpWithRecoveryCodes,
  sentMails,
  stubExternalServices,
  suspendUser,
  uniqueEmail,
} from '../../../../../test/support/identity-graphql-harness.ts';
import {
  codesOf,
  COMPLETE_SECOND_FACTOR_LOGIN,
  detailsOf,
  installIdentityGraphQLTest,
  login,
  LOGIN,
  LOGOUT,
  PASSWORD,
  register,
  REGISTER_USER,
  registrationInput,
  REQUEST_PASSWORD_RESET,
  SESSION_TOKEN_PATTERN,
  VERIFY_EMAIL,
  VIEWER,
  type ViewerFields,
  WRONG_PASSWORD,
} from '../../../../../test/support/identity-graphql-operations.ts';

const { gateway, logs } = installIdentityGraphQLTest();

const RECOVERY_CODE = 'abcd'.repeat(4);

const LOGIN_CATEGORY = 'api.identity.login';

const LOGIN_FAILURES_BEFORE_LOCK = 6;

function loginLogs() {
  return logs().filter((log) => log.category === LOGIN_CATEGORY);
}

describe('login', () => {
  test('多要素認証を設定していなければ、セッションの発行を指示して利用者を返し、成功をログに残す', async () => {
    stubExternalServices();
    const { email, viewer } = await register(gateway);

    const response = await login(gateway, email, PASSWORD);

    expect(response.errors).toBeUndefined();
    expect(response.data?.login).toMatchObject({
      __typename: 'LoginSucceeded',
      viewer: { id: viewer.id, email },
    });
    expect(response.issuedToken).toMatch(SESSION_TOKEN_PATTERN);
    expect(loginLogs()).toEqual([
      expect.objectContaining({
        level: 'info',
        outcome: 'authenticated',
        userId: viewer.id,
      }),
    ]);
    expect(JSON.stringify(loginLogs())).not.toContain(email);
  });

  test('パスワードの誤りと未登録は区別しない401の種類のエラーで拒否し、理由をログに残す', async () => {
    stubExternalServices();
    const { email } = await register(gateway);

    const wrong = await login(gateway, email, WRONG_PASSWORD);
    const unknown = await login(gateway, uniqueEmail('unknown'), PASSWORD);

    for (const response of [wrong, unknown]) {
      expect(response.status).toBe(200);
      expect(codesOf(response)).toEqual(['invalid_credentials']);
      expect(response.errors?.[0]?.message).toBe(
        'メールアドレスまたはパスワードが正しくありません。',
      );
      expect(response.issuedToken).toBeUndefined();
    }
    expect(loginLogs()).toEqual([
      expect.objectContaining({
        level: 'warning',
        reason: 'invalid_credentials',
      }),
      expect.objectContaining({
        level: 'warning',
        reason: 'invalid_credentials',
      }),
    ]);
  });

  test('失敗が続いてクールダウン中なら、429と待ち時間で拒否する', async () => {
    stubExternalServices();
    const { email } = await register(gateway);
    const clientIp = '2001:db8::7:1';

    for (let attempt = 0; attempt < LOGIN_FAILURES_BEFORE_LOCK; attempt += 1) {
      await login(gateway, email, WRONG_PASSWORD, { clientIp });
    }
    const response = await login(gateway, email, PASSWORD, { clientIp });

    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(codesOf(response)).toEqual(['login_throttled']);
    expect(response.errors?.[0]?.message).toBe(
      'ログイン試行が続いたため、しばらく待ってから再度お試しください。',
    );
    expect(response.issuedToken).toBeUndefined();
    expect(loginLogs().at(-1)).toMatchObject({ reason: 'login_throttled' });
  });

  test('パスワードが一致した利用者が停止中なら、セッションを発行せずに403の種類のエラーで拒否する', async () => {
    stubExternalServices();
    const { email, viewer } = await register(gateway);
    await suspendUser(viewer.id);

    const response = await login(gateway, email, PASSWORD);

    expect(codesOf(response)).toEqual(['account_unavailable']);
    expect(response.errors?.[0]?.message).toBe(
      'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
    );
    expect(response.issuedToken).toBeUndefined();
  });

  test('多要素認証を設定していれば、セッションを発行せずに第2要素の入力を求める', async () => {
    stubExternalServices();
    const { email, viewer } = await register(gateway);
    await enableTotpWithRecoveryCodes(viewer.id, [RECOVERY_CODE]);

    const response = await login(gateway, email, PASSWORD);

    expect(response.errors).toBeUndefined();
    const result = response.data?.login;
    if (result?.__typename !== 'SecondFactorRequired') {
      throw new Error('第2要素の待ちになりませんでした');
    }
    expect(result.challenge).toMatch(SESSION_TOKEN_PATTERN);
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
    expect(response.issuedToken).toBeUndefined();
    expect(loginLogs()).toEqual([
      expect.objectContaining({
        outcome: 'second-factor-required',
        userId: viewer.id,
      }),
    ]);
  });
});

describe('completeSecondFactorLogin', () => {
  interface SecondFactorUser {
    readonly email: string;
    readonly viewer: ViewerFields;
    readonly totpSecret: string;
  }

  async function prepareTotpUser(): Promise<SecondFactorUser> {
    const { email, viewer } = await register(gateway);
    const totpSecret = await enableTotpWithRecoveryCodes(viewer.id, [
      RECOVERY_CODE,
      'efgh'.repeat(4),
      'jkmn'.repeat(4),
    ]);
    return { email, viewer, totpSecret };
  }

  async function challengeOf({ email }: SecondFactorUser): Promise<string> {
    const response = await login(gateway, email, PASSWORD);
    const result = response.data?.login;
    if (result?.__typename !== 'SecondFactorRequired') {
      throw new Error('第2要素の待ちになりませんでした');
    }
    return result.challenge;
  }

  function currentTotpCode(secret: string): string {
    return new TOTP({
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    }).generate();
  }

  test('正しいリカバリコードでセッションの発行を指示し、要求されたリカバリコードの残数を返す', async () => {
    stubExternalServices();
    const user = await prepareTotpUser();
    const challenge = await challengeOf(user);

    const response = await gateway.call<{
      completeSecondFactorLogin: ViewerFields;
    }>(COMPLETE_SECOND_FACTOR_LOGIN, {
      input: { challenge, secondFactor: { recoveryCode: RECOVERY_CODE } },
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.completeSecondFactorLogin).toMatchObject({
      id: user.viewer.id,
      totpEnabled: true,
      remainingRecoveryCodes: 2,
    });
    expect(response.issuedToken).toMatch(SESSION_TOKEN_PATTERN);
    expect(loginLogs().at(-1)).toMatchObject({
      outcome: 'authenticated',
      userId: user.viewer.id,
    });
  });

  test('正しい認証コードでログインでき、同じ認証コードの再使用はセッションを発行せずに拒否する', async () => {
    stubExternalServices();
    const user = await prepareTotpUser();
    const code = currentTotpCode(user.totpSecret);

    const first = await gateway.call(COMPLETE_SECOND_FACTOR_LOGIN, {
      input: {
        challenge: await challengeOf(user),
        secondFactor: { totpCode: code },
      },
    });
    const replayed = await gateway.call(COMPLETE_SECOND_FACTOR_LOGIN, {
      input: {
        challenge: await challengeOf(user),
        secondFactor: { totpCode: code },
      },
    });

    expect(first.errors).toBeUndefined();
    expect(first.issuedToken).toMatch(SESSION_TOKEN_PATTERN);
    expect(codesOf(replayed)).toEqual(['invalid_second_factor']);
    expect(replayed.errors?.[0]?.message).toBe(
      '認証コードが正しくありません。',
    );
    expect(replayed.issuedToken).toBeUndefined();
    expect(loginLogs().at(-1)).toMatchObject({
      reason: 'invalid_second_factor',
    });
  });

  test.each([
    { label: 'どちらも無い', secondFactor: {} },
    {
      label: '両方ある',
      secondFactor: { totpCode: '123456', recoveryCode: RECOVERY_CODE },
    },
  ])(
    '認証コードとリカバリコードが$labelなら、入力の誤りとして返す',
    async ({ secondFactor }) => {
      stubExternalServices();

      const response = await gateway.call(COMPLETE_SECOND_FACTOR_LOGIN, {
        input: { challenge: 'x'.repeat(43), secondFactor },
      });

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({
          field: 'input.secondFactor',
          message:
            '認証コードかリカバリコードのどちらか一方を入力してください。',
        }),
      ]);
    },
  );

  test('期限切れ・不明の待ちは、もう一度ログインするよう求める', async () => {
    stubExternalServices();

    const response = await gateway.call(COMPLETE_SECOND_FACTOR_LOGIN, {
      input: {
        challenge: 'x'.repeat(43),
        secondFactor: { totpCode: '123456' },
      },
    });

    expect(codesOf(response)).toEqual(['login_challenge_expired']);
  });
});

describe('呼び出し元とbot判定', () => {
  const BOT_PROTECTED = [
    {
      name: 'registerUser',
      document: REGISTER_USER,
      variables: () => ({ input: registrationInput() }),
    },
    {
      name: 'login',
      document: LOGIN,
      variables: () => ({
        input: { email: uniqueEmail('bot'), password: PASSWORD },
      }),
    },
    {
      name: 'requestPasswordReset',
      document: REQUEST_PASSWORD_RESET,
      variables: () => ({ email: uniqueEmail('bot') }),
    },
  ];

  test.each([
    {
      name: 'registerUser',
      document: REGISTER_USER,
      variables: { input: registrationInput() },
    },
    {
      name: 'login',
      document: LOGIN,
      variables: { input: { email: uniqueEmail('admin'), password: PASSWORD } },
    },
    { name: 'viewer', document: VIEWER, variables: {} },
    { name: 'logout', document: LOGOUT, variables: {} },
    {
      name: 'verifyEmail',
      document: VERIFY_EMAIL,
      variables: { token: 'x'.repeat(43) },
    },
  ])(
    '管理者側の呼び出し元からの$nameは、bot判定の前にforbiddenで拒否する',
    async ({ document, variables }) => {
      const calls = stubExternalServices();

      const response = await gateway.call(document, variables, {
        caller: 'admin',
        botToken: botTokenFor('register'),
      });

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(response.errors?.[0]?.message).toBe('この操作はできません。');
      expect(calls.siteverifyTokens).toEqual([]);
      expect(sentMails).toEqual([]);
    },
  );

  test.each(BOT_PROTECTED)(
    '$nameはbot判定に失敗すると403の種類のエラーで拒否する',
    async ({ document, variables }) => {
      stubExternalServices();

      const response = await gateway.call(document, variables(), {
        botToken: BOT_REJECTED_TOKEN,
      });

      expect(response.status).toBe(200);
      expect(codesOf(response)).toEqual(['bot_verification_failed']);
      expect(response.errors?.[0]?.message).toBe(
        '認証に失敗しました。ページを再読み込みして再度お試しください。',
      );
      expect(response.issuedToken).toBeUndefined();
      expect(sentMails).toEqual([]);
    },
  );

  test.each(BOT_PROTECTED)(
    '$nameは別の操作のbot判定の結果を受け付けない',
    async ({ document, variables }) => {
      stubExternalServices();

      const response = await gateway.call(document, variables(), {
        botToken: botTokenFor('withdraw'),
      });

      expect(codesOf(response)).toEqual(['bot_verification_failed']);
    },
  );

  test.each(BOT_PROTECTED)(
    '$nameはbot判定のサービスに到達できなければ503で拒否し、操作を行わない',
    async ({ document, variables }) => {
      stubExternalServices();

      const response = await gateway.call(document, variables(), {
        botToken: BOT_UNREACHABLE_TOKEN,
      });

      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).not.toBeNull();
      expect(codesOf(response)).toEqual(['bot_verification_unavailable']);
      expect(response.issuedToken).toBeUndefined();
      expect(sentMails).toEqual([]);
    },
  );
});
