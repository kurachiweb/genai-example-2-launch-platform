import { describe, expect, test } from 'bun:test';

import {
  ADMIN_ID,
  adminOf,
  caught,
  EMAIL,
  EMAIL_CHANGE_TOKEN,
  INVALID_LINK,
  invitedAdminOf,
  META,
  MINUTE_MS,
  NEW_PASSWORD,
  NICKNAME,
  NOW,
  OTHER_ADMIN_ID,
  OTHER_EMAIL,
  PASSWORD_RESET_PURPOSE,
  PASSWORD_RESET_TOKEN,
  RATE_LIMITED,
  rejectionOf,
  setupAdminPasswordReset,
  shapeOf,
  storedHashOf,
  TOKEN,
} from './testing/admin-credential-change-fakes.ts';

const COMPLETE_INPUT = { token: TOKEN, newPassword: NEW_PASSWORD } as const;

describe('StoreAdminPasswordReset.request', () => {
  test('有効な管理者には、送信回数を数えてから未使用のリセットのトークンを置き換え、30分有効なリンクを送る', async () => {
    const { passwordReset, recorded, stored } = setupAdminPasswordReset({
      tokens: [],
    });

    await passwordReset.request(EMAIL, META);

    expect(recorded.calls).toEqual([
      'limits.consume',
      'admins.findByEmail',
      'secrets.issue',
      'tokens.replace',
      'mailer.sendPasswordReset',
    ]);
    expect(recorded.limits).toEqual([
      { kind: 'password_reset', address: EMAIL, meta: META },
    ]);
    const [issued] = recorded.issued;
    expect(issued?.purpose).toBe(PASSWORD_RESET_PURPOSE);
    const expiresAt = new Date(NOW.getTime() + 30 * MINUTE_MS);
    expect(stored).toEqual([
      {
        adminId: ADMIN_ID,
        purpose: 'password_reset',
        tokenHash: `hashed(${PASSWORD_RESET_PURPOSE}):${issued?.plain ?? ''}`,
        expiresAt,
      },
    ]);
    expect(recorded.mails).toEqual([
      {
        method: 'sendPasswordReset',
        args: [adminOf(), issued?.plain, expiresAt],
      },
    ]);
  });

  test('同じ管理者の未使用のリセットのリンクは新しいリンクに置き換わり、ほかの用途のトークンは残す', async () => {
    const { passwordReset, stored } = setupAdminPasswordReset({
      tokens: [PASSWORD_RESET_TOKEN, EMAIL_CHANGE_TOKEN],
    });

    await passwordReset.request(EMAIL, META);

    expect(stored).toHaveLength(2);
    expect(stored).toContainEqual(EMAIL_CHANGE_TOKEN);
    expect(stored).not.toContainEqual(PASSWORD_RESET_TOKEN);
  });

  test('入力の前後の空白を除いたメールアドレスで数え、管理者を探す', async () => {
    const { passwordReset, recorded } = setupAdminPasswordReset();

    await passwordReset.request(`\u3000 ${EMAIL}\n`, META);

    expect(recorded.limits.map((limit) => limit.address)).toEqual([EMAIL]);
    expect(recorded.emailLookups).toEqual([EMAIL]);
  });

  test.each([
    ['未登録', [adminOf({ id: OTHER_ADMIN_ID, email: OTHER_EMAIL })]],
    ['招待中', [invitedAdminOf()]],
  ] as const)(
    '%sの管理者のメールアドレスなら、同じく数えたうえで、トークンを作らずメールを送らない',
    async (_label, admins) => {
      const { passwordReset, recorded, stored } = setupAdminPasswordReset({
        admins,
        tokens: [],
      });

      await passwordReset.request(EMAIL, META);

      expect(recorded.calls).toEqual(['limits.consume', 'admins.findByEmail']);
      expect(stored).toEqual([]);
      expect(recorded.mails).toEqual([]);
    },
  );

  test('管理者の有無・状態と送信の成否を問わず、要求の結果は同じになる', async () => {
    const outcomes = await Promise.all(
      [
        setupAdminPasswordReset(),
        setupAdminPasswordReset({ admins: [] }),
        setupAdminPasswordReset({ admins: [invitedAdminOf()] }),
        setupAdminPasswordReset({ mailError: new Error('送信の基盤の障害') }),
      ].map(({ passwordReset }) => passwordReset.request(EMAIL, META)),
    );

    expect(outcomes).toEqual([undefined, undefined, undefined, undefined]);
  });

  test('リンクのメールの送信要求に失敗しても、管理者の有無を推測させないよう同じ結果を返し、トークンは置き換え済みのまま残す', async () => {
    const { passwordReset, recorded, stored } = setupAdminPasswordReset({
      tokens: [],
      mailError: new Error('送信の基盤の障害'),
    });

    await passwordReset.request(EMAIL, META);

    expect(recorded.calls.at(-1)).toBe('mailer.sendPasswordReset');
    expect(stored).toHaveLength(1);
  });

  test.each([
    ['有効な管理者', [adminOf()]],
    ['未登録', []],
    ['招待中', [invitedAdminOf()]],
  ] as const)(
    '送信回数の上限を超えたら、%sのメールアドレスでも管理者を探す前に同じ例外で拒否する',
    async (_label, admins) => {
      const { passwordReset, recorded, stored } = setupAdminPasswordReset({
        admins,
        tokens: [],
        limitError: RATE_LIMITED,
      });

      const error = await caught(passwordReset.request(EMAIL, META));

      expect(error).toBe(RATE_LIMITED);
      expect(recorded.calls).toEqual(['limits.consume']);
      expect(stored).toEqual([]);
      expect(recorded.mails).toEqual([]);
    },
  );
});

describe('StoreAdminPasswordReset.complete', () => {
  test('リセットの用途でハッシュ化したトークンで管理者を特定し、方針の確認とハッシュ化の後にトークンを消費して、パスワードの更新と完了メールを行う', async () => {
    const { passwordReset, recorded, stored } = setupAdminPasswordReset();

    await passwordReset.complete(COMPLETE_INPUT, META);

    expect(recorded.calls).toEqual([
      'secrets.hashOf',
      'tokens.findValid',
      'admins.findById',
      'policy.validateNewPassword',
      'password.hash',
      'tokens.consume',
      'admins.applyPasswordReset',
      'mailer.sendPasswordResetCompleted',
    ]);
    expect(recorded.hashed).toEqual([
      { purpose: PASSWORD_RESET_PURPOSE, plain: TOKEN },
    ]);
    expect(recorded.policyChecks).toEqual([
      {
        password: NEW_PASSWORD,
        identifiers: { nickname: NICKNAME, email: EMAIL },
      },
    ]);
    expect(recorded.passwordResets).toEqual([
      { adminId: ADMIN_ID, passwordHash: storedHashOf(NEW_PASSWORD) },
    ]);
    expect(recorded.mails).toEqual([
      { method: 'sendPasswordResetCompleted', args: [adminOf(), NOW] },
    ]);
    expect(stored).toEqual([]);
  });

  test('全セッションの削除と未使用のリセットのリンクの失効は管理者のストアの1回のapplyPasswordResetに任せ、多要素認証の設定に触れず、新しいセッションも発行しない', async () => {
    const { passwordReset, recorded } = setupAdminPasswordReset();

    await passwordReset.complete(COMPLETE_INPUT, META);

    expect(recorded.passwordResets).toHaveLength(1);
    const writes = recorded.calls.filter(
      (call) =>
        !call.startsWith('secrets.') &&
        !call.startsWith('policy.') &&
        !call.startsWith('password.') &&
        !call.includes('.find'),
    );
    expect(writes).toEqual([
      'tokens.consume',
      'admins.applyPasswordReset',
      'mailer.sendPasswordResetCompleted',
    ]);
    expect(recorded.sessionIssues).toEqual([]);
    expect(recorded.reissues).toEqual([]);
  });

  test('漏洩の照合を省いたときも完了する', async () => {
    const { passwordReset, recorded } = setupAdminPasswordReset({
      validation: { ok: true, pwnedCheck: 'skipped' },
    });

    await passwordReset.complete(COMPLETE_INPUT, META);

    expect(recorded.passwordResets).toHaveLength(1);
  });

  test.each([
    ['存在しない', []],
    [
      '期限切れの',
      [{ ...PASSWORD_RESET_TOKEN, expiresAt: new Date(NOW.getTime()) }],
    ],
    [
      'ほかの用途の',
      [{ ...PASSWORD_RESET_TOKEN, purpose: 'email_change' as const }],
    ],
  ] as const)(
    '%sトークンはinvalid_linkで拒否し、何も更新しない',
    async (_label, tokens) => {
      const { passwordReset, recorded } = setupAdminPasswordReset({ tokens });

      const error = await caught(passwordReset.complete(COMPLETE_INPUT, META));

      expect(shapeOf(error)).toEqual(INVALID_LINK);
      expect(recorded.calls).toEqual(['secrets.hashOf', 'tokens.findValid']);
    },
  );

  test.each([
    ['存在しない', []],
    ['招待中の', [invitedAdminOf()]],
  ] as const)(
    'トークンの管理者が%s管理者ならinvalid_linkで拒否し、トークンを消費しない',
    async (_label, admins) => {
      const { passwordReset, recorded, stored } = setupAdminPasswordReset({
        admins,
      });

      const error = await caught(passwordReset.complete(COMPLETE_INPUT, META));

      expect(shapeOf(error)).toEqual(INVALID_LINK);
      expect(recorded.calls).not.toContain('policy.validateNewPassword');
      expect(stored).toEqual([PASSWORD_RESET_TOKEN]);
    },
  );

  test('方針に反したパスワードは、新しいパスワードの欄のpassword_rejectedで拒否し、トークンを消費せず更新しない', async () => {
    const { passwordReset, recorded, stored } = setupAdminPasswordReset({
      validation: { ok: false, violation: 'matches-identity' },
    });

    const error = await caught(passwordReset.complete(COMPLETE_INPUT, META));

    expect(error.kind).toBe('unprocessable');
    expect(error.code).toBe('password_rejected');
    expect(error.details).toEqual([
      {
        field: 'newPassword',
        code: 'matches_identity',
        message:
          'ニックネーム・メールアドレス(@より前の部分を含む)と同じパスワードは使えません。',
      },
    ]);
    expect(recorded.calls).not.toContain('tokens.consume');
    expect(recorded.passwordResets).toEqual([]);
    expect(stored).toEqual([PASSWORD_RESET_TOKEN]);
  });

  test('同時の確定に負けてトークンを消費できなければinvalid_linkで拒否し、パスワードを更新せずメールを送らない', async () => {
    const { passwordReset, recorded } = setupAdminPasswordReset({
      consumeLoses: true,
    });

    const error = await caught(passwordReset.complete(COMPLETE_INPUT, META));

    expect(shapeOf(error)).toEqual(INVALID_LINK);
    expect(recorded.passwordResets).toEqual([]);
    expect(recorded.mails).toEqual([]);
  });

  test('2回目の確定は使用済みのトークンとしてinvalid_linkで拒否する', async () => {
    const { passwordReset } = setupAdminPasswordReset();
    await passwordReset.complete(COMPLETE_INPUT, META);

    const error = await caught(passwordReset.complete(COMPLETE_INPUT, META));

    expect(shapeOf(error)).toEqual(INVALID_LINK);
  });

  test('完了メールの送信要求に失敗しても、パスワードの更新は完了しているため成功を返す', async () => {
    const { passwordReset, recorded } = setupAdminPasswordReset({
      mailError: new Error('送信の基盤の障害'),
    });

    await passwordReset.complete(COMPLETE_INPUT, META);

    expect(recorded.passwordResets).toHaveLength(1);
  });

  test('パスワードの更新に失敗したら、例外をそのまま投げて完了メールを送らない', async () => {
    const failure = new Error('D1の障害');
    const { passwordReset, recorded } = setupAdminPasswordReset({
      applyError: failure,
    });

    const error = await rejectionOf(
      passwordReset.complete(COMPLETE_INPUT, META),
    );

    expect(error).toBe(failure);
    expect(recorded.mails).toEqual([]);
  });
});
