import { describe, expect, test } from 'bun:test';

import type { AuthenticatedPrincipal } from '../../../lib/core/session/session-view.ts';
import {
  LOGIN_CHALLENGE_TTL_SECONDS,
  USER_LOGIN_CHALLENGE_HASH_PURPOSE,
} from './login.ts';
import {
  baseUser,
  caught,
  EMAIL,
  ENABLED_TOTP,
  errorShape,
  LOGIN_META,
  LOGIN_NOW,
  PASSWORD,
  PENDING_TOTP,
  setupLogin,
  USER_ID,
  WRONG_PASSWORD,
} from './testing/login-fakes.ts';

const MS_PER_SECOND = 1000;

const INVALID_CREDENTIALS = {
  kind: 'unauthenticated',
  code: 'invalid_credentials',
  message: 'メールアドレスまたはパスワードが正しくありません。',
  status: 401,
  retryAfterSeconds: undefined,
};

describe('StoreLogin.withPassword', () => {
  test('多要素認証が無ければ、両方の単位の記録を消してからセッションを発行する', async () => {
    const fakes = await setupLogin();

    const result = await fakes.login.withPassword(
      { email: EMAIL, password: PASSWORD },
      LOGIN_META,
    );

    const keys = await fakes.keysFor(EMAIL);
    expect(result).toEqual({
      kind: 'authenticated',
      userId: USER_ID,
      session: {
        sessionId: '01JSESSION0000000000000001',
        token: 'session-token-1',
        maxAgeSeconds: 2_592_000,
      },
    });
    expect(fakes.state.throttleCalls).toEqual([
      { method: 'status', scope: 'user', keys },
      { method: 'reset', scope: 'user', keys },
    ]);
    expect(fakes.state.issuedSessions).toEqual([
      { userId: USER_ID, meta: LOGIN_META },
    ]);
    expect(fakes.state.calls).toEqual([
      'throttle.status',
      'users.findNotWithdrawnByEmail',
      'password.check',
      'totpCredentials.find',
      'throttle.reset',
      'sessions.issue',
    ]);
  });

  test('前後の空白や大文字を含むメールアドレスでも、同じ単位で数えて同じ利用者でログインできる', async () => {
    const fakes = await setupLogin();

    const result = await fakes.login.withPassword(
      { email: '  Taro.Yamada@MAIL.example\t', password: PASSWORD },
      LOGIN_META,
    );

    expect(result.kind).toBe('authenticated');
    expect(fakes.state.throttleCalls[0]?.keys).toEqual(
      await fakes.keysFor(EMAIL),
    );
  });

  test('多要素認証が設定の途中(保留)だけなら、未設定と同じくセッションを発行する', async () => {
    const fakes = await setupLogin({ totp: PENDING_TOTP });

    const result = await fakes.login.withPassword(
      { email: EMAIL, password: PASSWORD },
      LOGIN_META,
    );

    expect(result.kind).toBe('authenticated');
    expect(fakes.state.challenges).toEqual([]);
  });

  test('多要素認証が有効なら、セッションを発行せず記録も消さずに、5分の第2要素の待ちを発行する', async () => {
    const fakes = await setupLogin({ totp: ENABLED_TOTP });

    const result = await fakes.login.withPassword(
      { email: EMAIL, password: PASSWORD },
      LOGIN_META,
    );

    const expiresAt = new Date(
      LOGIN_NOW.getTime() + LOGIN_CHALLENGE_TTL_SECONDS * MS_PER_SECOND,
    );
    expect(LOGIN_CHALLENGE_TTL_SECONDS).toBe(300);
    expect(String(USER_LOGIN_CHALLENGE_HASH_PURPOSE)).toBe(
      'user-login-challenge',
    );
    expect(result).toEqual({
      kind: 'second-factor-required',
      userId: USER_ID,
      challenge: 'challenge-plain-1',
      expiresAt,
    });
    expect(fakes.state.challenges).toEqual([
      {
        id: '01JCHALLENGE00000000000000',
        userId: USER_ID,
        tokenHash: `hashed(${USER_LOGIN_CHALLENGE_HASH_PURPOSE}):challenge-plain-1`,
        expiresAt,
        deleted: false,
      },
    ]);
    expect(fakes.state.issuedSessions).toEqual([]);
    expect(fakes.state.throttleCalls.map((call) => call.method)).toEqual([
      'status',
    ]);
  });

  test('ロック中は利用者を探さずパスワードも照合せずに、待ち時間付きの429で拒否し、失敗として数えない', async () => {
    const fakes = await setupLogin({
      throttleStatus: { locked: true, retryAfterSeconds: 16 },
    });

    const error = await caught(
      fakes.login.withPassword(
        { email: EMAIL, password: PASSWORD },
        LOGIN_META,
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

  test('パスワードが誤りなら両方の単位に失敗を記録し、メールアドレスとパスワードのどちらの誤りかを区別しない文言で拒否する', async () => {
    const fakes = await setupLogin();

    const error = await caught(
      fakes.login.withPassword(
        { email: EMAIL, password: WRONG_PASSWORD },
        LOGIN_META,
      ),
    );

    const keys = await fakes.keysFor(EMAIL);
    expect(errorShape(error)).toEqual(INVALID_CREDENTIALS);
    expect(fakes.state.throttleCalls).toEqual([
      { method: 'status', scope: 'user', keys },
      { method: 'recordFailure', scope: 'user', keys },
    ]);
    expect(fakes.state.issuedSessions).toEqual([]);
  });

  test('利用者が無いときもダミーの照合を1回行って失敗を記録し、パスワードの誤りと同じ応答・同じ処理の並びで拒否する', async () => {
    const unknown = await setupLogin();
    const wrongPassword = await setupLogin();
    const unknownEmail = 'nobody@mail.example';

    const unknownError = await caught(
      unknown.login.withPassword(
        { email: unknownEmail, password: PASSWORD },
        LOGIN_META,
      ),
    );
    const wrongPasswordError = await caught(
      wrongPassword.login.withPassword(
        { email: EMAIL, password: WRONG_PASSWORD },
        LOGIN_META,
      ),
    );

    expect(errorShape(unknownError)).toEqual(INVALID_CREDENTIALS);
    expect(errorShape(wrongPasswordError)).toEqual(INVALID_CREDENTIALS);
    expect(unknown.state.calls).toEqual(wrongPassword.state.calls);
    expect(
      unknown.state.calls.filter((call) => call === 'password.check'),
    ).toHaveLength(1);
    expect(unknown.state.dummyChecks).toBe(1);
    expect(wrongPassword.state.dummyChecks).toBe(0);
    const unknownKeys = await unknown.keysFor(unknownEmail);
    expect(unknown.state.throttleCalls).toEqual([
      { method: 'status', scope: 'user', keys: unknownKeys },
      { method: 'recordFailure', scope: 'user', keys: unknownKeys },
    ]);
  });

  test('退会済みの利用者は、正しいパスワードでも未登録のメールアドレスと同じ応答・同じ処理の並びで拒否する', async () => {
    const withdrawn = await setupLogin({
      users: [baseUser({ deletedAt: new Date('2026-10-20T00:00:00.000Z') })],
    });
    const unknown = await setupLogin({ users: [] });

    const withdrawnError = await caught(
      withdrawn.login.withPassword(
        { email: EMAIL, password: PASSWORD },
        LOGIN_META,
      ),
    );
    const unknownError = await caught(
      unknown.login.withPassword(
        { email: EMAIL, password: PASSWORD },
        LOGIN_META,
      ),
    );

    expect(errorShape(withdrawnError)).toEqual(INVALID_CREDENTIALS);
    expect(errorShape(unknownError)).toEqual(INVALID_CREDENTIALS);
    expect(withdrawn.state.calls).toEqual(unknown.state.calls);
    expect(withdrawn.state.dummyChecks).toBe(1);
    expect(withdrawn.state.issuedSessions).toEqual([]);
  });

  test('停止中の利用者はパスワードが一致したときだけ停止を伝え、失敗として数えず記録も消さない', async () => {
    const fakes = await setupLogin({
      users: [baseUser({ status: 'suspended' })],
    });

    const error = await caught(
      fakes.login.withPassword(
        { email: EMAIL, password: PASSWORD },
        LOGIN_META,
      ),
    );

    expect(errorShape(error)).toEqual({
      kind: 'forbidden',
      code: 'account_unavailable',
      message:
        'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
      status: 403,
      retryAfterSeconds: undefined,
    });
    expect(fakes.state.throttleCalls.map((call) => call.method)).toEqual([
      'status',
    ]);
    expect(fakes.state.issuedSessions).toEqual([]);
    expect(fakes.state.challenges).toEqual([]);
  });

  test('停止中の利用者でもパスワードが誤りなら、停止を伝えず失敗として数える', async () => {
    const fakes = await setupLogin({
      users: [baseUser({ status: 'suspended' })],
    });

    const error = await caught(
      fakes.login.withPassword(
        { email: EMAIL, password: WRONG_PASSWORD },
        LOGIN_META,
      ),
    );

    expect(errorShape(error)).toEqual(INVALID_CREDENTIALS);
    expect(fakes.state.throttleCalls.map((call) => call.method)).toEqual([
      'status',
      'recordFailure',
    ]);
  });
});

describe('StoreLogin.logout', () => {
  const principal = (
    overrides: Partial<AuthenticatedPrincipal> = {},
  ): AuthenticatedPrincipal => ({
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: USER_ID,
    sessionId: '01JSESSION0000000000000009',
    ...overrides,
  });

  test('ログアウトした端末のセッションの記録だけを削除する', async () => {
    const fakes = await setupLogin();

    await fakes.login.logout(principal());

    expect(fakes.state.deletedSessions).toEqual([
      { userId: USER_ID, sessionId: '01JSESSION0000000000000009' },
    ]);
  });

  test('利用者以外の主体のセッションは利用者のセッションの記録から削除しない', async () => {
    const fakes = await setupLogin();

    await fakes.login.logout(principal({ subjectKind: 'admin' }));

    expect(fakes.state.deletedSessions).toEqual([]);
  });
});
