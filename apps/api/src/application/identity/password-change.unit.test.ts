import { describe, expect, test } from 'bun:test';

import { type PasswordChange, StorePasswordChange } from './password-change.ts';
import type { NewAuthToken } from './ports.ts';
import {
  ANONYMOUS_OPERATOR,
  caught,
  createCredentialChangeFakes,
  type CredentialChangeFakeOptions,
  currentOf,
  EMAIL_CHANGE_TOKEN,
  hashOfPlain,
  INVALID_LINK,
  META,
  MINUTE_MS,
  NEW_PASSWORD,
  NOT_CONFIRMABLE_USERS,
  NOW,
  PASSWORD_CHANGE_PURPOSE,
  PASSWORD_CHANGE_TOKEN,
  PENDING_PASSWORD_HASH,
  RE_AUTHENTICATION,
  REAUTHENTICATION_FAILED,
  REISSUED_SESSION,
  rejectionOf,
  SAME_USER_OPERATOR,
  shapeOf,
  storedHashOf,
  TOKEN,
  USER_ID,
  userOf,
} from './testing/credential-change-fakes.ts';

function setup(options: CredentialChangeFakeOptions = {}) {
  const fakes = createCredentialChangeFakes(options, [PASSWORD_CHANGE_TOKEN]);
  const passwordChange: PasswordChange = new StorePasswordChange(
    fakes.reAuthenticator,
    fakes.passwordPolicy,
    fakes.passwordHasher,
    fakes.users,
    fakes.tokens,
    fakes.secrets,
    fakes.mailer,
    fakes.sessionIssuer,
  );
  return { passwordChange, recorded: fakes.recorded, stored: fakes.stored };
}

const REQUEST = {
  newPassword: NEW_PASSWORD,
  reAuthentication: RE_AUTHENTICATION,
};

describe('StorePasswordChange.request', () => {
  test('本人確認・方針の確認・ハッシュ化の後に、新しいパスワードのハッシュだけを紐づけた30分有効なリンクで未使用の変更のトークンを置き換え、現在のアドレスへ送る', async () => {
    const { passwordChange, recorded, stored } = setup({ tokens: [] });

    await passwordChange.request(currentOf(), REQUEST, META);

    expect(recorded.calls).toEqual([
      'users.findById',
      'reAuthenticator.verify',
      'policy.validateNewPassword',
      'password.hash',
      'secrets.issue',
      'tokens.replace',
      'mailer.sendPasswordChangeConfirmation',
    ]);
    expect(recorded.reAuthentications).toEqual([
      { user: userOf(), input: RE_AUTHENTICATION, meta: META },
    ]);
    expect(recorded.policyChecks).toEqual([
      {
        password: NEW_PASSWORD,
        identifiers: {
          handle: userOf().handle,
          nickname: userOf().nickname,
          email: userOf().email,
        },
      },
    ]);
    const plain = recorded.issued[0]?.plain ?? '-';
    expect(recorded.issued).toEqual([
      { purpose: PASSWORD_CHANGE_PURPOSE, plain },
    ]);
    const expiresAt = new Date(NOW.getTime() + 30 * MINUTE_MS);
    expect(stored).toEqual([
      {
        userId: USER_ID,
        purpose: 'password_change',
        tokenHash: hashOfPlain(PASSWORD_CHANGE_PURPOSE, plain),
        expiresAt,
        pendingPasswordHash: storedHashOf(NEW_PASSWORD),
      },
    ]);
    expect(recorded.mails).toEqual([
      {
        method: 'sendPasswordChangeConfirmation',
        args: [userOf(), plain, expiresAt],
      },
    ]);
  });

  test('確定までパスワードを更新せず、平文を保存しない', async () => {
    const { passwordChange, recorded, stored } = setup({ tokens: [] });

    await passwordChange.request(currentOf(), REQUEST, META);

    expect(recorded.passwordChanges).toEqual([]);
    expect(
      stored.flatMap((token): unknown[] => Object.values(token)),
    ).not.toContain(NEW_PASSWORD);
    expect(stored.map((token) => token.pendingPasswordHash)).toEqual(
      recorded.passwordHashes,
    );
  });

  test('同じ利用者の未使用の変更のリンクは新しいリンクに置き換わり、ほかの用途のトークンは残す', async () => {
    const { passwordChange, recorded, stored } = setup({
      tokens: [PASSWORD_CHANGE_TOKEN, EMAIL_CHANGE_TOKEN],
    });

    await passwordChange.request(currentOf(), REQUEST, META);

    const plain = recorded.issued[0]?.plain ?? '-';
    expect(stored.map((token) => token.tokenHash)).toEqual([
      EMAIL_CHANGE_TOKEN.tokenHash,
      hashOfPlain(PASSWORD_CHANGE_PURPOSE, plain),
    ]);
  });

  test('本人確認に失敗したら例外をそのまま投げ、方針の確認もトークンの作成もしない', async () => {
    const { passwordChange, recorded, stored } = setup({
      reAuthError: REAUTHENTICATION_FAILED,
    });

    const error = await caught(
      passwordChange.request(currentOf(), REQUEST, META),
    );

    expect(error).toBe(REAUTHENTICATION_FAILED);
    expect(recorded.calls).toEqual([
      'users.findById',
      'reAuthenticator.verify',
    ]);
    expect(stored).toEqual([PASSWORD_CHANGE_TOKEN]);
  });

  test.each([
    [
      { ok: false, violation: 'pwned' },
      'pwned',
      'このパスワードは過去に漏洩したことがあります。別のパスワードを設定してください。',
    ],
    [
      { ok: false, violation: 'matches-identity' },
      'matches_identity',
      'ハンドル・ニックネーム・メールアドレス(@より前の部分を含む)と同じパスワードは使えません。',
    ],
    [
      { ok: false, violation: 'too-short' },
      'too_short',
      'パスワードは8文字以上128文字以内で入力してください。',
    ],
  ] as const)(
    'パスワードの方針の違反(%o)は422とpassword_rejectedで欄newPasswordの詳細を付けて拒否し、トークンを作らない',
    async (validation, detailCode, message) => {
      const { passwordChange, recorded, stored } = setup({ validation });

      const error = await caught(
        passwordChange.request(currentOf(), REQUEST, META),
      );

      expect(error.kind).toBe('unprocessable');
      expect(error.code).toBe('password_rejected');
      expect(error.message).toBe(message);
      expect(error.details).toEqual([
        { field: 'newPassword', code: detailCode, message },
      ]);
      expect(recorded.passwordHashes).toEqual([]);
      expect(stored).toEqual([PASSWORD_CHANGE_TOKEN]);
      expect(recorded.mails).toEqual([]);
    },
  );

  test('確認のメールの送信要求に失敗したら、利用者が送り直せるよう例外をそのまま投げる', async () => {
    const mailError = new Error('送信の受付に失敗しました');
    const { passwordChange } = setup({ mailError });

    const rejection = await rejectionOf(
      passwordChange.request(currentOf(), REQUEST, META),
    );

    expect(rejection).toBe(mailError);
  });
});

describe('StorePasswordChange.confirm', () => {
  test('変更の用途でハッシュ化したトークンを消費し、保留したハッシュでパスワードを更新してから、完了メールと操作した端末への再発行を行う', async () => {
    const { passwordChange, recorded, stored } = setup();

    const result = await passwordChange.confirm(
      TOKEN,
      SAME_USER_OPERATOR,
      META,
    );

    expect(recorded.calls).toEqual([
      'secrets.hashOf',
      'tokens.consume',
      'users.findById',
      'users.applyPasswordChange',
      'mailer.sendPasswordChanged',
      'sessions.reissueForOperator',
    ]);
    expect(recorded.hashed).toEqual([
      { purpose: PASSWORD_CHANGE_PURPOSE, plain: TOKEN },
    ]);
    expect(stored).toEqual([]);
    expect(recorded.passwordChanges).toEqual([
      { userId: USER_ID, passwordHash: PENDING_PASSWORD_HASH },
    ]);
    expect(recorded.mails).toEqual([
      { method: 'sendPasswordChanged', args: [userOf(), NOW] },
    ]);
    expect(recorded.reissues).toEqual([
      { userId: USER_ID, operator: SAME_USER_OPERATOR, meta: META },
    ]);
    expect(result).toEqual({ session: REISSUED_SESSION });
  });

  test('全セッションの削除と未使用の変更のリンクの失効は、利用者のストアの1回のapplyPasswordChangeに任せ、パスワードを計算し直さない', async () => {
    const { passwordChange, recorded } = setup();

    await passwordChange.confirm(TOKEN, SAME_USER_OPERATOR, META);

    expect(recorded.passwordChanges).toHaveLength(1);
    expect(recorded.calls).not.toContain('password.hash');
    expect(recorded.calls).not.toContain('policy.validateNewPassword');
  });

  test('操作した端末が同じ利用者としてログイン中でなければ、新しいセッションを返さない', async () => {
    const { passwordChange, recorded } = setup({ reissued: undefined });

    const result = await passwordChange.confirm(
      TOKEN,
      ANONYMOUS_OPERATOR,
      META,
    );

    expect(recorded.reissues).toEqual([
      { userId: USER_ID, operator: ANONYMOUS_OPERATOR, meta: META },
    ]);
    expect(result).toEqual({ session: undefined });
  });

  test.each([
    ['存在しない', [] as NewAuthToken[]],
    [
      '期限切れの',
      [{ ...PASSWORD_CHANGE_TOKEN, expiresAt: new Date(NOW.getTime()) }],
    ],
    ['ほかの用途の', [{ ...PASSWORD_CHANGE_TOKEN, purpose: 'email_change' }]],
  ] as const)(
    '%sトークンは422のinvalid_linkで拒否し、利用者を読まず何も更新しない',
    async (_label, tokens) => {
      const { passwordChange, recorded } = setup({ tokens: [...tokens] });

      const error = await caught(
        passwordChange.confirm(TOKEN, SAME_USER_OPERATOR, META),
      );

      expect(shapeOf(error)).toEqual(INVALID_LINK);
      expect(recorded.calls).toEqual(['secrets.hashOf', 'tokens.consume']);
    },
  );

  test('新しいパスワードのハッシュが紐づかないトークンはinvalid_linkで拒否し、何も更新しない', async () => {
    const { passwordChange, recorded } = setup({
      tokens: [{ ...PASSWORD_CHANGE_TOKEN, pendingPasswordHash: undefined }],
    });

    const error = await caught(
      passwordChange.confirm(TOKEN, SAME_USER_OPERATOR, META),
    );

    expect(shapeOf(error)).toEqual(INVALID_LINK);
    expect(recorded.passwordChanges).toEqual([]);
  });

  test.each(NOT_CONFIRMABLE_USERS)(
    '%sの利用者のリンクは失効させてinvalid_linkで拒否し、変更もメールも再発行もしない',
    async (_label, user) => {
      const { passwordChange, recorded, stored } = setup({ user });

      const error = await caught(
        passwordChange.confirm(TOKEN, SAME_USER_OPERATOR, META),
      );

      expect(shapeOf(error)).toEqual(INVALID_LINK);
      expect(recorded.calls).toEqual([
        'secrets.hashOf',
        'tokens.consume',
        'users.findById',
      ]);
      expect(stored).toEqual([]);
    },
  );

  test('2回目の確定は使用済みのトークンとしてinvalid_linkで拒否する', async () => {
    const { passwordChange, recorded } = setup();
    await passwordChange.confirm(TOKEN, SAME_USER_OPERATOR, META);

    const error = await caught(
      passwordChange.confirm(TOKEN, SAME_USER_OPERATOR, META),
    );

    expect(shapeOf(error)).toEqual(INVALID_LINK);
    expect(recorded.passwordChanges).toHaveLength(1);
  });

  test('完了メールの送信要求に失敗しても、変更は完了しているため操作した端末へ再発行して成功を返す', async () => {
    const { passwordChange, recorded } = setup({
      mailError: new Error('送信の受付に失敗しました'),
    });

    const result = await passwordChange.confirm(
      TOKEN,
      SAME_USER_OPERATOR,
      META,
    );

    expect(recorded.mails).toHaveLength(1);
    expect(result).toEqual({ session: REISSUED_SESSION });
  });

  test('パスワードの更新に失敗したら、例外をそのまま投げてメールも再発行もしない', async () => {
    const applyError = new Error('D1の書き込みに失敗しました');
    const { passwordChange, recorded } = setup({ applyError });

    const rejection = await rejectionOf(
      passwordChange.confirm(TOKEN, SAME_USER_OPERATOR, META),
    );

    expect(rejection).toBe(applyError);
    expect(recorded.mails).toEqual([]);
    expect(recorded.reissues).toEqual([]);
  });
});
