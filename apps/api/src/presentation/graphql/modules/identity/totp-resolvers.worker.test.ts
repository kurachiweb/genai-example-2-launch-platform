import { describe, expect, onTestFinished, test, vi } from 'vitest';

import { D1RecoveryCodeStore } from '../../../../infrastructure/identity/d1-recovery-code-store.ts';
import {
  enableTotpWithRecoveryCodes,
  markVerified,
  stubExternalServices,
} from '../../../../../test/support/identity-graphql-harness.ts';
import {
  ACCOUNT_OPERATIONS,
  codesOf,
  currentTotpCode,
  detailsOf,
  DISABLE_TOTP,
  ENABLE_TOTP,
  fetchViewer,
  installIdentityGraphQLTest,
  PASSWORD,
  reAuthenticationInput,
  type RecoveryCodeSetFields,
  register,
  type RegisteredUser,
  REGENERATE_RECOVERY_CODES,
  SECURITY_OPERATIONS,
  SESSION_TOKEN_PATTERN,
  START_TOTP_SETUP,
  VIEWER_HEADER,
  WRONG_PASSWORD,
} from '../../../../../test/support/identity-graphql-operations.ts';

const { gateway } = installIdentityGraphQLTest([
  ...ACCOUNT_OPERATIONS,
  ...SECURITY_OPERATIONS,
]);

const RECOVERY_CODE = 'abcd'.repeat(4);

const SECOND_RECOVERY_CODE = 'efgh'.repeat(4);

const RECOVERY_CODE_COUNT = 10;

const TOTP_STEP_MS = 30_000;

const SETUP_TTL_MS = 10 * 60 * 1000;

interface TotpSetupFields {
  readonly otpauthUri: string;
  readonly secret: string;
  readonly expiresAt: string;
}

async function verifiedUser(): Promise<RegisteredUser> {
  const user = await register(gateway);
  await markVerified(user.viewer.id);
  return user;
}

async function startSetup(sessionToken: string): Promise<TotpSetupFields> {
  const response = await gateway.call<{ startTotpSetup: TotpSetupFields }>(
    START_TOTP_SETUP,
    { input: reAuthenticationInput(PASSWORD) },
    { sessionToken },
  );
  expect(response.errors).toBeUndefined();
  if (response.data == null) {
    throw new Error('設定を始められませんでした');
  }
  return response.data.startTotpSetup;
}

async function totpEnabledUser(): Promise<RegisteredUser> {
  const user = await verifiedUser();
  await enableTotpWithRecoveryCodes(user.viewer.id, [
    RECOVERY_CODE,
    SECOND_RECOVERY_CODE,
  ]);
  return user;
}

describe('startTotpSetup・enableTotp', () => {
  test('開始で認証アプリへ登録する値と10分の期限を返し、セッションの指示は出さない', async () => {
    stubExternalServices();
    const user = await verifiedUser();
    const before = Date.now();

    const response = await gateway.call<{ startTotpSetup: TotpSetupFields }>(
      START_TOTP_SETUP,
      { input: reAuthenticationInput(PASSWORD) },
      { sessionToken: user.sessionToken },
    );

    const setup = response.data?.startTotpSetup;
    expect(response.errors).toBeUndefined();
    expect(setup?.secret).toMatch(/^[A-Z2-7]+$/u);
    expect(setup?.otpauthUri).toContain(`secret=${setup?.secret ?? ''}`);
    expect(setup?.otpauthUri).toContain(
      encodeURIComponent(`@${user.viewer.handle}`),
    );
    const expiresAt = Date.parse(setup?.expiresAt ?? '');
    expect(expiresAt).toBeGreaterThanOrEqual(before + SETUP_TTL_MS);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + SETUP_TTL_MS);
    expect(response.issuedToken).toBeUndefined();
    expect(response.cleared).toBe(false);
  });

  test('有効化でリカバリコード10個を返し、入れ替えたセッションの発行を指示する', async () => {
    stubExternalServices();
    const user = await verifiedUser();
    const { secret } = await startSetup(user.sessionToken);

    const response = await gateway.call<{ enableTotp: RecoveryCodeSetFields }>(
      ENABLE_TOTP,
      { totpCode: currentTotpCode(secret) },
      { sessionToken: user.sessionToken },
    );

    expect(response.errors).toBeUndefined();
    const codes = response.data?.enableTotp.codes ?? [];
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    expect(response.issuedToken).toMatch(SESSION_TOKEN_PATTERN);
    expect((await fetchViewer(gateway, user.sessionToken)).data).toEqual({
      viewer: null,
    });
    const viewer = await fetchViewer(gateway, response.issuedToken);
    expect(viewer.data?.viewer).toMatchObject({
      totpEnabled: true,
      remainingRecoveryCodes: RECOVERY_CODE_COUNT,
    });
  });

  test('誤った認証コードの有効化は、セッションを入れ替えずに拒否する', async () => {
    stubExternalServices();
    const user = await verifiedUser();
    const { secret } = await startSetup(user.sessionToken);
    const wrongCode = currentTotpCode(
      secret,
      new Date(Date.now() + 10 * TOTP_STEP_MS),
    );

    const response = await gateway.call(
      ENABLE_TOTP,
      { totpCode: wrongCode },
      { sessionToken: user.sessionToken },
    );

    expect(codesOf(response)).toEqual(['invalid_second_factor']);
    expect(response.issuedToken).toBeUndefined();
  });

  test('開始の現在のパスワードの誤りは、入力の直下の経路で返す', async () => {
    stubExternalServices();
    const user = await verifiedUser();

    const response = await gateway.call(
      START_TOTP_SETUP,
      { input: reAuthenticationInput(WRONG_PASSWORD) },
      { sessionToken: user.sessionToken },
    );

    expect(codesOf(response)).toEqual(['reauthentication_failed']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'input.currentPassword',
        message: '現在のパスワードが正しくありません。',
      }),
    ]);
  });

  test('メールアドレスが未確認なら開始を拒否する', async () => {
    stubExternalServices();
    const user = await register(gateway);

    const response = await gateway.call(
      START_TOTP_SETUP,
      { input: reAuthenticationInput(PASSWORD) },
      { sessionToken: user.sessionToken },
    );

    expect(codesOf(response)).toEqual(['email_not_verified']);
  });
});

describe('disableTotp・regenerateRecoveryCodes', () => {
  test('認証コードで本人確認して無効化し、入れ替えたセッションの発行を指示する', async () => {
    stubExternalServices();
    const user = await verifiedUser();
    const secret = await enableTotpWithRecoveryCodes(user.viewer.id, [
      RECOVERY_CODE,
    ]);

    const response = await gateway.call(
      DISABLE_TOTP,
      {
        input: reAuthenticationInput(PASSWORD, {
          totpCode: currentTotpCode(secret),
        }),
      },
      { sessionToken: user.sessionToken },
    );

    expect(response.data).toEqual({ disableTotp: true });
    expect(response.issuedToken).toMatch(SESSION_TOKEN_PATTERN);
    const viewer = await fetchViewer(gateway, response.issuedToken);
    expect(viewer.data?.viewer).toMatchObject({
      totpEnabled: false,
      remainingRecoveryCodes: 0,
    });
  });

  test('リカバリコードで本人確認して再発行し、新しい10個を返して入れ替えたセッションの発行を指示する', async () => {
    stubExternalServices();
    const user = await totpEnabledUser();

    const response = await gateway.call<{
      regenerateRecoveryCodes: RecoveryCodeSetFields;
    }>(
      REGENERATE_RECOVERY_CODES,
      {
        input: reAuthenticationInput(PASSWORD, {
          recoveryCode: RECOVERY_CODE,
        }),
      },
      { sessionToken: user.sessionToken },
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.regenerateRecoveryCodes.codes).toHaveLength(
      RECOVERY_CODE_COUNT,
    );
    expect(response.issuedToken).toMatch(SESSION_TOKEN_PATTERN);
    const viewer = await fetchViewer(gateway, response.issuedToken);
    expect(viewer.data?.viewer?.remainingRecoveryCodes).toBe(
      RECOVERY_CODE_COUNT,
    );
  });

  test.each([
    {
      label: '第2要素が無い',
      secondFactor: undefined,
      field: 'input.secondFactor',
    },
    {
      label: '認証コードが誤り',
      secondFactor: { totpCode: '000000' },
      field: 'input.secondFactor.totpCode',
    },
    {
      label: 'リカバリコードが誤り',
      secondFactor: { recoveryCode: 'wxyz'.repeat(4) },
      field: 'input.secondFactor.recoveryCode',
    },
  ])(
    '無効化の$labelなら、入力の直下の経路で返してセッションを入れ替えない',
    async ({ secondFactor, field }) => {
      stubExternalServices();
      const user = await totpEnabledUser();

      const response = await gateway.call(
        DISABLE_TOTP,
        { input: reAuthenticationInput(PASSWORD, secondFactor) },
        { sessionToken: user.sessionToken },
      );

      expect(codesOf(response)).toEqual(['reauthentication_failed']);
      expect(detailsOf(response)).toEqual([expect.objectContaining({ field })]);
      expect(response.issuedToken).toBeUndefined();
    },
  );

  test('多要素認証が有効でなければ再発行を拒否する', async () => {
    stubExternalServices();
    const user = await verifiedUser();

    const response = await gateway.call(
      REGENERATE_RECOVERY_CODES,
      { input: reAuthenticationInput(PASSWORD) },
      { sessionToken: user.sessionToken },
    );

    expect(codesOf(response)).toEqual(['totp_not_enabled']);
  });

  test.each([
    { name: 'startTotpSetup', document: START_TOTP_SETUP },
    { name: 'disableTotp', document: DISABLE_TOTP },
    { name: 'regenerateRecoveryCodes', document: REGENERATE_RECOVERY_CODES },
  ])('未ログインの$nameはログインを求める', async ({ document }) => {
    stubExternalServices();

    const response = await gateway.call(document, {
      input: reAuthenticationInput(PASSWORD),
    });

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });
});

describe('リカバリコードの残数', () => {
  test('残数の項目を要求したときだけ数える', async () => {
    stubExternalServices();
    const user = await totpEnabledUser();
    const count = vi.spyOn(D1RecoveryCodeStore.prototype, 'count');
    onTestFinished(() => {
      count.mockRestore();
    });

    const header = await gateway.call(
      VIEWER_HEADER,
      {},
      { sessionToken: user.sessionToken },
    );
    const countedForHeader = count.mock.calls.length;
    const full = await fetchViewer(gateway, user.sessionToken);

    expect(header.errors).toBeUndefined();
    expect(countedForHeader).toBe(0);
    expect(full.data?.viewer?.remainingRecoveryCodes).toBe(2);
    expect(count).toHaveBeenCalledTimes(1);
  });
});
