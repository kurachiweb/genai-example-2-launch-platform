import { describe, expect, test } from 'bun:test';

import {
  ADMIN_ID,
  adminOf,
  ANONYMOUS_OPERATOR,
  caught,
  currentAdminOf,
  EMAIL,
  EMAIL_CHANGE_PURPOSE,
  EMAIL_CHANGE_TOKEN,
  HOUR_MS,
  INVALID_LINK,
  invitedAdminOf,
  ISSUED_SESSION,
  META,
  NEW_EMAIL,
  NOW,
  OTHER_ADMIN_ID,
  PASSWORD_RESET_TOKEN,
  RATE_LIMITED,
  RE_AUTHENTICATION,
  REAUTHENTICATION_FAILED,
  rejectionOf,
  SAME_ADMIN_OPERATOR,
  setupAdminEmailChange,
  shapeOf,
  TOKEN,
  UNAUTHENTICATED,
} from './testing/admin-credential-change-fakes.ts';

const REQUEST_INPUT = {
  newEmail: NEW_EMAIL,
  reAuthentication: RE_AUTHENTICATION,
} as const;

const OTHER_ADMIN_WITH_NEW_EMAIL = adminOf({
  id: OTHER_ADMIN_ID,
  email: NEW_EMAIL.toUpperCase(),
});

describe('StoreAdminEmailChange.request', () => {
  test('本人確認の後に新しいアドレスで送信回数を数え、重複が無ければ未使用の変更のトークンを置き換えて、24時間有効なリンクを新しいアドレスへ送る', async () => {
    const { emailChange, recorded, stored } = setupAdminEmailChange({
      tokens: [],
    });

    await emailChange.request(currentAdminOf(), REQUEST_INPUT, META);

    expect(recorded.calls).toEqual([
      'admins.findById',
      'reAuthenticator.verify',
      'limits.consume',
      'admins.findByEmail',
      'secrets.issue',
      'tokens.replace',
      'mailer.sendEmailChangeConfirmation',
    ]);
    expect(recorded.reAuthentications).toEqual([
      { admin: adminOf(), input: RE_AUTHENTICATION, meta: META },
    ]);
    expect(recorded.limits).toEqual([
      { kind: 'email_change', address: NEW_EMAIL, meta: META },
    ]);
    const [issued] = recorded.issued;
    expect(issued?.purpose).toBe(EMAIL_CHANGE_PURPOSE);
    const expiresAt = new Date(NOW.getTime() + 24 * HOUR_MS);
    expect(stored).toEqual([
      {
        adminId: ADMIN_ID,
        purpose: 'email_change',
        tokenHash: `hashed(${EMAIL_CHANGE_PURPOSE}):${issued?.plain ?? ''}`,
        expiresAt,
        newEmail: NEW_EMAIL,
      },
    ]);
    expect(recorded.mails).toEqual([
      {
        method: 'sendEmailChangeConfirmation',
        args: [adminOf(), NEW_EMAIL, issued?.plain, expiresAt],
      },
    ]);
  });

  test('同じ管理者の未使用の変更のリンクは新しいリンクに置き換わり、ほかの用途のトークンは残す', async () => {
    const { emailChange, stored } = setupAdminEmailChange({
      tokens: [EMAIL_CHANGE_TOKEN, PASSWORD_RESET_TOKEN],
    });

    await emailChange.request(currentAdminOf(), REQUEST_INPUT, META);

    expect(stored).toHaveLength(2);
    expect(stored).toContainEqual(PASSWORD_RESET_TOKEN);
    expect(stored).not.toContainEqual(EMAIL_CHANGE_TOKEN);
  });

  test('入力の前後の空白を除いたメールアドレスで数え、重複を調べ、リンクに紐づける', async () => {
    const { emailChange, recorded, stored } = setupAdminEmailChange({
      tokens: [],
    });

    await emailChange.request(
      currentAdminOf(),
      { ...REQUEST_INPUT, newEmail: ` ${NEW_EMAIL}\t` },
      META,
    );

    expect(recorded.limits.map((limit) => limit.address)).toEqual([NEW_EMAIL]);
    expect(recorded.emailLookups).toEqual([NEW_EMAIL]);
    expect(stored.map((token) => token.newEmail)).toEqual([NEW_EMAIL]);
  });

  test.each([
    ['有効な', OTHER_ADMIN_WITH_NEW_EMAIL],
    ['招待中の', invitedAdminOf({ id: OTHER_ADMIN_ID, email: NEW_EMAIL })],
  ] as const)(
    '新しいアドレスが大文字小文字を区別せずに他の%s管理者と重複するなら、同じく数えたうえで、トークンを作らず確認のメールを送らない',
    async (_label, other) => {
      const { emailChange, recorded, stored } = setupAdminEmailChange({
        admins: [adminOf(), other],
        tokens: [],
      });

      await emailChange.request(currentAdminOf(), REQUEST_INPUT, META);

      expect(recorded.calls).toEqual([
        'admins.findById',
        'reAuthenticator.verify',
        'limits.consume',
        'admins.findByEmail',
      ]);
      expect(stored).toEqual([]);
      expect(recorded.mails).toEqual([]);
    },
  );

  test('新しいアドレスが自分の現在のアドレスと大文字小文字だけ異なるときは、重複とみなさず確認のメールを送る', async () => {
    const { emailChange, recorded } = setupAdminEmailChange({ tokens: [] });

    await emailChange.request(
      currentAdminOf(),
      { ...REQUEST_INPUT, newEmail: EMAIL.toLowerCase() },
      META,
    );

    expect(recorded.mails.map((mail) => mail.method)).toEqual([
      'sendEmailChangeConfirmation',
    ]);
  });

  test('重複の有無と送信の成否を問わず、要求の結果は同じになる', async () => {
    const outcomes = await Promise.all(
      [
        setupAdminEmailChange(),
        setupAdminEmailChange({
          admins: [adminOf(), OTHER_ADMIN_WITH_NEW_EMAIL],
        }),
        setupAdminEmailChange({ mailError: new Error('送信の基盤の障害') }),
      ].map(({ emailChange }) =>
        emailChange.request(currentAdminOf(), REQUEST_INPUT, META),
      ),
    );

    expect(outcomes).toEqual([undefined, undefined, undefined]);
  });

  test('本人確認に失敗したら例外をそのまま投げ、数えず重複も調べずトークンを作らない', async () => {
    const { emailChange, recorded, stored } = setupAdminEmailChange({
      tokens: [],
      reAuthError: REAUTHENTICATION_FAILED,
    });

    const error = await caught(
      emailChange.request(currentAdminOf(), REQUEST_INPUT, META),
    );

    expect(error).toBe(REAUTHENTICATION_FAILED);
    expect(recorded.calls).toEqual([
      'admins.findById',
      'reAuthenticator.verify',
    ]);
    expect(stored).toEqual([]);
  });

  test.each([
    ['重複しない', [adminOf()]],
    ['重複する', [adminOf(), OTHER_ADMIN_WITH_NEW_EMAIL]],
  ] as const)(
    '送信回数の上限を超えたら、%sアドレスでも重複を調べる前に同じ例外で拒否する',
    async (_label, admins) => {
      const { emailChange, recorded, stored } = setupAdminEmailChange({
        admins,
        tokens: [],
        limitError: RATE_LIMITED,
      });

      const error = await caught(
        emailChange.request(currentAdminOf(), REQUEST_INPUT, META),
      );

      expect(error).toBe(RATE_LIMITED);
      expect(recorded.calls).toEqual([
        'admins.findById',
        'reAuthenticator.verify',
        'limits.consume',
      ]);
      expect(stored).toEqual([]);
      expect(recorded.mails).toEqual([]);
    },
  );

  test.each([
    ['存在しない', []],
    ['招待中の', [invitedAdminOf()]],
  ] as const)(
    '操作者が%s管理者になっていたら、本人確認をせずunauthenticatedで拒否する',
    async (_label, admins) => {
      const { emailChange, recorded } = setupAdminEmailChange({ admins });

      const error = await caught(
        emailChange.request(currentAdminOf(), REQUEST_INPUT, META),
      );

      expect(shapeOf(error)).toEqual(UNAUTHENTICATED);
      expect(recorded.calls).toEqual(['admins.findById']);
    },
  );
});

describe('StoreAdminEmailChange.confirm', () => {
  test('変更の用途でハッシュ化したトークンを消費し、メールアドレスを更新してから、変更前のアドレスへの完了メールと操作した端末への再発行を行う', async () => {
    const { emailChange, recorded, stored } = setupAdminEmailChange();

    const result = await emailChange.confirm(TOKEN, SAME_ADMIN_OPERATOR, META);

    expect(result).toEqual({ session: ISSUED_SESSION });
    expect(recorded.calls).toEqual([
      'secrets.hashOf',
      'tokens.consume',
      'admins.findById',
      'admins.applyEmailChange',
      'mailer.sendEmailChanged',
      'sessions.reissueForOperator',
    ]);
    expect(recorded.hashed).toEqual([
      { purpose: EMAIL_CHANGE_PURPOSE, plain: TOKEN },
    ]);
    expect(recorded.emailChanges).toEqual([
      { adminId: ADMIN_ID, newEmail: NEW_EMAIL },
    ]);
    expect(recorded.mails).toEqual([
      {
        method: 'sendEmailChanged',
        args: [EMAIL, adminOf({ email: NEW_EMAIL }), NOW],
      },
    ]);
    expect(recorded.reissues).toEqual([
      { adminId: ADMIN_ID, operator: SAME_ADMIN_OPERATOR, meta: META },
    ]);
    expect(stored).toEqual([]);
  });

  test('全セッションの削除と未使用の変更のリンクの失効は、管理者のストアの1回のapplyEmailChangeに任せる', async () => {
    const { emailChange, recorded } = setupAdminEmailChange();

    await emailChange.confirm(TOKEN, SAME_ADMIN_OPERATOR, META);

    expect(recorded.emailChanges).toHaveLength(1);
    expect(recorded.sessionIssues).toEqual([]);
  });

  test('操作した端末が同じ管理者としてログイン中でなければ、新しいセッションを返さない', async () => {
    const { emailChange, recorded } = setupAdminEmailChange({
      reissued: undefined,
    });

    const result = await emailChange.confirm(TOKEN, ANONYMOUS_OPERATOR, META);

    expect(result).toEqual({ session: undefined });
    expect(recorded.reissues).toEqual([
      { adminId: ADMIN_ID, operator: ANONYMOUS_OPERATOR, meta: META },
    ]);
    expect(recorded.emailChanges).toHaveLength(1);
  });

  test.each([
    ['存在しない', []],
    [
      '期限切れの',
      [{ ...EMAIL_CHANGE_TOKEN, expiresAt: new Date(NOW.getTime()) }],
    ],
    [
      'ほかの用途の',
      [{ ...EMAIL_CHANGE_TOKEN, purpose: 'password_reset' as const }],
    ],
  ] as const)(
    '%sトークンはinvalid_linkで拒否し、何も更新しない',
    async (_label, tokens) => {
      const { emailChange, recorded } = setupAdminEmailChange({ tokens });

      const error = await caught(
        emailChange.confirm(TOKEN, SAME_ADMIN_OPERATOR, META),
      );

      expect(shapeOf(error)).toEqual(INVALID_LINK);
      expect(recorded.calls).toEqual(['secrets.hashOf', 'tokens.consume']);
    },
  );

  test('新しいメールアドレスが紐づかないトークンはinvalid_linkで拒否し、何も更新しない', async () => {
    const { emailChange, recorded } = setupAdminEmailChange({
      tokens: [
        {
          adminId: EMAIL_CHANGE_TOKEN.adminId,
          purpose: EMAIL_CHANGE_TOKEN.purpose,
          tokenHash: EMAIL_CHANGE_TOKEN.tokenHash,
          expiresAt: EMAIL_CHANGE_TOKEN.expiresAt,
        },
      ],
    });

    const error = await caught(
      emailChange.confirm(TOKEN, SAME_ADMIN_OPERATOR, META),
    );

    expect(shapeOf(error)).toEqual(INVALID_LINK);
    expect(recorded.emailChanges).toEqual([]);
  });

  test.each([
    ['存在しない', []],
    ['招待中の', [invitedAdminOf()]],
  ] as const)(
    'トークンの管理者が%s管理者ならinvalid_linkで拒否し、何も更新しない',
    async (_label, admins) => {
      const { emailChange, recorded } = setupAdminEmailChange({ admins });

      const error = await caught(
        emailChange.confirm(TOKEN, SAME_ADMIN_OPERATOR, META),
      );

      expect(shapeOf(error)).toEqual(INVALID_LINK);
      expect(recorded.emailChanges).toEqual([]);
      expect(recorded.reissues).toEqual([]);
    },
  );

  test('確定の時点で新しいアドレスが他の管理者と重複していたら、リンクを失効させてinvalid_linkで拒否し、メールも再発行もしない', async () => {
    const { emailChange, recorded, stored } = setupAdminEmailChange({
      emailChangeOutcome: 'email-in-use',
    });

    const error = await caught(
      emailChange.confirm(TOKEN, SAME_ADMIN_OPERATOR, META),
    );

    expect(shapeOf(error)).toEqual(INVALID_LINK);
    expect(stored).toEqual([]);
    expect(recorded.mails).toEqual([]);
    expect(recorded.reissues).toEqual([]);
  });

  test('2回目の確定は使用済みのトークンとしてinvalid_linkで拒否する', async () => {
    const { emailChange } = setupAdminEmailChange();
    await emailChange.confirm(TOKEN, SAME_ADMIN_OPERATOR, META);

    const error = await caught(
      emailChange.confirm(TOKEN, SAME_ADMIN_OPERATOR, META),
    );

    expect(shapeOf(error)).toEqual(INVALID_LINK);
  });

  test('完了メールの送信要求に失敗しても、変更は完了しているため操作した端末へ再発行して成功を返す', async () => {
    const { emailChange, recorded } = setupAdminEmailChange({
      mailError: new Error('送信の基盤の障害'),
    });

    const result = await emailChange.confirm(TOKEN, SAME_ADMIN_OPERATOR, META);

    expect(result).toEqual({ session: ISSUED_SESSION });
    expect(recorded.reissues).toHaveLength(1);
  });

  test('メールアドレスの更新に失敗したら、例外をそのまま投げてメールも再発行もしない', async () => {
    const failure = new Error('D1の障害');
    const { emailChange, recorded } = setupAdminEmailChange({
      applyError: failure,
    });

    const error = await rejectionOf(
      emailChange.confirm(TOKEN, SAME_ADMIN_OPERATOR, META),
    );

    expect(error).toBe(failure);
    expect(recorded.mails).toEqual([]);
    expect(recorded.reissues).toEqual([]);
  });
});
