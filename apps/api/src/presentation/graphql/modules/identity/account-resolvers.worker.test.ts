import { describe, expect, test } from 'vitest';

import {
  botTokenFor,
  lastMailOf,
  markVerified,
  sentMails,
  stubExternalServices,
  suspendUser,
  uniqueEmail,
} from '../../../../../test/support/identity-graphql-harness.ts';
import {
  codesOf,
  detailsOf,
  fetchViewer,
  installIdentityGraphQLTest,
  login,
  LOGOUT,
  NEW_PASSWORD,
  PASSWORD,
  register,
  REGISTER_USER,
  registrationInput,
  REQUEST_PASSWORD_RESET,
  RESEND_VERIFICATION_EMAIL,
  RESET_PASSWORD,
  SESSION_TOKEN_PATTERN,
  VERIFY_EMAIL,
  VIEWER_HEADER,
  type ViewerFields,
} from '../../../../../test/support/identity-graphql-operations.ts';

const { gateway } = installIdentityGraphQLTest();

const SHORT_PASSWORD = 'a'.repeat(7);

describe('registerUser', () => {
  test('入力を受け付けて未確認の利用者を作り、その端末へセッションの発行を指示する', async () => {
    const calls = stubExternalServices();
    const email = uniqueEmail('new');

    const response = await gateway.call<{ registerUser: ViewerFields }>(
      REGISTER_USER,
      {
        input: registrationInput({
          nickname: '\u3000ローンチ太郎 ',
          email: ` ${email}\u3000`,
        }),
      },
      { botToken: botTokenFor('register') },
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.registerUser).toMatchObject({
      nickname: 'ローンチ太郎',
      email,
      emailVerified: false,
      status: 'ACTIVE',
      totpEnabled: false,
      remainingRecoveryCodes: 0,
    });
    expect(response.data?.registerUser.handle).toMatch(/^[a-z0-9]{12}$/u);
    expect(response.issuedToken).toMatch(SESSION_TOKEN_PATTERN);
    expect(Number(response.headers.get('x-session-max-age'))).toBeGreaterThan(
      0,
    );
    expect(calls.siteverifyTokens).toEqual([botTokenFor('register')]);
    expect(lastMailOf('email-verification').userId).toBe(
      response.data?.registerUser.id,
    );
    const viewer = await fetchViewer(gateway, response.issuedToken);
    expect(viewer.data?.viewer?.id).toBe(response.data?.registerUser.id);
  });

  test('入力の規則に合わない欄ごとに、入力の形のとおりの経路と理由を返し、bot判定の前に拒否する', async () => {
    const calls = stubExternalServices();

    const response = await gateway.call(
      REGISTER_USER,
      {
        input: {
          nickname: '\u3000 ',
          email: `${'a'.repeat(250)}@mail.example`,
          password: SHORT_PASSWORD,
          agreedToTerms: true,
        },
      },
      { botToken: botTokenFor('register') },
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(response.data).toBeNull();
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'input.nickname',
        message: 'ニックネームを入力してください。',
      }),
      expect.objectContaining({
        field: 'input.email',
        message: 'メールアドレスは254文字以内で入力してください。',
      }),
      expect.objectContaining({
        field: 'input.password',
        message: 'パスワードは8文字以上128文字以内で入力してください。',
      }),
    ]);
    expect(response.issuedToken).toBeUndefined();
    expect(calls.siteverifyTokens).toEqual([]);
    expect(sentMails).toEqual([]);
  });

  test.each([
    {
      label: 'ニックネームが26文字',
      input: { nickname: 'あ'.repeat(26) },
      field: 'input.nickname',
      message: 'ニックネームは25文字以内で入力してください。',
    },
    {
      label: 'メールアドレスの形式が正しくない',
      input: { email: 'not-an-address' },
      field: 'input.email',
      message: 'メールアドレスの形式が正しくありません。',
    },
    {
      label: 'メールアドレスが空白だけ',
      input: { email: ' ' },
      field: 'input.email',
      message: 'メールアドレスを入力してください。',
    },
    {
      label: 'パスワードが129文字',
      input: { password: 'a'.repeat(129) },
      field: 'input.password',
      message: 'パスワードは8文字以上128文字以内で入力してください。',
    },
  ])('$labelなら、その欄の理由を返す', async ({ input, field, message }) => {
    stubExternalServices();

    const response = await gateway.call(
      REGISTER_USER,
      { input: registrationInput(input) },
      { botToken: botTokenFor('register') },
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field, message }),
    ]);
  });

  test('利用規約とプライバシーポリシーへの同意が無ければ、同意を求めて登録しない', async () => {
    stubExternalServices();

    const response = await gateway.call(
      REGISTER_USER,
      { input: registrationInput({ agreedToTerms: false }) },
      { botToken: botTokenFor('register') },
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'input.agreedToTerms',
        message: '利用規約とプライバシーポリシーに同意してください。',
      }),
    ]);
    expect(response.issuedToken).toBeUndefined();
    expect(sentMails).toEqual([]);
  });

  test('パスワードの方針の違反は、入力の形のとおりの経路の詳細で返す', async () => {
    stubExternalServices();
    const email = uniqueEmail('same');
    const [localPart = ''] = email.split('@');

    const response = await gateway.call(
      REGISTER_USER,
      { input: registrationInput({ email, password: localPart }) },
      { botToken: botTokenFor('register') },
    );

    expect(codesOf(response)).toEqual(['password_rejected']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'input.password',
        code: 'matches_identity',
        message:
          'ハンドル・ニックネーム・メールアドレス(@より前の部分を含む)と同じパスワードは使えません。',
      },
    ]);
  });

  test('既に登録されたメールアドレスは、定めた文言で拒否する', async () => {
    stubExternalServices();
    const { email } = await register(gateway);

    const response = await gateway.call(
      REGISTER_USER,
      { input: registrationInput({ email: email.toUpperCase() }) },
      { botToken: botTokenFor('register') },
    );

    expect(codesOf(response)).toEqual(['registration_email_unavailable']);
    expect(response.errors?.[0]?.message).toBe(
      'このメールアドレスは登録できません。',
    );
  });
});

describe('viewer', () => {
  test('未ログインならnullを返す', async () => {
    const response = await fetchViewer(gateway, undefined);

    expect(response.errors).toBeUndefined();
    expect(response.data).toEqual({ viewer: null });
  });

  test('無効なセッションならnullを返し、Cookieの失効を指示する', async () => {
    const response = await fetchViewer(gateway, 'y'.repeat(43));

    expect(response.data).toEqual({ viewer: null });
    expect(response.cleared).toBe(true);
  });

  test('停止中の利用者もその状態で返す', async () => {
    stubExternalServices();
    const { viewer, sessionToken } = await register(gateway);
    await suspendUser(viewer.id);

    const response = await fetchViewer(gateway, sessionToken);

    expect(response.data?.viewer).toMatchObject({
      id: viewer.id,
      status: 'SUSPENDED',
    });
  });

  test('ヘッダーの取得のように一部の項目だけを要求できる', async () => {
    stubExternalServices();
    const { viewer, sessionToken } = await register(gateway);

    const response = await gateway.call(VIEWER_HEADER, {}, { sessionToken });

    expect(response.data).toEqual({
      viewer: { id: viewer.id, nickname: viewer.nickname },
    });
  });
});

describe('logout', () => {
  test('その端末のセッションを削除し、Cookieの失効を指示する', async () => {
    stubExternalServices();
    const { sessionToken } = await register(gateway);

    const response = await gateway.call(LOGOUT, {}, { sessionToken });

    expect(response.data).toEqual({ logout: true });
    expect(response.cleared).toBe(true);
    expect(response.issuedToken).toBeUndefined();
    expect((await fetchViewer(gateway, sessionToken)).data).toEqual({
      viewer: null,
    });
  });

  test('未ログインならログインを求める', async () => {
    const response = await gateway.call(LOGOUT, {});

    expect(codesOf(response)).toEqual(['unauthenticated']);
    expect(response.errors?.[0]?.message).toBe('ログインが必要です。');
  });
});

describe('メールアドレスの確認と再送', () => {
  test('届いたリンクで確認を確定し、同じリンクは2回使えない', async () => {
    stubExternalServices();
    const { sessionToken } = await register(gateway);
    const { token } = lastMailOf('email-verification');

    const verified = await gateway.call(VERIFY_EMAIL, { token });
    const reused = await gateway.call(VERIFY_EMAIL, { token });

    expect(verified.data).toEqual({ verifyEmail: true });
    const viewer = await fetchViewer(gateway, sessionToken);
    expect(viewer.data?.viewer?.emailVerified).toBe(true);
    expect(codesOf(reused)).toEqual(['invalid_link']);
    expect(reused.errors?.[0]?.message).toBe(
      'このリンクは無効か、有効期限が切れています。',
    );
  });

  test('未確認なら確認メールを送り直し、確認済みならその旨を返す', async () => {
    stubExternalServices();
    const { viewer, sessionToken } = await register(gateway);

    const sent = await gateway.call(
      RESEND_VERIFICATION_EMAIL,
      {},
      { sessionToken },
    );
    await markVerified(viewer.id);
    const already = await gateway.call(
      RESEND_VERIFICATION_EMAIL,
      {},
      { sessionToken },
    );

    expect(sent.data).toEqual({ resendVerificationEmail: 'SENT' });
    expect(
      sentMails.filter((mail) => mail.kind === 'email-verification'),
    ).toHaveLength(2);
    expect(already.data).toEqual({
      resendVerificationEmail: 'ALREADY_VERIFIED',
    });
  });

  test('未ログインの再送はログインを求める', async () => {
    const response = await gateway.call(RESEND_VERIFICATION_EMAIL, {});

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });
});

describe('パスワードリセット', () => {
  test('アカウントの有無を問わず同じ応答を返し、利用者がいるときだけメールを送る', async () => {
    const calls = stubExternalServices();
    const { email, viewer } = await register(gateway);
    sentMails.splice(0);

    const known = await gateway.call(
      REQUEST_PASSWORD_RESET,
      { email },
      { botToken: botTokenFor('password_reset') },
    );
    const unknown = await gateway.call(
      REQUEST_PASSWORD_RESET,
      { email: uniqueEmail('nobody') },
      { botToken: botTokenFor('password_reset') },
    );

    for (const response of [known, unknown]) {
      expect(response.status).toBe(200);
      expect(response.errors).toBeUndefined();
      expect(response.data).toEqual({ requestPasswordReset: true });
    }
    expect(sentMails).toEqual([
      expect.objectContaining({ kind: 'password-reset', userId: viewer.id }),
    ]);
    expect(calls.siteverifyTokens).toContain(botTokenFor('password_reset'));
  });

  test('リンクで新しいパスワードを確定すると、新しいパスワードでだけログインできる', async () => {
    stubExternalServices();
    const { email } = await register(gateway);
    await gateway.call(
      REQUEST_PASSWORD_RESET,
      { email },
      { botToken: botTokenFor('password_reset') },
    );
    const { token } = lastMailOf('password-reset');

    const response = await gateway.call(RESET_PASSWORD, {
      input: { token, newPassword: NEW_PASSWORD },
    });

    expect(response.data).toEqual({ resetPassword: true });
    expect(codesOf(await login(gateway, email, PASSWORD))).toEqual([
      'invalid_credentials',
    ]);
    const relogin = await login(gateway, email, NEW_PASSWORD);
    expect(relogin.data?.login.__typename).toBe('LoginSucceeded');
  });

  test('新しいパスワードの長さと方針の違反は、入力の形のとおりの経路で返す', async () => {
    stubExternalServices();
    const { email } = await register(gateway);
    await gateway.call(
      REQUEST_PASSWORD_RESET,
      { email },
      { botToken: botTokenFor('password_reset') },
    );
    const { token } = lastMailOf('password-reset');

    const tooShort = await gateway.call(RESET_PASSWORD, {
      input: { token, newPassword: SHORT_PASSWORD },
    });
    const [localPart = ''] = email.split('@');
    const sameAsEmail = await gateway.call(RESET_PASSWORD, {
      input: { token, newPassword: localPart },
    });

    expect(codesOf(tooShort)).toEqual(['validation_error']);
    expect(detailsOf(tooShort)).toEqual([
      expect.objectContaining({ field: 'input.newPassword' }),
    ]);
    expect(codesOf(sameAsEmail)).toEqual(['password_rejected']);
    expect(detailsOf(sameAsEmail)).toEqual([
      expect.objectContaining({
        field: 'input.newPassword',
        code: 'matches_identity',
      }),
    ]);
  });

  test('無効なリンクは定めた文言で拒否する', async () => {
    stubExternalServices();

    const response = await gateway.call(RESET_PASSWORD, {
      input: { token: 'z'.repeat(43), newPassword: NEW_PASSWORD },
    });

    expect(codesOf(response)).toEqual(['invalid_link']);
  });
});
