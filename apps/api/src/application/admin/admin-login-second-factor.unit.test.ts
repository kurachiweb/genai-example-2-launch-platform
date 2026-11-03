import { describe, expect, test } from 'bun:test';

import type { AdminRequestMeta } from './ports.ts';
import { ADMIN_LOGIN_CHALLENGE_TTL_SECONDS } from './admin-login.ts';
import {
  ADMIN_EMAIL,
  ADMIN_ID,
  ADMIN_LOGIN_META,
  ADMIN_LOGIN_NOW,
  baseAdmin,
  caught,
  ENABLED_ADMIN_TOTP,
  errorShape,
  FORMATTED_RECOVERY_CODE,
  ISSUED_ADMIN_SESSION,
  RAW_RECOVERY_CODE,
  RESETTING_ADMIN_TOTP,
  setupAdminLogin,
  startAdminChallenge,
  USER_CONTEXT_ADMIN_TOTP,
  VALID_CODE,
  VALID_STEP,
} from './testing/admin-login-fakes.ts';

const MS_PER_SECOND = 1000;

const VALID_TOTP = { kind: 'totp', code: VALID_CODE } as const;

// 設計の「Error Handling」の表の行(`auth`の共有の定義の文言)をそのまま写した期待値
const INVALID_SECOND_FACTOR = {
  kind: 'unauthenticated',
  code: 'invalid_second_factor',
  message: '認証コードが正しくありません。',
  status: 401,
  retryAfterSeconds: undefined,
};

const LOGIN_CHALLENGE_EXPIRED = {
  kind: 'unauthenticated',
  code: 'login_challenge_expired',
  message: '認証の有効期限が切れました。もう一度ログインしてください。',
  status: 401,
  retryAfterSeconds: undefined,
};

describe('StoreAdminLogin.withSecondFactor', () => {
  test('正しい認証コードなら時間窓を使用済みにし、待ちと両方の単位の記録を消してからセッションを発行する', async () => {
    const fakes = await setupAdminLogin();
    const challenge = await startAdminChallenge(fakes);

    const result = await fakes.login.withSecondFactor(
      { challenge, secondFactor: VALID_TOTP },
      ADMIN_LOGIN_META,
    );

    const keys = await fakes.keysFor(ADMIN_EMAIL);
    expect(result).toEqual({
      adminId: ADMIN_ID,
      session: ISSUED_ADMIN_SESSION,
    });
    expect(fakes.state.throttleCalls).toEqual([
      { method: 'status', scope: 'admin', keys },
      { method: 'reset', scope: 'admin', keys },
    ]);
    expect(fakes.state.totpCredential?.lastUsedStep).toBe(VALID_STEP);
    expect(fakes.state.openedContexts).toEqual([`admin:${ADMIN_ID}`]);
    expect(fakes.state.challenges.map((stored) => stored.deleted)).toEqual([
      true,
    ]);
    expect(fakes.state.issuedSessions).toEqual([
      { adminId: ADMIN_ID, meta: ADMIN_LOGIN_META },
    ]);
    expect(fakes.state.calls).toEqual([
      'challenges.findValid',
      'admins.findById',
      'throttle.status',
      'totpCredentials.find',
      'secretBox.open',
      'totp.verify',
      'totpCredentials.advanceStep',
      'challenges.delete',
      'throttle.reset',
      'sessions.issue',
    ]);
  });

  test('全角の数字や空白を含む認証コードも半角の6桁に揃えて照合する', async () => {
    const fakes = await setupAdminLogin();
    const challenge = await startAdminChallenge(fakes);

    const result = await fakes.login.withSecondFactor(
      { challenge, secondFactor: { kind: 'totp', code: ' １２３ ４５６ ' } },
      ADMIN_LOGIN_META,
    );

    expect(result.adminId).toBe(ADMIN_ID);
  });

  test('使用済みの時間窓の認証コードの再使用は、セッションを発行せず失敗として数えて拒否する', async () => {
    const fakes = await setupAdminLogin();
    const first = await startAdminChallenge(fakes);
    await fakes.login.withSecondFactor(
      { challenge: first, secondFactor: VALID_TOTP },
      ADMIN_LOGIN_META,
    );
    const second = await startAdminChallenge(fakes);
    fakes.state.issuedSessions.length = 0;

    const error = await caught(
      fakes.login.withSecondFactor(
        { challenge: second, secondFactor: VALID_TOTP },
        ADMIN_LOGIN_META,
      ),
    );

    const keys = await fakes.keysFor(ADMIN_EMAIL);
    expect(errorShape(error)).toEqual(INVALID_SECOND_FACTOR);
    expect(fakes.state.throttleCalls).toEqual([
      { method: 'status', scope: 'admin', keys },
      { method: 'recordFailure', scope: 'admin', keys },
    ]);
    expect(fakes.state.issuedSessions).toEqual([]);
    expect(fakes.state.challenges.map((stored) => stored.deleted)).toEqual([
      true,
      false,
    ]);
  });

  test.each([
    ['誤った認証コード', { kind: 'totp', code: '654321' }],
    ['6桁の数字でない認証コード', { kind: 'totp', code: '12345a' }],
    ['誤ったリカバリコード', { kind: 'recovery', code: 'wxyz-wxyz-wxyz-wxyz' }],
    ['形式の合わないリカバリコード', { kind: 'recovery', code: '!!' }],
  ] as const)(
    '%sは、セッションを発行せず待ちを残し、失敗として数えて拒否する',
    async (_label, secondFactor) => {
      const fakes = await setupAdminLogin({
        recoveryRawCodes: [RAW_RECOVERY_CODE],
      });
      const challenge = await startAdminChallenge(fakes);

      const error = await caught(
        fakes.login.withSecondFactor(
          { challenge, secondFactor },
          ADMIN_LOGIN_META,
        ),
      );

      expect(errorShape(error)).toEqual(INVALID_SECOND_FACTOR);
      expect(fakes.state.throttleCalls.map((call) => call.method)).toEqual([
        'status',
        'recordFailure',
      ]);
      expect(fakes.state.issuedSessions).toEqual([]);
      expect(fakes.state.challenges.map((stored) => stored.deleted)).toEqual([
        false,
      ]);
      expect(fakes.state.recoveryHashes.size).toBe(1);
    },
  );

  test('正しいリカバリコードは使用済みにしてセッションを発行し、同じコードの2回目は失敗として数えて拒否する', async () => {
    const fakes = await setupAdminLogin({
      recoveryRawCodes: [RAW_RECOVERY_CODE],
    });
    const first = await startAdminChallenge(fakes);

    const result = await fakes.login.withSecondFactor(
      {
        challenge: first,
        secondFactor: { kind: 'recovery', code: FORMATTED_RECOVERY_CODE },
      },
      ADMIN_LOGIN_META,
    );

    expect(result).toEqual({
      adminId: ADMIN_ID,
      session: ISSUED_ADMIN_SESSION,
    });
    expect(fakes.state.recoveryHashes.size).toBe(0);
    expect(fakes.state.calls).toEqual([
      'challenges.findValid',
      'admins.findById',
      'throttle.status',
      'recoveryCodes.consume',
      'challenges.delete',
      'throttle.reset',
      'sessions.issue',
    ]);

    const second = await startAdminChallenge(fakes);
    const error = await caught(
      fakes.login.withSecondFactor(
        {
          challenge: second,
          secondFactor: { kind: 'recovery', code: FORMATTED_RECOVERY_CODE },
        },
        ADMIN_LOGIN_META,
      ),
    );
    expect(errorShape(error)).toEqual(INVALID_SECOND_FACTOR);
    expect(fakes.state.throttleCalls.map((call) => call.method)).toEqual([
      'status',
      'recordFailure',
    ]);
  });

  test('再設定の途中なら保留の秘密鍵ではなく現在の秘密鍵で照合する', async () => {
    const fakes = await setupAdminLogin({ totp: RESETTING_ADMIN_TOTP });
    const challenge = await startAdminChallenge(fakes);

    const error = await caught(
      fakes.login.withSecondFactor(
        { challenge, secondFactor: VALID_TOTP },
        ADMIN_LOGIN_META,
      ),
    );

    expect(errorShape(error)).toEqual(INVALID_SECOND_FACTOR);
    expect(fakes.state.calls).toContain('totp.verify');
  });

  test.each([
    ['多要素認証の設定が無い', null],
    ['秘密鍵を確定していない', { ...ENABLED_ADMIN_TOTP, sealedSecret: null }],
    ['有効化していない', { ...ENABLED_ADMIN_TOTP, enabledAt: null }],
  ] as const)(
    '%s管理者の認証コードは、秘密鍵を開かずに失敗として数えて拒否する',
    async (_label, totp) => {
      const fakes = await setupAdminLogin({ totp });
      const challenge = await startAdminChallenge(fakes);

      const error = await caught(
        fakes.login.withSecondFactor(
          { challenge, secondFactor: VALID_TOTP },
          ADMIN_LOGIN_META,
        ),
      );

      expect(errorShape(error)).toEqual(INVALID_SECOND_FACTOR);
      expect(fakes.state.calls).not.toContain('secretBox.open');
      expect(fakes.state.throttleCalls.map((call) => call.method)).toEqual([
        'status',
        'recordFailure',
      ]);
    },
  );

  test('秘密鍵は管理者の文脈(admin:<ID>)で開き、他の文脈で封じた秘密鍵は照合に使わない', async () => {
    const fakes = await setupAdminLogin({ totp: USER_CONTEXT_ADMIN_TOTP });
    const challenge = await startAdminChallenge(fakes);

    const failure: unknown = await fakes.login
      .withSecondFactor(
        { challenge, secondFactor: VALID_TOTP },
        ADMIN_LOGIN_META,
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('文脈が一致しない');
    expect(fakes.state.openedContexts).toEqual([`admin:${ADMIN_ID}`]);
    expect(fakes.state.issuedSessions).toEqual([]);
  });

  test('ロック中は第2要素を照合せず、待ちも残して429で拒否し、失敗として数えない', async () => {
    const fakes = await setupAdminLogin({
      recoveryRawCodes: [RAW_RECOVERY_CODE],
    });
    const challenge = await startAdminChallenge(fakes);
    fakes.state.throttleStatus = { locked: true, retryAfterSeconds: 300 };

    const error = await caught(
      fakes.login.withSecondFactor(
        {
          challenge,
          secondFactor: { kind: 'recovery', code: FORMATTED_RECOVERY_CODE },
        },
        ADMIN_LOGIN_META,
      ),
    );

    expect(errorShape(error)).toEqual({
      kind: 'rate_limited',
      code: 'login_throttled',
      message:
        'ログイン試行が続いたため、しばらく待ってから再度お試しください。',
      status: 429,
      retryAfterSeconds: 300,
    });
    expect(fakes.state.calls).toEqual([
      'challenges.findValid',
      'admins.findById',
      'throttle.status',
    ]);
    expect(fakes.state.recoveryHashes.size).toBe(1);
    expect(fakes.state.challenges.map((stored) => stored.deleted)).toEqual([
      false,
    ]);
  });

  test('待ちの発行後にメールアドレスが変わっても、現在のメールアドレスの単位で数える', async () => {
    const fakes = await setupAdminLogin();
    const challenge = await startAdminChallenge(fakes);
    const changedEmail = 'admin1-new@mail.example';
    fakes.state.admins.set(ADMIN_ID, baseAdmin({ email: changedEmail }));

    await caught(
      fakes.login.withSecondFactor(
        { challenge, secondFactor: { kind: 'totp', code: '000000' } },
        ADMIN_LOGIN_META,
      ),
    );

    const keys = await fakes.keysFor(changedEmail);
    expect(fakes.state.throttleCalls).toEqual([
      { method: 'status', scope: 'admin', keys },
      { method: 'recordFailure', scope: 'admin', keys },
    ]);
  });

  test('5分を過ぎた待ちや存在しない待ちは、照合も記録もせずにログインからやり直させる', async () => {
    const fakes = await setupAdminLogin();
    const challenge = await startAdminChallenge(fakes);
    const expiredMeta: AdminRequestMeta = {
      ...ADMIN_LOGIN_META,
      now: new Date(
        ADMIN_LOGIN_NOW.getTime() +
          ADMIN_LOGIN_CHALLENGE_TTL_SECONDS * MS_PER_SECOND,
      ),
    };

    const expired = await caught(
      fakes.login.withSecondFactor(
        { challenge, secondFactor: VALID_TOTP },
        expiredMeta,
      ),
    );
    const unknown = await caught(
      fakes.login.withSecondFactor(
        { challenge: 'unknown-challenge', secondFactor: VALID_TOTP },
        ADMIN_LOGIN_META,
      ),
    );

    expect(errorShape(expired)).toEqual(LOGIN_CHALLENGE_EXPIRED);
    expect(errorShape(unknown)).toEqual(LOGIN_CHALLENGE_EXPIRED);
    expect(fakes.state.throttleCalls).toEqual([]);
    expect(fakes.state.calls).toEqual([
      'challenges.findValid',
      'challenges.findValid',
    ]);
  });

  test.each([
    ['削除された', undefined],
    [
      '招待中に戻った',
      baseAdmin({
        status: 'invited',
        invitationExpiresAt: new Date('2026-11-04T00:00:00.000Z'),
      }),
    ],
  ] as const)(
    '待ちの発行後に%s管理者は、待ちを消し、照合も記録もせずにログインからやり直させる',
    async (_label, replacement) => {
      const fakes = await setupAdminLogin();
      const challenge = await startAdminChallenge(fakes);
      if (replacement === undefined) {
        fakes.state.admins.delete(ADMIN_ID);
      } else {
        fakes.state.admins.set(ADMIN_ID, replacement);
      }

      const error = await caught(
        fakes.login.withSecondFactor(
          { challenge, secondFactor: VALID_TOTP },
          ADMIN_LOGIN_META,
        ),
      );

      expect(errorShape(error)).toEqual(LOGIN_CHALLENGE_EXPIRED);
      expect(fakes.state.calls).toEqual([
        'challenges.findValid',
        'admins.findById',
        'challenges.delete',
      ]);
      expect(fakes.state.issuedSessions).toEqual([]);
    },
  );
});
