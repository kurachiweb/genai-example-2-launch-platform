import { describe, expect, test } from 'bun:test';

import { LOGIN_CHALLENGE_TTL_SECONDS } from './login.ts';
import type { RequestMeta } from './request-meta.ts';
import {
  baseUser,
  caught,
  EMAIL,
  ENABLED_TOTP,
  errorShape,
  FORMATTED_RECOVERY_CODE,
  LOGIN_META,
  LOGIN_NOW,
  RAW_RECOVERY_CODE,
  setupLogin,
  startChallenge,
  USER_ID,
  VALID_CODE,
} from './testing/login-fakes.ts';

const MS_PER_SECOND = 1000;

const VALID_TOTP = { kind: 'totp', code: VALID_CODE } as const;

describe('StoreLogin.withSecondFactor', () => {
  test('正しい認証コードなら時間窓を使用済みにし、待ちを消して記録を消してからセッションを発行する', async () => {
    const fakes = await setupLogin({ totp: ENABLED_TOTP });
    const challenge = await startChallenge(fakes);

    const result = await fakes.login.withSecondFactor(
      { challenge, secondFactor: VALID_TOTP },
      LOGIN_META,
    );

    const keys = await fakes.keysFor(EMAIL);
    expect(result).toEqual({
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
    expect(fakes.state.challenges.map((stored) => stored.deleted)).toEqual([
      true,
    ]);
    expect(fakes.state.issuedSessions).toEqual([
      { userId: USER_ID, meta: LOGIN_META },
    ]);
    expect(fakes.state.calls).toEqual([
      'challenges.findValid',
      'users.findById',
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

  test('成功した待ちの値の2回目は、期限切れとして拒否する', async () => {
    const fakes = await setupLogin({ totp: ENABLED_TOTP });
    const challenge = await startChallenge(fakes);
    await fakes.login.withSecondFactor(
      { challenge, secondFactor: VALID_TOTP },
      LOGIN_META,
    );

    const error = await caught(
      fakes.login.withSecondFactor(
        { challenge, secondFactor: VALID_TOTP },
        LOGIN_META,
      ),
    );

    expect(error.code).toBe('login_challenge_expired');
  });

  test('正しいリカバリコードなら消費してセッションを発行し、同じリカバリコードの2回目は誤りとして数える', async () => {
    const fakes = await setupLogin({
      totp: ENABLED_TOTP,
      recoveryRawCodes: [RAW_RECOVERY_CODE],
    });
    const recovery = {
      kind: 'recovery',
      code: FORMATTED_RECOVERY_CODE,
    } as const;

    const result = await fakes.login.withSecondFactor(
      { challenge: await startChallenge(fakes), secondFactor: recovery },
      LOGIN_META,
    );
    const secondChallenge = await startChallenge(fakes);
    const error = await caught(
      fakes.login.withSecondFactor(
        { challenge: secondChallenge, secondFactor: recovery },
        LOGIN_META,
      ),
    );

    expect(result.userId).toBe(USER_ID);
    expect(fakes.state.issuedSessions).toHaveLength(1);
    expect(error.code).toBe('invalid_second_factor');
    expect(fakes.state.throttleCalls.map((call) => call.method)).toEqual([
      'status',
      'recordFailure',
    ]);
  });

  test.each([
    ['誤った認証コード', { kind: 'totp', code: '654321' }],
    ['6桁でない認証コード', { kind: 'totp', code: '12345' }],
    [
      '発行していないリカバリコード',
      { kind: 'recovery', code: 'wxyz'.repeat(4) },
    ],
  ] as const)(
    '%sは失敗として数えて拒否し、待ちを残してセッションを発行しない',
    async (_label, secondFactor) => {
      const fakes = await setupLogin({ totp: ENABLED_TOTP });
      const challenge = await startChallenge(fakes);

      const error = await caught(
        fakes.login.withSecondFactor({ challenge, secondFactor }, LOGIN_META),
      );

      const keys = await fakes.keysFor(EMAIL);
      expect(errorShape(error)).toEqual({
        kind: 'unauthenticated',
        code: 'invalid_second_factor',
        message: '認証コードが正しくありません。',
        status: 401,
        retryAfterSeconds: undefined,
      });
      expect(fakes.state.throttleCalls).toEqual([
        { method: 'status', scope: 'user', keys },
        { method: 'recordFailure', scope: 'user', keys },
      ]);
      expect(fakes.state.challenges.map((stored) => stored.deleted)).toEqual([
        false,
      ]);
      expect(fakes.state.issuedSessions).toEqual([]);
    },
  );

  test('同じ時間窓の認証コードの再使用は、失敗として数えて拒否する', async () => {
    const fakes = await setupLogin({ totp: ENABLED_TOTP });
    await fakes.login.withSecondFactor(
      { challenge: await startChallenge(fakes), secondFactor: VALID_TOTP },
      LOGIN_META,
    );
    const challenge = await startChallenge(fakes);

    const error = await caught(
      fakes.login.withSecondFactor(
        { challenge, secondFactor: VALID_TOTP },
        LOGIN_META,
      ),
    );

    expect(error.code).toBe('invalid_second_factor');
    expect(fakes.state.throttleCalls.map((call) => call.method)).toEqual([
      'status',
      'recordFailure',
    ]);
    expect(fakes.state.issuedSessions).toHaveLength(1);
  });

  test('5分の期限を過ぎた待ちの値は、照合も記録もせずに期限切れとして拒否する', async () => {
    const fakes = await setupLogin({ totp: ENABLED_TOTP });
    const challenge = await startChallenge(fakes);
    const later: RequestMeta = {
      ...LOGIN_META,
      now: new Date(
        LOGIN_NOW.getTime() + LOGIN_CHALLENGE_TTL_SECONDS * MS_PER_SECOND,
      ),
    };

    const error = await caught(
      fakes.login.withSecondFactor(
        { challenge, secondFactor: VALID_TOTP },
        later,
      ),
    );

    expect(errorShape(error)).toEqual({
      kind: 'unauthenticated',
      code: 'login_challenge_expired',
      message: '認証の有効期限が切れました。もう一度ログインしてください。',
      status: 401,
      retryAfterSeconds: undefined,
    });
    expect(fakes.state.calls).toEqual(['challenges.findValid']);
  });

  test('発行していない待ちの値は、照合も記録もせずに期限切れとして拒否する', async () => {
    const fakes = await setupLogin({ totp: ENABLED_TOTP });

    const error = await caught(
      fakes.login.withSecondFactor(
        { challenge: 'unknown-challenge', secondFactor: VALID_TOTP },
        LOGIN_META,
      ),
    );

    expect(error.code).toBe('login_challenge_expired');
    expect(fakes.state.calls).toEqual(['challenges.findValid']);
  });

  test('ロック中は第2要素を照合せずに429で拒否し、利用者の現在のメールアドレスの単位で確かめる', async () => {
    const fakes = await setupLogin({ totp: ENABLED_TOTP });
    const challenge = await startChallenge(fakes);
    const changedEmail = 'new.address@mail.example';
    fakes.state.users.set(USER_ID, baseUser({ email: changedEmail }));
    fakes.state.throttleStatus = { locked: true, retryAfterSeconds: 4 };

    const error = await caught(
      fakes.login.withSecondFactor(
        { challenge, secondFactor: VALID_TOTP },
        LOGIN_META,
      ),
    );

    expect(error.code).toBe('login_throttled');
    expect(error.retryAfterSeconds).toBe(4);
    expect(fakes.state.throttleCalls).toEqual([
      {
        method: 'status',
        scope: 'user',
        keys: await fakes.keysFor(changedEmail),
      },
    ]);
    expect(fakes.state.calls).not.toContain('totp.verify');
    expect(fakes.state.calls).not.toContain('totpCredentials.advanceStep');
    expect(fakes.state.issuedSessions).toEqual([]);
  });

  test('待ちの発行後に停止された利用者は、第2要素を照合せず失敗としても数えずに停止を伝え、待ちを消す', async () => {
    const fakes = await setupLogin({ totp: ENABLED_TOTP });
    const challenge = await startChallenge(fakes);
    fakes.state.users.set(USER_ID, baseUser({ status: 'suspended' }));

    const error = await caught(
      fakes.login.withSecondFactor(
        { challenge, secondFactor: VALID_TOTP },
        LOGIN_META,
      ),
    );

    expect(error.code).toBe('account_unavailable');
    expect(fakes.state.calls).not.toContain('totp.verify');
    expect(fakes.state.throttleCalls).toEqual([]);
    expect(fakes.state.challenges.map((stored) => stored.deleted)).toEqual([
      true,
    ]);
    expect(fakes.state.issuedSessions).toEqual([]);
  });

  test('待ちの発行後に退会した利用者は、照合も記録もせずに期限切れとして拒否し、待ちを消す', async () => {
    const fakes = await setupLogin({ totp: ENABLED_TOTP });
    const challenge = await startChallenge(fakes);
    fakes.state.users.set(
      USER_ID,
      baseUser({ deletedAt: new Date('2026-11-02T03:05:00.000Z') }),
    );

    const error = await caught(
      fakes.login.withSecondFactor(
        { challenge, secondFactor: VALID_TOTP },
        LOGIN_META,
      ),
    );

    expect(error.code).toBe('login_challenge_expired');
    expect(fakes.state.throttleCalls).toEqual([]);
    expect(fakes.state.challenges.map((stored) => stored.deleted)).toEqual([
      true,
    ]);
    expect(fakes.state.issuedSessions).toEqual([]);
  });
});
