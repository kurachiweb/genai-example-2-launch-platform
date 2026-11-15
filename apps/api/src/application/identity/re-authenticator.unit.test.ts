import { describe, expect, test } from 'bun:test';

import type { SecondFactorInput } from '../../domain/auth/second-factor.ts';
import {
  baseUser,
  caught,
  EMAIL,
  ENABLED_TOTP,
  errorShape,
  FORMATTED_RECOVERY_CODE,
  LOGIN_META,
  PASSWORD,
  PENDING_TOTP,
  RAW_RECOVERY_CODE,
  setupReAuthenticator,
  VALID_CODE,
  WRONG_PASSWORD,
} from './testing/login-fakes.ts';

const VALID_TOTP: SecondFactorInput = { kind: 'totp', code: VALID_CODE };

const RECOVERY: SecondFactorInput = {
  kind: 'recovery',
  code: FORMATTED_RECOVERY_CODE,
};

const CURRENT_PASSWORD_MESSAGE = '現在のパスワードが正しくありません。';

const SECOND_FACTOR_MESSAGE = '認証コードが正しくありません。';

const reAuthenticationFailed = (
  field: string,
  code: string,
  message: string,
) => ({
  shape: {
    kind: 'unprocessable',
    code: 'reauthentication_failed',
    message,
    status: 422,
    retryAfterSeconds: undefined,
  },
  details: [{ field, code, message }],
});

describe('StoreReAuthenticator.verify', () => {
  test('ロック中は照合せずにlogin_throttledで拒否し、失敗として数えない', async () => {
    const fakes = await setupReAuthenticator({
      throttleStatus: { locked: true, retryAfterSeconds: 8 },
    });

    const error = await caught(
      fakes.reAuthenticator.verify(
        baseUser(),
        { currentPassword: PASSWORD, secondFactor: undefined },
        LOGIN_META,
      ),
    );

    expect(errorShape(error)).toEqual({
      kind: 'rate_limited',
      code: 'login_throttled',
      message:
        'ログイン試行が続いたため、しばらく待ってから再度お試しください。',
      status: 429,
      retryAfterSeconds: 8,
    });
    expect(fakes.state.calls).toEqual(['throttle.status']);
  });

  test('利用者の現在のメールアドレスと送信元IPアドレスのキーで、利用者の単位の記録を調べる', async () => {
    const fakes = await setupReAuthenticator();

    await fakes.reAuthenticator.verify(
      baseUser(),
      { currentPassword: PASSWORD, secondFactor: undefined },
      LOGIN_META,
    );

    const keys = await fakes.keysFor(EMAIL);
    expect(keys.ip).toBeDefined();
    expect(fakes.state.throttleCalls).toEqual([
      { method: 'status', scope: 'user', keys },
    ]);
  });

  test('多要素認証が無効なら、現在のパスワードだけで通し、成功しても記録を消さない', async () => {
    const fakes = await setupReAuthenticator();

    await fakes.reAuthenticator.verify(
      baseUser(),
      { currentPassword: PASSWORD, secondFactor: undefined },
      LOGIN_META,
    );

    expect(fakes.state.calls).toEqual([
      'throttle.status',
      'password.check',
      'totpCredentials.find',
    ]);
  });

  test('設定の途中の多要素認証は有効として扱わず、送られた第2要素を照合しない', async () => {
    const fakes = await setupReAuthenticator({ totp: PENDING_TOTP });

    await fakes.reAuthenticator.verify(
      baseUser(),
      { currentPassword: PASSWORD, secondFactor: VALID_TOTP },
      LOGIN_META,
    );

    expect(fakes.state.calls).toEqual([
      'throttle.status',
      'password.check',
      'totpCredentials.find',
    ]);
  });

  test('現在のパスワードが誤りなら、第2要素を照合せずに失敗を記録し、現在のパスワードの欄のエラーで拒否する', async () => {
    const fakes = await setupReAuthenticator({
      totp: ENABLED_TOTP,
      recoveryRawCodes: [RAW_RECOVERY_CODE],
    });

    const error = await caught(
      fakes.reAuthenticator.verify(
        baseUser(),
        { currentPassword: WRONG_PASSWORD, secondFactor: RECOVERY },
        LOGIN_META,
      ),
    );

    const expected = reAuthenticationFailed(
      'currentPassword',
      'incorrect',
      CURRENT_PASSWORD_MESSAGE,
    );
    expect(errorShape(error)).toEqual(expected.shape);
    expect(error.details).toEqual(expected.details);
    const keys = await fakes.keysFor(EMAIL);
    expect(fakes.state.throttleCalls).toEqual([
      { method: 'status', scope: 'user', keys },
      { method: 'recordFailure', scope: 'user', keys },
    ]);
    expect(fakes.state.calls).toEqual([
      'throttle.status',
      'password.check',
      'throttle.recordFailure',
    ]);
    expect(fakes.state.recoveryHashes.size).toBe(1);
  });

  test('多要素認証が有効で第2要素が無ければ、失敗を記録し、第2要素の欄のエラーで拒否する', async () => {
    const fakes = await setupReAuthenticator({ totp: ENABLED_TOTP });

    const error = await caught(
      fakes.reAuthenticator.verify(
        baseUser(),
        { currentPassword: PASSWORD, secondFactor: undefined },
        LOGIN_META,
      ),
    );

    const expected = reAuthenticationFailed(
      'secondFactor',
      'required',
      SECOND_FACTOR_MESSAGE,
    );
    expect(errorShape(error)).toEqual(expected.shape);
    expect(error.details).toEqual(expected.details);
    expect(fakes.state.throttleCalls.map((call) => call.method)).toEqual([
      'status',
      'recordFailure',
    ]);
  });

  test.each([
    [
      '誤った認証コード',
      { kind: 'totp', code: '654321' },
      'secondFactor.totpCode',
    ],
    [
      '6桁でない認証コード',
      { kind: 'totp', code: '12345' },
      'secondFactor.totpCode',
    ],
    [
      '誤ったリカバリコード',
      { kind: 'recovery', code: 'zzzz-zzzz-zzzz-zzzz' },
      'secondFactor.recoveryCode',
    ],
  ] as const)(
    '%sなら、失敗を記録し、送った第2要素の欄のエラーで拒否する',
    async (_label, secondFactor, field) => {
      const fakes = await setupReAuthenticator({
        totp: ENABLED_TOTP,
        recoveryRawCodes: [RAW_RECOVERY_CODE],
      });

      const error = await caught(
        fakes.reAuthenticator.verify(
          baseUser(),
          { currentPassword: PASSWORD, secondFactor },
          LOGIN_META,
        ),
      );

      const expected = reAuthenticationFailed(
        field,
        'incorrect',
        SECOND_FACTOR_MESSAGE,
      );
      expect(errorShape(error)).toEqual(expected.shape);
      expect(error.details).toEqual(expected.details);
      expect(fakes.state.throttleCalls.map((call) => call.method)).toEqual([
        'status',
        'recordFailure',
      ]);
      expect(fakes.state.recoveryHashes.size).toBe(1);
    },
  );

  test('正しい認証コードなら時間窓を使用済みにして通し、同じ時間窓の2回目は誤りとして拒否する', async () => {
    const fakes = await setupReAuthenticator({ totp: ENABLED_TOTP });
    const input = { currentPassword: PASSWORD, secondFactor: VALID_TOTP };

    await fakes.reAuthenticator.verify(baseUser(), input, LOGIN_META);
    const error = await caught(
      fakes.reAuthenticator.verify(baseUser(), input, LOGIN_META),
    );

    expect(error.details).toEqual([
      {
        field: 'secondFactor.totpCode',
        code: 'incorrect',
        message: SECOND_FACTOR_MESSAGE,
      },
    ]);
    expect(fakes.state.throttleCalls.map((call) => call.method)).toEqual([
      'status',
      'status',
      'recordFailure',
    ]);
  });

  test('正しいリカバリコードなら消費して通し、成功しても記録を消さない', async () => {
    const fakes = await setupReAuthenticator({
      totp: ENABLED_TOTP,
      recoveryRawCodes: [RAW_RECOVERY_CODE],
    });

    await fakes.reAuthenticator.verify(
      baseUser(),
      { currentPassword: PASSWORD, secondFactor: RECOVERY },
      LOGIN_META,
    );

    expect(fakes.state.recoveryHashes.size).toBe(0);
    expect(fakes.state.calls).toEqual([
      'throttle.status',
      'password.check',
      'totpCredentials.find',
      'recoveryCodes.consume',
    ]);
  });
});
