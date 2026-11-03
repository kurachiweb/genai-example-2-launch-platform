import { describe, expect, test } from 'bun:test';

import type { AuthenticatedPrincipal } from '../session/session-verifier.ts';
import { ADMIN_LOGIN_CHALLENGE_TTL_SECONDS } from './admin-login.ts';
import {
  ADMIN_EMAIL,
  ADMIN_ID,
  ADMIN_LOGIN_META,
  ADMIN_LOGIN_NOW,
  baseAdmin,
  caught,
  errorShape,
  PASSWORD,
  setupAdminLogin,
  WRONG_PASSWORD,
} from './testing/admin-login-fakes.ts';

const MS_PER_SECOND = 1000;

// 設計の「Error Handling」の表の行をそのまま写した期待値
const INVALID_CREDENTIALS = {
  kind: 'unauthenticated',
  code: 'invalid_credentials',
  message: 'メールアドレスまたはパスワードが正しくありません。',
  status: 401,
  retryAfterSeconds: undefined,
};

const INVITED_WITH_PASSWORD = baseAdmin({
  status: 'invited',
  invitationExpiresAt: new Date('2026-11-04T00:00:00.000Z'),
  activatedAt: null,
});

const INVITED_WITHOUT_PASSWORD = baseAdmin({
  status: 'invited',
  invitationExpiresAt: new Date('2026-11-04T00:00:00.000Z'),
  passwordHash: null,
  nickname: null,
  activatedAt: null,
});

describe('StoreAdminLogin.withPassword', () => {
  test('有効な管理者はパスワードが正しくてもセッションを発行せず、記録も消さずに5分の第2要素の待ちを発行する', async () => {
    const fakes = await setupAdminLogin();

    const result = await fakes.login.withPassword(
      { email: ADMIN_EMAIL, password: PASSWORD },
      ADMIN_LOGIN_META,
    );

    const keys = await fakes.keysFor(ADMIN_EMAIL);
    const expiresAt = new Date(
      ADMIN_LOGIN_NOW.getTime() +
        ADMIN_LOGIN_CHALLENGE_TTL_SECONDS * MS_PER_SECOND,
    );
    expect(ADMIN_LOGIN_CHALLENGE_TTL_SECONDS).toBe(300);
    expect(result).toEqual({
      adminId: ADMIN_ID,
      challenge: 'challenge-plain-1',
      expiresAt,
    });
    expect(fakes.state.challenges).toEqual([
      {
        id: '01JC0CHLG00000000000000000',
        adminId: ADMIN_ID,
        tokenHash: 'hashed(admin-login-challenge):challenge-plain-1',
        expiresAt,
        deleted: false,
      },
    ]);
    expect(fakes.state.issuedSessions).toEqual([]);
    expect(fakes.state.throttleCalls).toEqual([
      { method: 'status', scope: 'admin', keys },
    ]);
    expect(fakes.state.calls).toEqual([
      'throttle.status',
      'admins.findByEmail',
      'password.check',
      'challenges.insert',
    ]);
  });

  test('多要素認証の設定が読めなくても、パスワードだけでセッションを発行する経路は無い', async () => {
    const fakes = await setupAdminLogin({ totp: null });

    const result = await fakes.login.withPassword(
      { email: ADMIN_EMAIL, password: PASSWORD },
      ADMIN_LOGIN_META,
    );

    expect(result.challenge).toBe('challenge-plain-1');
    expect(fakes.state.issuedSessions).toEqual([]);
  });

  test('前後の空白や大文字を含むメールアドレスでも、同じ単位で数えて同じ管理者の待ちを発行する', async () => {
    const fakes = await setupAdminLogin();

    const result = await fakes.login.withPassword(
      { email: '  Admin1@MAIL.example\t', password: PASSWORD },
      ADMIN_LOGIN_META,
    );

    expect(result.adminId).toBe(ADMIN_ID);
    expect(fakes.state.throttleCalls[0]?.keys).toEqual(
      await fakes.keysFor(ADMIN_EMAIL),
    );
  });

  test('ロック中は管理者を探さずパスワードも照合せずに、待ち時間付きの429で拒否し、失敗として数えない', async () => {
    const fakes = await setupAdminLogin({
      throttleStatus: { locked: true, retryAfterSeconds: 16 },
    });

    const error = await caught(
      fakes.login.withPassword(
        { email: ADMIN_EMAIL, password: PASSWORD },
        ADMIN_LOGIN_META,
      ),
    );

    expect(errorShape(error)).toEqual({
      kind: 'rate_limited',
      code: 'login_throttled',
      message:
        'ログイン試行が続いたため、しばらく待ってから再度お試しください。',
      status: 429,
      retryAfterSeconds: 16,
    });
    expect(fakes.state.calls).toEqual(['throttle.status']);
  });

  test('パスワードが誤りなら管理者のスコープで両方の単位に失敗を記録し、どちらの誤りかを区別しない文言で拒否する', async () => {
    const fakes = await setupAdminLogin();

    const error = await caught(
      fakes.login.withPassword(
        { email: ADMIN_EMAIL, password: WRONG_PASSWORD },
        ADMIN_LOGIN_META,
      ),
    );

    const keys = await fakes.keysFor(ADMIN_EMAIL);
    expect(errorShape(error)).toEqual(INVALID_CREDENTIALS);
    expect(fakes.state.throttleCalls).toEqual([
      { method: 'status', scope: 'admin', keys },
      { method: 'recordFailure', scope: 'admin', keys },
    ]);
    expect(keys.ip).toBeDefined();
    expect(fakes.state.challenges).toEqual([]);
    expect(fakes.state.issuedSessions).toEqual([]);
  });

  test.each([
    ['未登録のメールアドレス', [baseAdmin()], 'nobody@mail.example'],
    [
      'パスワードを仮に保存した招待中の管理者',
      [INVITED_WITH_PASSWORD],
      ADMIN_EMAIL,
    ],
    [
      'パスワードを保存していない招待中の管理者',
      [INVITED_WITHOUT_PASSWORD],
      ADMIN_EMAIL,
    ],
  ] as const)(
    '%sは、ダミーの照合を1回行って失敗を記録し、パスワードの誤りと同じ応答・同じ処理の並びで拒否する',
    async (_label, admins, email) => {
      const target = await setupAdminLogin({ admins });
      const wrongPassword = await setupAdminLogin();

      const targetError = await caught(
        target.login.withPassword(
          { email, password: PASSWORD },
          ADMIN_LOGIN_META,
        ),
      );
      const wrongPasswordError = await caught(
        wrongPassword.login.withPassword(
          { email: ADMIN_EMAIL, password: WRONG_PASSWORD },
          ADMIN_LOGIN_META,
        ),
      );

      expect(errorShape(targetError)).toEqual(INVALID_CREDENTIALS);
      expect(errorShape(wrongPasswordError)).toEqual(INVALID_CREDENTIALS);
      expect(target.state.calls).toEqual(wrongPassword.state.calls);
      expect(target.state.dummyChecks).toBe(1);
      expect(wrongPassword.state.dummyChecks).toBe(0);
      const keys = await target.keysFor(email);
      expect(target.state.throttleCalls).toEqual([
        { method: 'status', scope: 'admin', keys },
        { method: 'recordFailure', scope: 'admin', keys },
      ]);
      expect(target.state.challenges).toEqual([]);
    },
  );

  test('送信元IPアドレスが不明なら、メールアドレスの単位だけで数える', async () => {
    const fakes = await setupAdminLogin();

    await caught(
      fakes.login.withPassword(
        { email: ADMIN_EMAIL, password: WRONG_PASSWORD },
        { ...ADMIN_LOGIN_META, clientIp: undefined },
      ),
    );

    expect(fakes.state.throttleCalls.map((call) => call.keys.ip)).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe('StoreAdminLogin.logout', () => {
  test('その端末のセッションだけを削除する', async () => {
    const fakes = await setupAdminLogin();
    const principal: AuthenticatedPrincipal = {
      kind: 'authenticated',
      subjectKind: 'admin',
      subjectId: ADMIN_ID,
      sessionId: '01JC0SESN00000000000000009',
    };

    await fakes.login.logout(principal);

    expect(fakes.state.deletedSessions).toEqual([
      { adminId: ADMIN_ID, sessionId: '01JC0SESN00000000000000009' },
    ]);
    expect(fakes.state.calls).toEqual(['sessions.deleteOne']);
  });

  test('管理者でない主体のセッションは管理者のセッションとして削除しない', async () => {
    const fakes = await setupAdminLogin();

    await fakes.login.logout({
      kind: 'authenticated',
      subjectKind: 'user',
      subjectId: '01JUSER000000000000000000A',
      sessionId: '01JSESSION0000000000000001',
    });

    expect(fakes.state.deletedSessions).toEqual([]);
    expect(fakes.state.calls).toEqual([]);
  });
});
