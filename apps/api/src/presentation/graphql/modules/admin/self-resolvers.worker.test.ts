import { describe, expect, test } from 'vitest';

import {
  issueAdminSession,
  lastAdminMailOf,
  prepareActiveAdmin,
  type PreparedAdmin,
  sentAdminMails,
} from '../../../../../test/support/admin-graphql-harness.ts';
import {
  ADMIN_PASSWORD,
  adminLogin,
  type AdminTotpSetupFields,
  CHANGE_ADMIN_PASSWORD,
  codesOf,
  COMPLETE_ADMIN_TOTP_RESET,
  currentTotpCode,
  detailsOf,
  fetchAdminViewer,
  installAdminGraphQLTest,
  NEW_ADMIN_PASSWORD,
  REGENERATE_ADMIN_RECOVERY_CODES,
  REQUEST_ADMIN_EMAIL_CHANGE,
  SESSION_TOKEN_PATTERN,
  START_ADMIN_TOTP_RESET,
  uniqueAdminEmail,
  WRONG_ADMIN_PASSWORD,
} from '../../../../../test/support/admin-graphql-operations.ts';
import { stubExternalServices } from '../../../../../test/support/graphql-gateway.ts';

const { gateway } = installAdminGraphQLTest();

const RECOVERY_CODE_COUNT = 10;

const WRONG_TOTP_CODE = '000000';

const WRONG_RECOVERY_CODE = 'AAAAA-AAAAA';

const PASSWORD_MATCHES_IDENTITY_MESSAGE =
  'ニックネーム・メールアドレス(@より前の部分を含む)と同じパスワードは使えません。';

interface Operator extends PreparedAdmin {
  readonly sessionToken: string;
}

// 本人確認の失敗はログイン試行の失敗としてメールアドレスごとに数えるため、テストごとに別の管理者にして記録を混ぜない
let nextAdminIndex = 1;

async function prepareOperator(): Promise<Operator> {
  const admin = await prepareActiveAdmin(nextAdminIndex, {
    password: ADMIN_PASSWORD,
  });
  nextAdminIndex += 1;
  const session = await issueAdminSession(admin.adminId);
  return { ...admin, sessionToken: session.token };
}

type SecondFactor =
  { readonly totpCode: string } | { readonly recoveryCode: string };

function reAuthenticationOf(
  secondFactor: SecondFactor,
  currentPassword = ADMIN_PASSWORD,
) {
  return { currentPassword, secondFactor };
}

function totpOf(operator: Operator): SecondFactor {
  return { totpCode: currentTotpCode(operator.totpSecret) };
}

function recoveryOf(operator: Operator): SecondFactor {
  const [code] = operator.recoveryCodes;
  if (code === undefined) {
    throw new Error('リカバリコードがありません');
  }
  return { recoveryCode: code };
}

function requestEmailChange(
  operator: Operator,
  reAuthentication: ReturnType<typeof reAuthenticationOf>,
  newEmail = uniqueAdminEmail('changed'),
) {
  return gateway.call<{ requestAdminEmailChange: boolean | null }>(
    REQUEST_ADMIN_EMAIL_CHANGE,
    { newEmail, reAuthentication },
    { sessionToken: operator.sessionToken },
  );
}

function changePassword(
  operator: Operator,
  newPassword: string,
  reAuthentication: ReturnType<typeof reAuthenticationOf>,
) {
  return gateway.call<{ changeAdminPassword: boolean | null }>(
    CHANGE_ADMIN_PASSWORD,
    { newPassword, reAuthentication },
    { sessionToken: operator.sessionToken },
  );
}

function startTotpReset(
  operator: Operator,
  reAuthentication: ReturnType<typeof reAuthenticationOf>,
) {
  return gateway.call<{ startAdminTotpReset: AdminTotpSetupFields | null }>(
    START_ADMIN_TOTP_RESET,
    { reAuthentication },
    { sessionToken: operator.sessionToken },
  );
}

function completeTotpReset(operator: Operator, totpCode: string) {
  return gateway.call<{
    completeAdminTotpReset: { readonly codes: readonly string[] } | null;
  }>(
    COMPLETE_ADMIN_TOTP_RESET,
    { totpCode },
    { sessionToken: operator.sessionToken },
  );
}

function regenerateRecoveryCodes(
  operator: Operator,
  reAuthentication: ReturnType<typeof reAuthenticationOf>,
) {
  return gateway.call<{
    regenerateAdminRecoveryCodes: { readonly codes: readonly string[] } | null;
  }>(
    REGENERATE_ADMIN_RECOVERY_CODES,
    { reAuthentication },
    { sessionToken: operator.sessionToken },
  );
}

// 操作した端末へ新しいセッションを渡し、元のセッションを含む全端末のセッションが無効になっていることを確かめる
async function expectReissued(
  operator: Operator,
  issuedToken: string | undefined,
): Promise<void> {
  expect(issuedToken).toMatch(SESSION_TOKEN_PATTERN);
  expect(issuedToken).not.toBe(operator.sessionToken);
  const previous = await fetchAdminViewer(gateway, operator.sessionToken);
  expect(previous.data?.adminViewer).toBeNull();
  const reissued = await fetchAdminViewer(gateway, issuedToken);
  expect(reissued.data?.adminViewer?.id).toBe(operator.adminId);
}

describe('本人確認の失敗の詳細の経路', () => {
  test('現在のパスワードの誤りは、reAuthentication.currentPasswordの欄で返す', async () => {
    const operator = await prepareOperator();

    const response = await requestEmailChange(
      operator,
      reAuthenticationOf(totpOf(operator), WRONG_ADMIN_PASSWORD),
    );

    expect(codesOf(response)).toEqual(['reauthentication_failed']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'reAuthentication.currentPassword',
        code: 'incorrect',
      }),
    ]);
    expect(sentAdminMails).toEqual([]);
  });

  test('認証コードの誤りは、reAuthentication.secondFactor.totpCodeの欄で返す', async () => {
    const operator = await prepareOperator();

    const response = await startTotpReset(
      operator,
      reAuthenticationOf({ totpCode: WRONG_TOTP_CODE }),
    );

    expect(codesOf(response)).toEqual(['reauthentication_failed']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'reAuthentication.secondFactor.totpCode',
      }),
    ]);
  });

  test('リカバリコードの誤りは、reAuthentication.secondFactor.recoveryCodeの欄で返す', async () => {
    const operator = await prepareOperator();

    const response = await regenerateRecoveryCodes(
      operator,
      reAuthenticationOf({ recoveryCode: WRONG_RECOVERY_CODE }),
    );

    expect(codesOf(response)).toEqual(['reauthentication_failed']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'reAuthentication.secondFactor.recoveryCode',
      }),
    ]);
    expect(response.issuedToken).toBeUndefined();
  });

  test('第2要素の入力が無ければ、reAuthentication.secondFactorの欄の入力の検証の失敗にする', async () => {
    const operator = await prepareOperator();

    const response = await changePassword(
      operator,
      NEW_ADMIN_PASSWORD,
      reAuthenticationOf({ totpCode: '' }),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'reAuthentication.secondFactor' }),
    ]);
  });

  test('ログインしていなければ、本人確認より前に未認証として拒否する', async () => {
    const response = await gateway.call(REQUEST_ADMIN_EMAIL_CHANGE, {
      newEmail: uniqueAdminEmail('changed'),
      reAuthentication: reAuthenticationOf({ totpCode: WRONG_TOTP_CODE }),
    });

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test('利用者側の呼び出し元からは拒否する', async () => {
    const operator = await prepareOperator();

    const response = await gateway.call(
      REGENERATE_ADMIN_RECOVERY_CODES,
      { reAuthentication: reAuthenticationOf(recoveryOf(operator)) },
      { caller: 'client', sessionToken: operator.sessionToken },
    );

    expect(codesOf(response)).toEqual(['forbidden']);
  });
});

describe('requestAdminEmailChange', () => {
  test('本人確認を通ると新しいメールアドレスへ確認のリンクを送り、セッションを入れ替えない', async () => {
    const operator = await prepareOperator();
    const newEmail = uniqueAdminEmail('changed');

    const response = await requestEmailChange(
      operator,
      reAuthenticationOf(recoveryOf(operator)),
      newEmail,
    );

    expect(response.errors).toBeUndefined();
    expect(response.data).toEqual({ requestAdminEmailChange: true });
    expect(response.issuedToken).toBeUndefined();
    expect(lastAdminMailOf('email-change-confirmation').to).toBe(newEmail);
  });

  test('新しいメールアドレスの形式の誤りは欄ごとの詳細で返す', async () => {
    const operator = await prepareOperator();

    const response = await requestEmailChange(
      operator,
      reAuthenticationOf(recoveryOf(operator)),
      'not-an-address',
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'newEmail' }),
    ]);
  });
});

describe('changeAdminPassword', () => {
  test('即時に変更し、完了のメールを送り、操作した端末へ新しいセッションを発行する', async () => {
    stubExternalServices();
    const operator = await prepareOperator();

    const response = await changePassword(
      operator,
      NEW_ADMIN_PASSWORD,
      reAuthenticationOf(recoveryOf(operator)),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data).toEqual({ changeAdminPassword: true });
    await expectReissued(operator, response.issuedToken);
    expect(lastAdminMailOf('password-changed').to).toBe(operator.email);
    const login = await adminLogin(gateway, operator.email, NEW_ADMIN_PASSWORD);
    expect(login.errors).toBeUndefined();
  });

  test('メールアドレスと同じ新しいパスワードは、newPasswordの欄の管理者の文言で拒否する', async () => {
    stubExternalServices();
    const operator = await prepareOperator();

    const response = await changePassword(
      operator,
      operator.email,
      reAuthenticationOf(recoveryOf(operator)),
    );

    expect(codesOf(response)).toEqual(['password_rejected']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'newPassword',
        message: PASSWORD_MATCHES_IDENTITY_MESSAGE,
      }),
    ]);
    expect(response.issuedToken).toBeUndefined();
  });

  test('本人確認の失敗ではパスワードを変えずセッションも入れ替えない', async () => {
    stubExternalServices();
    const operator = await prepareOperator();

    const response = await changePassword(
      operator,
      NEW_ADMIN_PASSWORD,
      reAuthenticationOf(recoveryOf(operator), WRONG_ADMIN_PASSWORD),
    );

    expect(codesOf(response)).toEqual(['reauthentication_failed']);
    expect(response.issuedToken).toBeUndefined();
    const viewer = await fetchAdminViewer(gateway, operator.sessionToken);
    expect(viewer.data?.adminViewer?.id).toBe(operator.adminId);
    expect(sentAdminMails).toEqual([]);
  });
});

describe('startAdminTotpReset・completeAdminTotpReset', () => {
  test('本人確認のうえで新しい秘密鍵を示し、正しい認証コードで入れ替えてリカバリコードを発行し、セッションを入れ替える', async () => {
    const operator = await prepareOperator();

    const started = await startTotpReset(
      operator,
      reAuthenticationOf(recoveryOf(operator)),
    );

    expect(started.errors).toBeUndefined();
    expect(started.issuedToken).toBeUndefined();
    const setup = started.data?.startAdminTotpReset;
    if (setup == null) {
      throw new Error('多要素認証の再設定を始められませんでした');
    }
    expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\//u);
    expect(setup.secret).not.toBe(operator.totpSecret);

    const completed = await completeTotpReset(
      operator,
      currentTotpCode(setup.secret),
    );

    expect(completed.errors).toBeUndefined();
    expect(completed.data?.completeAdminTotpReset?.codes).toHaveLength(
      RECOVERY_CODE_COUNT,
    );
    await expectReissued(operator, completed.issuedToken);
  });

  test('再設定を始めていなければtotp_setup_expiredで拒否する', async () => {
    const operator = await prepareOperator();

    const response = await completeTotpReset(
      operator,
      currentTotpCode(operator.totpSecret),
    );

    expect(codesOf(response)).toEqual(['totp_setup_expired']);
    expect(response.issuedToken).toBeUndefined();
  });

  test('誤った認証コードでは現在の設定とセッションを変えずに拒否する', async () => {
    const operator = await prepareOperator();
    await startTotpReset(operator, reAuthenticationOf(recoveryOf(operator)));

    const response = await completeTotpReset(operator, WRONG_TOTP_CODE);

    expect(codesOf(response)).toEqual(['invalid_second_factor']);
    expect(response.issuedToken).toBeUndefined();
    const viewer = await fetchAdminViewer(gateway, operator.sessionToken);
    expect(viewer.data?.adminViewer?.id).toBe(operator.adminId);
  });
});

describe('regenerateAdminRecoveryCodes', () => {
  test('本人確認のうえで10個のリカバリコードを発行し直し、セッションを入れ替える', async () => {
    const operator = await prepareOperator();

    const response = await regenerateRecoveryCodes(
      operator,
      reAuthenticationOf(totpOf(operator)),
    );

    expect(response.errors).toBeUndefined();
    const codes = response.data?.regenerateAdminRecoveryCodes?.codes ?? [];
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(codes).not.toContain(operator.recoveryCodes[0]);
    await expectReissued(operator, response.issuedToken);
    const viewer = await fetchAdminViewer(gateway, response.issuedToken);
    expect(viewer.data?.adminViewer?.remainingRecoveryCodes).toBe(
      RECOVERY_CODE_COUNT,
    );
  });
});
