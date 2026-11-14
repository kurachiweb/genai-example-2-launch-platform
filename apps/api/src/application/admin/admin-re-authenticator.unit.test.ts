import { describe, expect, test } from 'bun:test';

import type { SecondFactorInput } from '../../domain/auth/second-factor.ts';
import {
  ADMIN_EMAIL,
  ADMIN_ID,
  ADMIN_LOGIN_META,
  baseAdmin,
  caught,
  errorShape,
  FORMATTED_RECOVERY_CODE,
  PASSWORD,
  RAW_RECOVERY_CODE,
  setupAdminReAuthenticator,
  VALID_CODE,
  VALID_STEP,
  WRONG_PASSWORD,
} from './testing/admin-login-fakes.ts';

const VALID_TOTP: SecondFactorInput = { kind: 'totp', code: VALID_CODE };

const RECOVERY: SecondFactorInput = {
  kind: 'recovery',
  code: FORMATTED_RECOVERY_CODE,
};

// 設計の「Error Handling」の表の行(`auth`の共有の定義の文言)をそのまま写した期待値
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

describe('StoreAdminReAuthenticator.verify', () => {
  test('ロック中は照合せずにlogin_throttledの429で拒否し、失敗として数えない', async () => {
    const fakes = await setupAdminReAuthenticator({
      throttleStatus: { locked: true, retryAfterSeconds: 8 },
      recoveryRawCodes: [RAW_RECOVERY_CODE],
    });

    const error = await caught(
      fakes.reAuthenticator.verify(
        baseAdmin(),
        { currentPassword: PASSWORD, secondFactor: RECOVERY },
        ADMIN_LOGIN_META,
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
    expect(fakes.state.recoveryHashes.size).toBe(1);
  });

  test('管理者の現在のメールアドレスと送信元IPアドレスのキーで、管理者の単位の記録を調べる', async () => {
    const fakes = await setupAdminReAuthenticator();

    await fakes.reAuthenticator.verify(
      baseAdmin(),
      { currentPassword: PASSWORD, secondFactor: VALID_TOTP },
      ADMIN_LOGIN_META,
    );

    const keys = await fakes.keysFor(ADMIN_EMAIL);
    expect(keys.ip).toBeDefined();
    expect(fakes.state.throttleCalls).toEqual([
      { method: 'status', scope: 'admin', keys },
    ]);
  });

  test('正しいパスワードと認証コードなら、時間窓を使用済みにして通し、成功しても試行の記録を消さない', async () => {
    const fakes = await setupAdminReAuthenticator();

    await fakes.reAuthenticator.verify(
      baseAdmin(),
      { currentPassword: PASSWORD, secondFactor: VALID_TOTP },
      ADMIN_LOGIN_META,
    );

    expect(fakes.state.totpCredential?.lastUsedStep).toBe(VALID_STEP);
    expect(fakes.state.openedContexts).toEqual([`admin:${ADMIN_ID}`]);
    expect(fakes.state.throttleCalls.map((call) => call.method)).toEqual([
      'status',
    ]);
    expect(fakes.state.calls).toEqual([
      'throttle.status',
      'password.check',
      'totpCredentials.find',
      'secretBox.open',
      'totp.verify',
      'totpCredentials.advanceStep',
    ]);
  });

  test('正しいリカバリコードなら消費して通し、成功しても試行の記録を消さない', async () => {
    const fakes = await setupAdminReAuthenticator({
      recoveryRawCodes: [RAW_RECOVERY_CODE],
    });

    await fakes.reAuthenticator.verify(
      baseAdmin(),
      { currentPassword: PASSWORD, secondFactor: RECOVERY },
      ADMIN_LOGIN_META,
    );

    expect(fakes.state.recoveryHashes.size).toBe(0);
    expect(fakes.state.throttleCalls.map((call) => call.method)).toEqual([
      'status',
    ]);
    expect(fakes.state.calls).toEqual([
      'throttle.status',
      'password.check',
      'recoveryCodes.consume',
    ]);
  });

  test('同じリカバリコードの2回目は、消費済みのため第2要素の誤りとして拒否する', async () => {
    const fakes = await setupAdminReAuthenticator({
      recoveryRawCodes: [RAW_RECOVERY_CODE],
    });
    const input = { currentPassword: PASSWORD, secondFactor: RECOVERY };

    await fakes.reAuthenticator.verify(baseAdmin(), input, ADMIN_LOGIN_META);
    const error = await caught(
      fakes.reAuthenticator.verify(baseAdmin(), input, ADMIN_LOGIN_META),
    );

    expect(error.details).toEqual([
      {
        field: 'secondFactor.recoveryCode',
        code: 'incorrect',
        message: SECOND_FACTOR_MESSAGE,
      },
    ]);
  });

  test('同じ時間窓の認証コードの2回目は、第2要素の誤りとして拒否し失敗を記録する', async () => {
    const fakes = await setupAdminReAuthenticator();
    const input = { currentPassword: PASSWORD, secondFactor: VALID_TOTP };

    await fakes.reAuthenticator.verify(baseAdmin(), input, ADMIN_LOGIN_META);
    const error = await caught(
      fakes.reAuthenticator.verify(baseAdmin(), input, ADMIN_LOGIN_META),
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

  test('現在のパスワードが誤りなら、第2要素を照合せずに管理者の単位で失敗を記録し、現在のパスワードの欄のエラーで拒否する', async () => {
    const fakes = await setupAdminReAuthenticator({
      recoveryRawCodes: [RAW_RECOVERY_CODE],
    });

    const error = await caught(
      fakes.reAuthenticator.verify(
        baseAdmin(),
        { currentPassword: WRONG_PASSWORD, secondFactor: RECOVERY },
        ADMIN_LOGIN_META,
      ),
    );

    const expected = reAuthenticationFailed(
      'currentPassword',
      'incorrect',
      CURRENT_PASSWORD_MESSAGE,
    );
    expect(errorShape(error)).toEqual(expected.shape);
    expect(error.details).toEqual(expected.details);
    const keys = await fakes.keysFor(ADMIN_EMAIL);
    expect(fakes.state.throttleCalls).toEqual([
      { method: 'status', scope: 'admin', keys },
      { method: 'recordFailure', scope: 'admin', keys },
    ]);
    expect(fakes.state.calls).toEqual([
      'throttle.status',
      'password.check',
      'throttle.recordFailure',
    ]);
    expect(fakes.state.recoveryHashes.size).toBe(1);
  });

  test('パスワードを保存していない管理者は、ダミーの照合で同じ計算量を使い、現在のパスワードの誤りとして拒否する', async () => {
    const fakes = await setupAdminReAuthenticator();

    const error = await caught(
      fakes.reAuthenticator.verify(
        baseAdmin({ passwordHash: null }),
        { currentPassword: PASSWORD, secondFactor: VALID_TOTP },
        ADMIN_LOGIN_META,
      ),
    );

    expect(error.details).toEqual(
      reAuthenticationFailed(
        'currentPassword',
        'incorrect',
        CURRENT_PASSWORD_MESSAGE,
      ).details,
    );
    expect(fakes.state.dummyChecks).toBe(1);
    expect(fakes.state.calls).toEqual([
      'throttle.status',
      'password.check',
      'throttle.recordFailure',
    ]);
  });

  test('第2要素が無ければ、正しいパスワードでも失敗を記録し、第2要素の欄のエラーで拒否する', async () => {
    const fakes = await setupAdminReAuthenticator();

    const error = await caught(
      fakes.reAuthenticator.verify(
        baseAdmin(),
        { currentPassword: PASSWORD, secondFactor: undefined },
        ADMIN_LOGIN_META,
      ),
    );

    const expected = reAuthenticationFailed(
      'secondFactor',
      'required',
      SECOND_FACTOR_MESSAGE,
    );
    expect(errorShape(error)).toEqual(expected.shape);
    expect(error.details).toEqual(expected.details);
    expect(fakes.state.calls).toEqual([
      'throttle.status',
      'password.check',
      'throttle.recordFailure',
    ]);
  });

  test('TOTPの設定が無い管理者も、パスワードだけでは通さない', async () => {
    const fakes = await setupAdminReAuthenticator({ totp: null });

    const error = await caught(
      fakes.reAuthenticator.verify(
        baseAdmin(),
        { currentPassword: PASSWORD, secondFactor: VALID_TOTP },
        ADMIN_LOGIN_META,
      ),
    );

    expect(error.details).toEqual(
      reAuthenticationFailed(
        'secondFactor.totpCode',
        'incorrect',
        SECOND_FACTOR_MESSAGE,
      ).details,
    );
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
    '%sなら、管理者の単位で失敗を記録し、送った第2要素の欄のエラーで拒否する',
    async (_label, secondFactor, field) => {
      const fakes = await setupAdminReAuthenticator({
        recoveryRawCodes: [RAW_RECOVERY_CODE],
      });

      const error = await caught(
        fakes.reAuthenticator.verify(
          baseAdmin(),
          { currentPassword: PASSWORD, secondFactor },
          ADMIN_LOGIN_META,
        ),
      );

      const expected = reAuthenticationFailed(
        field,
        'incorrect',
        SECOND_FACTOR_MESSAGE,
      );
      expect(errorShape(error)).toEqual(expected.shape);
      expect(error.details).toEqual(expected.details);
      const keys = await fakes.keysFor(ADMIN_EMAIL);
      expect(fakes.state.throttleCalls).toEqual([
        { method: 'status', scope: 'admin', keys },
        { method: 'recordFailure', scope: 'admin', keys },
      ]);
      expect(fakes.state.recoveryHashes.size).toBe(1);
    },
  );
});
