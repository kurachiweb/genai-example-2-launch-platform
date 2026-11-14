import { describe, expect, test } from 'bun:test';

import type { UserRecord } from './ports.ts';
import { USER_RECOVERY_CODE_HASH_PURPOSE } from './second-factor-check.ts';
import {
  caught,
  currentOf,
  META,
  NOW,
  RE_AUTHENTICATION,
  REAUTHENTICATION_FAILED,
  rejectionOf,
  shapeOf,
  USER_ID,
  userOf,
} from './testing/credential-change-fakes.ts';
import {
  createTotpManagementFakes,
  ENABLED_CREDENTIAL,
  EXISTING_RECOVERY_HASHES,
  GENERATED_SECRET,
  ISSUED_SESSION,
  MATCHED_STEP,
  OTHER_SECRET,
  pendingCredential,
  REAUTHENTICATION_FAILED_ON_SECOND_FACTOR,
  recoveryHashOf,
  recoveryPlainOf,
  sealedOf,
  TOTP_ISSUER,
  type TotpManagementFakeOptions,
  VALID_CODE,
} from './testing/totp-management-fakes.ts';
import {
  StoreTotpManagement,
  TOTP_SETUP_TTL_SECONDS,
  type TotpManagement,
} from './totp-management.ts';

function setup(options: TotpManagementFakeOptions = {}) {
  const fakes = createTotpManagementFakes(options);
  const totpManagement: TotpManagement = new StoreTotpManagement(
    fakes.reAuthenticator,
    fakes.users,
    fakes.totpCredentials,
    fakes.recoveryCodes,
    fakes.sessionIssuer,
    fakes.settings,
    fakes.totp,
    fakes.secretBox,
    fakes.recoveryCodeIssuer,
  );
  return { totpManagement, recorded: fakes.recorded, state: fakes.state };
}

const MINUTE_MS = 60 * 1000;

const RECOVERY_PLAINS = Array.from({ length: 10 }, (_, index) =>
  recoveryPlainOf(index + 1),
);

const NEW_RECOVERY_HASHES = RECOVERY_PLAINS.map((plain) =>
  recoveryHashOf(USER_RECOVERY_CODE_HASH_PURPOSE, plain),
);

const UNVERIFIED_USER = userOf({ emailVerifiedAt: null });

const SUSPENDED_USER = userOf({ status: 'suspended' });

const EMAIL_NOT_VERIFIED = {
  kind: 'forbidden',
  code: 'email_not_verified',
  message:
    'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。',
} as const;

const ACCOUNT_UNAVAILABLE = {
  kind: 'forbidden',
  code: 'account_unavailable',
  message:
    'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
} as const;

const TOTP_ALREADY_ENABLED = {
  kind: 'conflict',
  code: 'totp_already_enabled',
  message: '多要素認証は既に有効です。',
} as const;

const TOTP_NOT_ENABLED = {
  kind: 'conflict',
  code: 'totp_not_enabled',
  message: '多要素認証は有効になっていません。',
} as const;

const TOTP_SETUP_EXPIRED = {
  kind: 'unprocessable',
  code: 'totp_setup_expired',
  message: '設定の有効期限が切れました。最初からやり直してください。',
} as const;

const INVALID_SECOND_FACTOR = {
  kind: 'unauthenticated',
  code: 'invalid_second_factor',
  message: '認証コードが正しくありません。',
} as const;

const NO_SECOND_FACTOR = {
  currentPassword: RE_AUTHENTICATION.currentPassword,
  secondFactor: undefined,
};

const NOT_ENABLED_CREDENTIALS = [
  ['設定していない', undefined],
  ['設定の途中の', pendingCredential()],
] as const;

describe('StoreTotpManagement.start', () => {
  test('有効化の開始から10分の期限は600秒である', () => {
    expect(TOTP_SETUP_TTL_SECONDS).toBe(600);
  });

  test('本人確認の後に秘密鍵を生成して利用者IDを文脈に暗号化し、10分の保留として保存して、発行者名と@ハンドルのURIと手入力用の秘密鍵を返す', async () => {
    const { totpManagement, recorded, state } = setup();

    const view = await totpManagement.start(
      currentOf(),
      NO_SECOND_FACTOR,
      META,
    );

    expect(recorded.calls).toEqual([
      'totpCredentials.find',
      'users.findById',
      'reAuthenticator.verify',
      'totp.generateSecret',
      'secretBox.seal',
      'totpCredentials.savePending',
      'totp.buildUri',
    ]);
    expect(recorded.reAuthentications).toEqual([
      { userId: USER_ID, input: NO_SECOND_FACTOR, meta: META },
    ]);
    expect(recorded.sealed).toEqual([
      { plaintext: GENERATED_SECRET, context: USER_ID },
    ]);
    const expiresAt = new Date(NOW.getTime() + 10 * MINUTE_MS);
    expect(recorded.pendings).toEqual([
      {
        userId: USER_ID,
        sealedSecret: sealedOf(GENERATED_SECRET),
        expiresAt,
      },
    ]);
    expect(recorded.uris).toEqual([
      {
        secret: GENERATED_SECRET,
        issuer: TOTP_ISSUER,
        accountLabel: `@${userOf().handle}`,
      },
    ]);
    expect(view).toEqual({
      otpauthUri: `otpauth://totp/${TOTP_ISSUER}:@${userOf().handle}?secret=${GENERATED_SECRET}`,
      secret: GENERATED_SECRET,
      expiresAt,
    });
    expect(state.credential).toEqual(
      pendingCredential({ pendingExpiresAt: expiresAt }),
    );
  });

  test('開始ではセッションを削除せず、平文の秘密鍵を保存しない', async () => {
    const { totpManagement, recorded } = setup();

    await totpManagement.start(currentOf(), NO_SECOND_FACTOR, META);

    expect(recorded.sessionDeletions).toEqual([]);
    expect(recorded.sessionIssues).toEqual([]);
    expect(
      recorded.pendings.map((pending) => pending.sealedSecret),
    ).not.toContain(GENERATED_SECRET);
  });

  test('設定の途中で開始し直すと、新しい秘密鍵の保留で置き換える', async () => {
    const { totpManagement, state } = setup({
      credential: pendingCredential({ sealedSecret: sealedOf(OTHER_SECRET) }),
    });

    await totpManagement.start(currentOf(), NO_SECOND_FACTOR, META);

    expect(state.credential?.sealedSecret).toBe(sealedOf(GENERATED_SECRET));
  });

  test.each([
    ['メールアドレスが未確認', UNVERIFIED_USER, EMAIL_NOT_VERIFIED],
    ['停止中', SUSPENDED_USER, ACCOUNT_UNAVAILABLE],
  ] as const)(
    '%sの利用者の開始は拒否し、本人確認も秘密鍵の生成もしない',
    async (_label, user: UserRecord, expected) => {
      const { totpManagement, recorded } = setup();

      const error = await caught(
        totpManagement.start(currentOf(user), NO_SECOND_FACTOR, META),
      );

      expect(shapeOf(error)).toEqual(expected);
      expect(recorded.calls).toEqual([]);
    },
  );

  test('有効化済みなら409のtotp_already_enabledで拒否し、本人確認をしない', async () => {
    const { totpManagement, recorded, state } = setup({
      credential: ENABLED_CREDENTIAL,
    });

    const error = await caught(
      totpManagement.start(currentOf(), RE_AUTHENTICATION, META),
    );

    expect(shapeOf(error)).toEqual(TOTP_ALREADY_ENABLED);
    expect(recorded.calls).toEqual(['totpCredentials.find']);
    expect(state.credential).toBe(ENABLED_CREDENTIAL);
  });

  test('本人確認に失敗したら例外をそのまま投げ、秘密鍵を生成しない', async () => {
    const { totpManagement, recorded, state } = setup({
      reAuthError: REAUTHENTICATION_FAILED,
    });

    const error = await caught(
      totpManagement.start(currentOf(), NO_SECOND_FACTOR, META),
    );

    expect(error).toBe(REAUTHENTICATION_FAILED);
    expect(recorded.calls).toEqual([
      'totpCredentials.find',
      'users.findById',
      'reAuthenticator.verify',
    ]);
    expect(state.credential).toBeUndefined();
  });

  test('保存の時点で別の要求が有効化を終えていたら、totp_already_enabledで拒否し、URIを返さない', async () => {
    const { totpManagement, recorded, state } = setup({
      enabledBeforeSave: true,
    });

    const error = await caught(
      totpManagement.start(currentOf(), NO_SECOND_FACTOR, META),
    );

    expect(shapeOf(error)).toEqual(TOTP_ALREADY_ENABLED);
    expect(recorded.uris).toEqual([]);
    expect(state.credential).toBe(ENABLED_CREDENTIAL);
  });
});

describe('StoreTotpManagement.enable', () => {
  test('保留の秘密鍵を利用者IDを文脈に復元して認証コードを照合し、照合した秘密鍵と時間窓での有効化・リカバリコード10個の保存・全セッションの削除を1つの書き込みで行ってから、操作した端末へ再発行する', async () => {
    const { totpManagement, recorded, state } = setup({
      credential: pendingCredential(),
      recoveryHashes: EXISTING_RECOVERY_HASHES,
    });

    const result = await totpManagement.enable(currentOf(), VALID_CODE, META);

    expect(recorded.calls).toEqual([
      'totpCredentials.find',
      'secretBox.open',
      'totp.verify',
      'recoveryCodeIssuer.issue',
      'totpCredentials.enableRevokingSessions',
      'sessionIssuer.issue',
    ]);
    expect(recorded.opened).toEqual([
      { sealed: sealedOf(GENERATED_SECRET), context: USER_ID },
    ]);
    expect(recorded.verifications).toEqual([
      { secret: GENERATED_SECRET, code: VALID_CODE, now: NOW },
    ]);
    expect(recorded.recoveryIssues).toEqual([USER_RECOVERY_CODE_HASH_PURPOSE]);
    expect(recorded.enables).toEqual([
      {
        userId: USER_ID,
        sealedSecret: sealedOf(GENERATED_SECRET),
        step: MATCHED_STEP,
        at: NOW,
        recoveryHashes: NEW_RECOVERY_HASHES,
      },
    ]);
    expect(recorded.sessionDeletions).toEqual([USER_ID]);
    expect(recorded.sessionIssues).toEqual([{ userId: USER_ID, meta: META }]);
    expect(result).toEqual({
      recoveryCodes: RECOVERY_PLAINS,
      session: ISSUED_SESSION,
    });
    expect(state.credential).toMatchObject({
      enabledAt: NOW,
      lastUsedStep: MATCHED_STEP,
    });
    expect(state.recoveryHashes).toEqual(NEW_RECOVERY_HASHES);
  });

  test('全角の数字と空白を含む認証コードも正規化して照合する', async () => {
    const { totpManagement, recorded } = setup({
      credential: pendingCredential(),
    });

    await totpManagement.enable(currentOf(), ' １２３ ４５６ ', META);

    expect(recorded.verifications.map((call) => call.code)).toEqual([
      VALID_CODE,
    ]);
  });

  test('誤った認証コードは401のinvalid_second_factorで拒否し、有効化もセッションの削除もしない', async () => {
    const { totpManagement, recorded, state } = setup({
      credential: pendingCredential(),
    });

    const error = await caught(
      totpManagement.enable(currentOf(), ['654', '321'].join(''), META),
    );

    expect(shapeOf(error)).toEqual(INVALID_SECOND_FACTOR);
    expect(recorded.calls).toEqual([
      'totpCredentials.find',
      'secretBox.open',
      'totp.verify',
    ]);
    expect(state.credential).toEqual(pendingCredential());
  });

  test('認証コードの形でない入力は、秘密鍵を復元せずにinvalid_second_factorで拒否する', async () => {
    const { totpManagement, recorded } = setup({
      credential: pendingCredential(),
    });

    const error = await caught(
      totpManagement.enable(currentOf(), 'abc-def', META),
    );

    expect(shapeOf(error)).toEqual(INVALID_SECOND_FACTOR);
    expect(recorded.calls).toEqual(['totpCredentials.find']);
  });

  test.each([
    ['保留が無い', undefined],
    ['期限ちょうどの', pendingCredential({ pendingExpiresAt: NOW })],
    [
      '期限切れの',
      pendingCredential({ pendingExpiresAt: new Date(NOW.getTime() - 1) }),
    ],
  ] as const)(
    '%s設定の有効化は422のtotp_setup_expiredで拒否し、認証コードを照合しない',
    async (_label, credential) => {
      const { totpManagement, recorded } = setup({ credential });

      const error = await caught(
        totpManagement.enable(currentOf(), VALID_CODE, META),
      );

      expect(shapeOf(error)).toEqual(TOTP_SETUP_EXPIRED);
      expect(recorded.calls).toEqual(['totpCredentials.find']);
    },
  );

  test('有効化済みならtotp_already_enabledで拒否し、既存の設定とリカバリコードを変えない', async () => {
    const { totpManagement, recorded, state } = setup({
      credential: ENABLED_CREDENTIAL,
      recoveryHashes: EXISTING_RECOVERY_HASHES,
    });

    const error = await caught(
      totpManagement.enable(currentOf(), VALID_CODE, META),
    );

    expect(shapeOf(error)).toEqual(TOTP_ALREADY_ENABLED);
    expect(recorded.calls).toEqual(['totpCredentials.find']);
    expect(state.recoveryHashes).toEqual(EXISTING_RECOVERY_HASHES);
  });

  test('照合の後に別の要求が設定を始め直していたら、照合していない秘密鍵を有効にせずtotp_setup_expiredで拒否する', async () => {
    const { totpManagement, recorded, state } = setup({
      credential: pendingCredential(),
      restartedAfterFindWith: OTHER_SECRET,
    });

    const error = await caught(
      totpManagement.enable(currentOf(), VALID_CODE, META),
    );

    expect(shapeOf(error)).toEqual(TOTP_SETUP_EXPIRED);
    expect(recorded.enables.map((call) => call.sealedSecret)).toEqual([
      sealedOf(GENERATED_SECRET),
    ]);
    expect(state.credential).toMatchObject({
      sealedSecret: sealedOf(OTHER_SECRET),
      enabledAt: null,
    });
    expect(state.recoveryHashes).toEqual([]);
    expect(recorded.sessionDeletions).toEqual([]);
    expect(recorded.sessionIssues).toEqual([]);
  });

  test.each([
    ['メールアドレスが未確認', UNVERIFIED_USER, EMAIL_NOT_VERIFIED],
    ['停止中', SUSPENDED_USER, ACCOUNT_UNAVAILABLE],
  ] as const)(
    '%sの利用者の有効化は拒否し、設定を読まない',
    async (_label, user: UserRecord, expected) => {
      const { totpManagement, recorded } = setup({
        credential: pendingCredential(),
      });

      const error = await caught(
        totpManagement.enable(currentOf(user), VALID_CODE, META),
      );

      expect(shapeOf(error)).toEqual(expected);
      expect(recorded.calls).toEqual([]);
    },
  );

  test('有効化と全セッションの削除の書き込みに失敗したら例外をそのまま投げ、新しいセッションを発行しない', async () => {
    const writeError = new Error('D1の書き込みに失敗しました');
    const { totpManagement, recorded } = setup({
      credential: pendingCredential(),
      writeError,
    });

    const rejection = await rejectionOf(
      totpManagement.enable(currentOf(), VALID_CODE, META),
    );

    expect(rejection).toBe(writeError);
    expect(recorded.sessionIssues).toEqual([]);
  });
});

describe('StoreTotpManagement.disable', () => {
  test('本人確認の後に秘密鍵と未使用のリカバリコードの削除と全セッションの削除を1つの書き込みで行ってから、操作した端末へ再発行する', async () => {
    const { totpManagement, recorded, state } = setup({
      credential: ENABLED_CREDENTIAL,
      recoveryHashes: EXISTING_RECOVERY_HASHES,
    });

    const result = await totpManagement.disable(
      currentOf(),
      RE_AUTHENTICATION,
      META,
    );

    expect(recorded.calls).toEqual([
      'totpCredentials.find',
      'users.findById',
      'reAuthenticator.verify',
      'totpCredentials.disableRevokingSessions',
      'sessionIssuer.issue',
    ]);
    expect(recorded.reAuthentications).toEqual([
      { userId: USER_ID, input: RE_AUTHENTICATION, meta: META },
    ]);
    expect(state.credential).toBeUndefined();
    expect(state.recoveryHashes).toEqual([]);
    expect(recorded.sessionDeletions).toEqual([USER_ID]);
    expect(recorded.sessionIssues).toEqual([{ userId: USER_ID, meta: META }]);
    expect(result).toEqual({ session: ISSUED_SESSION });
  });

  test.each(NOT_ENABLED_CREDENTIALS)(
    '%s利用者の無効化は409のtotp_not_enabledで拒否し、本人確認をしない',
    async (_label, credential) => {
      const { totpManagement, recorded } = setup({ credential });

      const error = await caught(
        totpManagement.disable(currentOf(), RE_AUTHENTICATION, META),
      );

      expect(shapeOf(error)).toEqual(TOTP_NOT_ENABLED);
      expect(recorded.calls).toEqual(['totpCredentials.find']);
    },
  );

  test('本人確認に失敗したら例外をそのまま投げ、設定もセッションも消さない', async () => {
    const { totpManagement, recorded, state } = setup({
      credential: ENABLED_CREDENTIAL,
      recoveryHashes: EXISTING_RECOVERY_HASHES,
      reAuthError: REAUTHENTICATION_FAILED_ON_SECOND_FACTOR,
    });

    const error = await caught(
      totpManagement.disable(currentOf(), RE_AUTHENTICATION, META),
    );

    expect(error).toBe(REAUTHENTICATION_FAILED_ON_SECOND_FACTOR);
    expect(state.credential).toBe(ENABLED_CREDENTIAL);
    expect(state.recoveryHashes).toEqual(EXISTING_RECOVERY_HASHES);
    expect(recorded.sessionDeletions).toEqual([]);
  });

  test('本人確認の後に別の要求が無効化を終えていたら、409のtotp_not_enabledで拒否し、新しいセッションを発行しない', async () => {
    const { totpManagement, recorded } = setup({
      credential: ENABLED_CREDENTIAL,
      recoveryHashes: EXISTING_RECOVERY_HASHES,
      disabledAfterFind: true,
    });

    const error = await caught(
      totpManagement.disable(currentOf(), RE_AUTHENTICATION, META),
    );

    expect(shapeOf(error)).toEqual(TOTP_NOT_ENABLED);
    expect(recorded.sessionDeletions).toEqual([]);
    expect(recorded.sessionIssues).toEqual([]);
  });

  test('無効化と全セッションの削除の書き込みに失敗したら例外をそのまま投げ、新しいセッションを発行しない', async () => {
    const writeError = new Error('D1の書き込みに失敗しました');
    const { totpManagement, recorded } = setup({
      credential: ENABLED_CREDENTIAL,
      writeError,
    });

    const rejection = await rejectionOf(
      totpManagement.disable(currentOf(), RE_AUTHENTICATION, META),
    );

    expect(rejection).toBe(writeError);
    expect(recorded.sessionIssues).toEqual([]);
  });

  test('停止中の利用者の無効化は拒否し、設定を読まない', async () => {
    const { totpManagement, recorded } = setup({
      credential: ENABLED_CREDENTIAL,
    });

    const error = await caught(
      totpManagement.disable(
        currentOf(SUSPENDED_USER),
        RE_AUTHENTICATION,
        META,
      ),
    );

    expect(shapeOf(error)).toEqual(ACCOUNT_UNAVAILABLE);
    expect(recorded.calls).toEqual([]);
  });
});

describe('StoreTotpManagement.regenerateRecoveryCodes', () => {
  test('本人確認の後に未使用のリカバリコードの新しい10個への置き換えと全セッションの削除を1つの書き込みで行ってから、操作した端末へ再発行し、平文を返す', async () => {
    const { totpManagement, recorded, state } = setup({
      credential: ENABLED_CREDENTIAL,
      recoveryHashes: EXISTING_RECOVERY_HASHES,
    });

    const result = await totpManagement.regenerateRecoveryCodes(
      currentOf(),
      RE_AUTHENTICATION,
      META,
    );

    expect(recorded.calls).toEqual([
      'totpCredentials.find',
      'users.findById',
      'reAuthenticator.verify',
      'recoveryCodeIssuer.issue',
      'recoveryCodes.replaceAllRevokingSessions',
      'sessionIssuer.issue',
    ]);
    expect(recorded.recoveryIssues).toEqual([USER_RECOVERY_CODE_HASH_PURPOSE]);
    expect(state.recoveryHashes).toEqual(NEW_RECOVERY_HASHES);
    expect(state.credential).toBe(ENABLED_CREDENTIAL);
    expect(recorded.sessionDeletions).toEqual([USER_ID]);
    expect(recorded.sessionIssues).toEqual([{ userId: USER_ID, meta: META }]);
    expect(result).toEqual({
      recoveryCodes: RECOVERY_PLAINS,
      session: ISSUED_SESSION,
    });
  });

  test.each(NOT_ENABLED_CREDENTIALS)(
    '%s利用者の再発行は409のtotp_not_enabledで拒否し、本人確認をしない',
    async (_label, credential) => {
      const { totpManagement, recorded } = setup({ credential });

      const error = await caught(
        totpManagement.regenerateRecoveryCodes(
          currentOf(),
          RE_AUTHENTICATION,
          META,
        ),
      );

      expect(shapeOf(error)).toEqual(TOTP_NOT_ENABLED);
      expect(recorded.calls).toEqual(['totpCredentials.find']);
    },
  );

  test('本人確認に失敗したら例外をそのまま投げ、既存のリカバリコードを残す', async () => {
    const { totpManagement, recorded, state } = setup({
      credential: ENABLED_CREDENTIAL,
      recoveryHashes: EXISTING_RECOVERY_HASHES,
      reAuthError: REAUTHENTICATION_FAILED_ON_SECOND_FACTOR,
    });

    const error = await caught(
      totpManagement.regenerateRecoveryCodes(
        currentOf(),
        RE_AUTHENTICATION,
        META,
      ),
    );

    expect(error).toBe(REAUTHENTICATION_FAILED_ON_SECOND_FACTOR);
    expect(recorded.recoveryIssues).toEqual([]);
    expect(state.recoveryHashes).toEqual(EXISTING_RECOVERY_HASHES);
    expect(recorded.sessionDeletions).toEqual([]);
  });

  test('本人確認の後に別の要求が無効化を終えていたら、平文のリカバリコードを返さず409のtotp_not_enabledで拒否し、新しいセッションを発行しない', async () => {
    const { totpManagement, recorded, state } = setup({
      credential: ENABLED_CREDENTIAL,
      recoveryHashes: EXISTING_RECOVERY_HASHES,
      disabledAfterFind: true,
    });

    const error = await caught(
      totpManagement.regenerateRecoveryCodes(
        currentOf(),
        RE_AUTHENTICATION,
        META,
      ),
    );

    expect(shapeOf(error)).toEqual(TOTP_NOT_ENABLED);
    expect(state.recoveryHashes).toEqual([]);
    expect(recorded.sessionDeletions).toEqual([]);
    expect(recorded.sessionIssues).toEqual([]);
  });

  test('置き換えと全セッションの削除の書き込みに失敗したら例外をそのまま投げ、新しいセッションを発行しない', async () => {
    const writeError = new Error('D1の書き込みに失敗しました');
    const { totpManagement, recorded } = setup({
      credential: ENABLED_CREDENTIAL,
      writeError,
    });

    const rejection = await rejectionOf(
      totpManagement.regenerateRecoveryCodes(
        currentOf(),
        RE_AUTHENTICATION,
        META,
      ),
    );

    expect(rejection).toBe(writeError);
    expect(recorded.sessionIssues).toEqual([]);
  });

  test('停止中の利用者の再発行は拒否し、設定を読まない', async () => {
    const { totpManagement, recorded } = setup({
      credential: ENABLED_CREDENTIAL,
    });

    const error = await caught(
      totpManagement.regenerateRecoveryCodes(
        currentOf(SUSPENDED_USER),
        RE_AUTHENTICATION,
        META,
      ),
    );

    expect(shapeOf(error)).toEqual(ACCOUNT_UNAVAILABLE);
    expect(recorded.calls).toEqual([]);
  });
});
