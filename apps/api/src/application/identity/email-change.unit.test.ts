import { describe, expect, test } from 'bun:test';

import { type EmailChange, StoreEmailChange } from './email-change.ts';
import type { NewAuthToken } from './ports.ts';
import {
  ANONYMOUS_OPERATOR,
  caught,
  createCredentialChangeFakes,
  type CredentialChangeFakeOptions,
  currentOf,
  EMAIL,
  EMAIL_CHANGE_PURPOSE,
  EMAIL_CHANGE_TOKEN,
  hashOfPlain,
  HOUR_MS,
  INVALID_LINK,
  META,
  NEW_EMAIL,
  NOT_CONFIRMABLE_USERS,
  NOW,
  PASSWORD_CHANGE_TOKEN,
  RATE_LIMITED,
  RE_AUTHENTICATION,
  REAUTHENTICATION_FAILED,
  REISSUED_SESSION,
  rejectionOf,
  SAME_USER_OPERATOR,
  shapeOf,
  TOKEN,
  USER_ID,
  userOf,
} from './testing/credential-change-fakes.ts';

function setup(options: CredentialChangeFakeOptions = {}) {
  const fakes = createCredentialChangeFakes(options, [EMAIL_CHANGE_TOKEN]);
  const emailChange: EmailChange = new StoreEmailChange(
    fakes.reAuthenticator,
    fakes.mailLimits,
    fakes.users,
    fakes.tokens,
    fakes.secrets,
    fakes.mailer,
    fakes.disposableCheck,
    fakes.sessionIssuer,
  );
  return { emailChange, recorded: fakes.recorded, stored: fakes.stored };
}

const REQUEST = { newEmail: NEW_EMAIL, reAuthentication: RE_AUTHENTICATION };

const CHANGED_USER = userOf({
  email: NEW_EMAIL,
  emailVerifiedAt: NOW,
  disposableEmailStatus: 'undetermined',
});

describe('StoreEmailChange.request', () => {
  test('本人確認の後に新しいアドレスで送信回数を数え、重複が無ければ未使用の変更のトークンを置き換えて、24時間有効なリンクを新しいアドレスへ送る', async () => {
    const { emailChange, recorded, stored } = setup({ tokens: [] });

    await emailChange.request(currentOf(), REQUEST, META);

    expect(recorded.calls).toEqual([
      'users.findById',
      'reAuthenticator.verify',
      'limits.consume',
      'users.isEmailInUse',
      'secrets.issue',
      'tokens.replace',
      'mailer.sendEmailChangeConfirmation',
    ]);
    expect(recorded.reAuthentications).toEqual([
      { user: userOf(), input: RE_AUTHENTICATION, meta: META },
    ]);
    expect(recorded.limits).toEqual([
      { kind: 'email_change', address: NEW_EMAIL, meta: META },
    ]);
    expect(recorded.emailInUseChecks).toEqual([
      { email: NEW_EMAIL, exceptUserId: USER_ID },
    ]);
    const plain = recorded.issued[0]?.plain ?? '-';
    expect(recorded.issued).toEqual([{ purpose: EMAIL_CHANGE_PURPOSE, plain }]);
    const expiresAt = new Date(NOW.getTime() + 24 * HOUR_MS);
    expect(stored).toEqual([
      {
        userId: USER_ID,
        purpose: 'email_change',
        tokenHash: hashOfPlain(EMAIL_CHANGE_PURPOSE, plain),
        expiresAt,
        newEmail: NEW_EMAIL,
      },
    ]);
    expect(recorded.mails).toEqual([
      {
        method: 'sendEmailChangeConfirmation',
        args: [userOf(), NEW_EMAIL, plain, expiresAt],
      },
    ]);
  });

  test('同じ利用者の未使用の変更のリンクは新しいリンクに置き換わり、ほかの用途のトークンは残す', async () => {
    const { emailChange, recorded, stored } = setup({
      tokens: [EMAIL_CHANGE_TOKEN, PASSWORD_CHANGE_TOKEN],
    });

    await emailChange.request(currentOf(), REQUEST, META);

    const plain = recorded.issued[0]?.plain ?? '-';
    expect(stored.map((token) => token.tokenHash)).toEqual([
      PASSWORD_CHANGE_TOKEN.tokenHash,
      hashOfPlain(EMAIL_CHANGE_PURPOSE, plain),
    ]);
  });

  test('メールアドレスが未確認の利用者からも受け付ける', async () => {
    const user = userOf({ emailVerifiedAt: null });
    const { emailChange, recorded } = setup({ user });

    await emailChange.request(currentOf(user), REQUEST, META);

    expect(recorded.mails.map((mail) => mail.method)).toEqual([
      'sendEmailChangeConfirmation',
    ]);
  });

  test('入力の前後の空白を除いたメールアドレスで数え、重複を調べ、リンクに紐づける', async () => {
    const { emailChange, recorded, stored } = setup({ tokens: [] });

    await emailChange.request(
      currentOf(),
      { ...REQUEST, newEmail: `\u3000 ${NEW_EMAIL}\n` },
      META,
    );

    expect(recorded.limits.map((limit) => limit.address)).toEqual([NEW_EMAIL]);
    expect(recorded.emailInUseChecks.map((check) => check.email)).toEqual([
      NEW_EMAIL,
    ]);
    expect(stored.map((token) => token.newEmail)).toEqual([NEW_EMAIL]);
  });

  test('新しいアドレスが他の未退会の利用者と重複するなら、同じく数えたうえで、トークンを作らず確認のメールを送らない', async () => {
    const { emailChange, recorded, stored } = setup({
      emailInUse: true,
      tokens: [],
    });

    await emailChange.request(currentOf(), REQUEST, META);

    expect(recorded.calls).toEqual([
      'users.findById',
      'reAuthenticator.verify',
      'limits.consume',
      'users.isEmailInUse',
    ]);
    expect(recorded.limits).toHaveLength(1);
    expect(stored).toEqual([]);
    expect(recorded.mails).toEqual([]);
  });

  test('重複の有無と送信の成否を問わず、要求の結果は同じになる', async () => {
    const outcomes = await Promise.all(
      [
        {},
        { emailInUse: true },
        { mailError: new Error('送信の受付に失敗しました') },
      ].map(async (options) => {
        const { emailChange } = setup(options);
        return emailChange.request(currentOf(), REQUEST, META).then(
          (value: unknown) => ({ resolved: value }),
          (error: unknown) => ({ rejected: error }),
        );
      }),
    );

    expect(outcomes).toEqual(
      Array.from({ length: 3 }, () => ({ resolved: undefined })),
    );
  });

  test('本人確認に失敗したら例外をそのまま投げ、数えず重複も調べずトークンを作らない', async () => {
    const { emailChange, recorded, stored } = setup({
      reAuthError: REAUTHENTICATION_FAILED,
    });

    const error = await caught(emailChange.request(currentOf(), REQUEST, META));

    expect(error).toBe(REAUTHENTICATION_FAILED);
    expect(recorded.calls).toEqual([
      'users.findById',
      'reAuthenticator.verify',
    ]);
    expect(stored).toEqual([EMAIL_CHANGE_TOKEN]);
  });

  test.each([
    ['重複しない', false],
    ['重複する', true],
  ] as const)(
    '送信回数が上限なら、%sアドレスでも同じ例外を投げ、重複を調べずメールを送らない',
    async (_label, emailInUse) => {
      const { emailChange, recorded } = setup({
        emailInUse,
        limitError: RATE_LIMITED,
      });

      const error = await caught(
        emailChange.request(currentOf(), REQUEST, META),
      );

      expect(error).toBe(RATE_LIMITED);
      expect(recorded.calls).toEqual([
        'users.findById',
        'reAuthenticator.verify',
        'limits.consume',
      ]);
      expect(recorded.mails).toEqual([]);
    },
  );
});

describe('StoreEmailChange.confirm', () => {
  test('変更の用途でハッシュ化したトークンを消費し、メールアドレスを更新してから、新しいアドレスの使い捨て判定・変更前のアドレスへの完了メール・操作した端末への再発行を行う', async () => {
    const { emailChange, recorded, stored } = setup();

    const result = await emailChange.confirm(TOKEN, SAME_USER_OPERATOR, META);

    expect(recorded.calls).toEqual([
      'secrets.hashOf',
      'tokens.consume',
      'users.findById',
      'users.applyEmailChange',
      'disposable.checkAndSave',
      'mailer.sendEmailChanged',
      'sessions.reissueForOperator',
    ]);
    expect(recorded.hashed).toEqual([
      { purpose: EMAIL_CHANGE_PURPOSE, plain: TOKEN },
    ]);
    expect(stored).toEqual([]);
    expect(recorded.emailChanges).toEqual([
      { userId: USER_ID, newEmail: NEW_EMAIL, at: NOW },
    ]);
    expect(recorded.disposableChecks).toEqual([
      { user: CHANGED_USER, at: NOW },
    ]);
    expect(recorded.mails).toEqual([
      { method: 'sendEmailChanged', args: [EMAIL, CHANGED_USER, NOW] },
    ]);
    expect(recorded.reissues).toEqual([
      { userId: USER_ID, operator: SAME_USER_OPERATOR, meta: META },
    ]);
    expect(result).toEqual({ session: REISSUED_SESSION });
  });

  test('確認済み・全セッションの削除・未使用の確認と変更のリンクの失効は、利用者のストアの1回のapplyEmailChangeに任せる', async () => {
    const { emailChange, recorded } = setup({
      user: userOf({ emailVerifiedAt: null }),
    });

    await emailChange.confirm(TOKEN, SAME_USER_OPERATOR, META);

    const writes = recorded.calls.filter(
      (call) => call.startsWith('users.apply') || call.startsWith('tokens.'),
    );
    expect(writes).toEqual(['tokens.consume', 'users.applyEmailChange']);
  });

  test('操作した端末が同じ利用者としてログイン中でなければ、新しいセッションを返さない', async () => {
    const { emailChange, recorded } = setup({ reissued: undefined });

    const result = await emailChange.confirm(TOKEN, ANONYMOUS_OPERATOR, META);

    expect(recorded.reissues).toEqual([
      { userId: USER_ID, operator: ANONYMOUS_OPERATOR, meta: META },
    ]);
    expect(result).toEqual({ session: undefined });
  });

  test.each([
    ['存在しない', [] as NewAuthToken[]],
    [
      '期限切れの',
      [{ ...EMAIL_CHANGE_TOKEN, expiresAt: new Date(NOW.getTime()) }],
    ],
    ['ほかの用途の', [{ ...EMAIL_CHANGE_TOKEN, purpose: 'password_change' }]],
  ] as const)(
    '%sトークンは422のinvalid_linkで拒否し、利用者を読まず何も更新しない',
    async (_label, tokens) => {
      const { emailChange, recorded } = setup({ tokens: [...tokens] });

      const error = await caught(
        emailChange.confirm(TOKEN, SAME_USER_OPERATOR, META),
      );

      expect(shapeOf(error)).toEqual(INVALID_LINK);
      expect(recorded.calls).toEqual(['secrets.hashOf', 'tokens.consume']);
    },
  );

  test('新しいメールアドレスが紐づかないトークンはinvalid_linkで拒否し、何も更新しない', async () => {
    const { emailChange, recorded } = setup({
      tokens: [{ ...EMAIL_CHANGE_TOKEN, newEmail: undefined }],
    });

    const error = await caught(
      emailChange.confirm(TOKEN, SAME_USER_OPERATOR, META),
    );

    expect(shapeOf(error)).toEqual(INVALID_LINK);
    expect(recorded.emailChanges).toEqual([]);
  });

  test.each(NOT_CONFIRMABLE_USERS)(
    '%sの利用者のリンクは失効させてinvalid_linkで拒否し、変更もメールも再発行もしない',
    async (_label, user) => {
      const { emailChange, recorded, stored } = setup({ user });

      const error = await caught(
        emailChange.confirm(TOKEN, SAME_USER_OPERATOR, META),
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

  test('確定の時点で新しいアドレスが他の未退会の利用者と重複していたら、リンクを失効させてinvalid_linkで拒否し、判定もメールも再発行もしない', async () => {
    const { emailChange, recorded, stored } = setup({
      emailChangeOutcome: 'email-in-use',
    });

    const error = await caught(
      emailChange.confirm(TOKEN, SAME_USER_OPERATOR, META),
    );

    expect(shapeOf(error)).toEqual(INVALID_LINK);
    expect(stored).toEqual([]);
    expect(recorded.calls.at(-1)).toBe('users.applyEmailChange');
    expect(recorded.disposableChecks).toEqual([]);
    expect(recorded.mails).toEqual([]);
    expect(recorded.reissues).toEqual([]);
  });

  test('2回目の確定は使用済みのトークンとしてinvalid_linkで拒否する', async () => {
    const { emailChange, recorded } = setup();
    await emailChange.confirm(TOKEN, SAME_USER_OPERATOR, META);

    const error = await caught(
      emailChange.confirm(TOKEN, SAME_USER_OPERATOR, META),
    );

    expect(shapeOf(error)).toEqual(INVALID_LINK);
    expect(recorded.emailChanges).toHaveLength(1);
  });

  test('完了メールの送信要求に失敗しても、変更は完了しているため操作した端末へ再発行して成功を返す', async () => {
    const { emailChange, recorded } = setup({
      mailError: new Error('送信の受付に失敗しました'),
    });

    const result = await emailChange.confirm(TOKEN, SAME_USER_OPERATOR, META);

    expect(recorded.mails).toHaveLength(1);
    expect(result).toEqual({ session: REISSUED_SESSION });
  });

  test('使い捨て判定の保存に失敗しても、変更前のアドレスへの完了メールと操作した端末への再発行を行って成功を返す', async () => {
    const { emailChange, recorded } = setup({
      disposableError: new Error('D1の書き込みに失敗しました'),
    });

    const result = await emailChange.confirm(TOKEN, SAME_USER_OPERATOR, META);

    expect(recorded.calls.slice(-3)).toEqual([
      'disposable.checkAndSave',
      'mailer.sendEmailChanged',
      'sessions.reissueForOperator',
    ]);
    expect(result).toEqual({ session: REISSUED_SESSION });
  });

  test('メールアドレスの更新に失敗したら、例外をそのまま投げて判定もメールも再発行もしない', async () => {
    const applyError = new Error('D1の書き込みに失敗しました');
    const { emailChange, recorded } = setup({ applyError });

    const rejection = await rejectionOf(
      emailChange.confirm(TOKEN, SAME_USER_OPERATOR, META),
    );

    expect(rejection).toBe(applyError);
    expect(recorded.disposableChecks).toEqual([]);
    expect(recorded.mails).toEqual([]);
    expect(recorded.reissues).toEqual([]);
  });
});
