import { describe, expect, test } from 'bun:test';

import { ADMIN_HASH_PURPOSES } from '../../domain/admin/admin-auth-token-purpose.ts';
import { ADMIN_TOTP_SETUP_TTL_SECONDS } from './admin-invitation.ts';
import {
  type AdminTotpManagement,
  StoreAdminTotpManagement,
} from './admin-totp-management.ts';
import {
  ADMIN_ID,
  adminOf,
  caught,
  currentAdminOf,
  invitedAdminOf,
  ISSUED_SESSION,
  META,
  MINUTE_MS,
  NOW,
  RE_AUTHENTICATION,
  REAUTHENTICATION_FAILED,
  rejectionOf,
  shapeOf,
  UNAUTHENTICATED,
} from './testing/admin-credential-change-fakes.ts';
import {
  ADMIN_SECRET_CONTEXT,
  type AdminTotpManagementFakeOptions,
  createAdminTotpManagementFakes,
  CURRENT_SECRET,
  ENABLED_CREDENTIAL,
  EXISTING_RECOVERY_HASHES,
  GENERATED_SECRET,
  MATCHED_STEP,
  recoveryHashOf,
  recoveryPlainOf,
  resettingCredential,
  RESTARTED_SECRET,
  sealedOf,
  TOTP_ISSUER,
  VALID_CODE,
} from './testing/admin-totp-management-fakes.ts';

function setup(options: AdminTotpManagementFakeOptions = {}) {
  const fakes = createAdminTotpManagementFakes(options);
  const totpManagement: AdminTotpManagement = new StoreAdminTotpManagement(
    fakes.reAuthenticator,
    fakes.admins,
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

const CURRENT = currentAdminOf();

const RECOVERY_PLAINS = Array.from({ length: 10 }, (_, index) =>
  recoveryPlainOf(index + 1),
);

const NEW_RECOVERY_HASHES = RECOVERY_PLAINS.map((plain) =>
  recoveryHashOf(ADMIN_HASH_PURPOSES.recoveryCode, plain),
);

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

const UNAVAILABLE_OPERATORS = [
  ['削除された', []],
  ['招待中に戻った', [invitedAdminOf()]],
] as const;

describe('StoreAdminTotpManagement.startReset', () => {
  test('本人確認のうえで新しい秘密鍵を管理者の文脈で封じて10分の保留にし、現在の設定を有効なまま残す', async () => {
    const { totpManagement, recorded, state } = setup();

    const view = await totpManagement.startReset(
      CURRENT,
      RE_AUTHENTICATION,
      META,
    );

    const expiresAt = new Date(
      NOW.getTime() + ADMIN_TOTP_SETUP_TTL_SECONDS * 1000,
    );
    expect(view).toEqual({
      otpauthUri: `otpauth://totp/${TOTP_ISSUER}:管理者:はなこ?secret=${GENERATED_SECRET}`,
      secret: GENERATED_SECRET,
      expiresAt,
    });
    expect(expiresAt.getTime() - NOW.getTime()).toBe(10 * MINUTE_MS);
    expect(recorded.reAuthentications).toEqual([
      { admin: adminOf(), input: RE_AUTHENTICATION, meta: META },
    ]);
    expect(recorded.sealed).toEqual([
      { plaintext: GENERATED_SECRET, context: ADMIN_SECRET_CONTEXT },
    ]);
    expect(recorded.pendings).toEqual([
      {
        adminId: ADMIN_ID,
        sealedSecret: sealedOf(GENERATED_SECRET),
        expiresAt,
      },
    ]);
    expect(state.credential).toEqual({
      ...ENABLED_CREDENTIAL,
      pendingSealedSecret: sealedOf(GENERATED_SECRET),
      pendingExpiresAt: expiresAt,
    });
    expect(state.recoveryHashes).toEqual(EXISTING_RECOVERY_HASHES);
    expect(recorded.sessionDeletions).toEqual([]);
    expect(recorded.sessionIssues).toEqual([]);
  });

  test('操作者の行を読み直してから本人確認し、通った後にだけ秘密鍵を作って保存する', async () => {
    const { totpManagement, recorded } = setup();

    await totpManagement.startReset(CURRENT, RE_AUTHENTICATION, META);

    expect(recorded.calls).toEqual([
      'admins.findById',
      'reAuthenticator.verify',
      'totp.generateSecret',
      'secretBox.seal',
      'totpCredentials.savePending',
      'totp.buildUri',
    ]);
  });

  test('認証アプリのラベルは「管理者:<ニックネーム>」で、@を含むニックネームはラベルに出さない', async () => {
    const atNickname = adminOf({ nickname: 'hanako@admin' });
    const { totpManagement, recorded } = setup({ admins: [atNickname] });

    await totpManagement.startReset(
      currentAdminOf(atNickname),
      RE_AUTHENTICATION,
      META,
    );

    expect(recorded.uris).toEqual([
      {
        secret: GENERATED_SECRET,
        issuer: TOTP_ISSUER,
        accountLabel: '管理者',
      },
    ]);
  });

  test('本人確認に失敗したら秘密鍵を作らず保留も保存しない', async () => {
    const { totpManagement, recorded, state } = setup({
      reAuthError: REAUTHENTICATION_FAILED,
    });

    const error = await rejectionOf(
      totpManagement.startReset(CURRENT, RE_AUTHENTICATION, META),
    );

    expect(error).toBe(REAUTHENTICATION_FAILED);
    expect(recorded.calls).toEqual([
      'admins.findById',
      'reAuthenticator.verify',
    ]);
    expect(state.credential).toEqual(ENABLED_CREDENTIAL);
  });

  test.each(UNAVAILABLE_OPERATORS)(
    '認可の後に%s操作者は本人確認へ進ませず未ログインとして拒否する',
    async (_label, admins) => {
      const { totpManagement, recorded } = setup({ admins });

      const error = await caught(
        totpManagement.startReset(CURRENT, RE_AUTHENTICATION, META),
      );

      expect(shapeOf(error)).toEqual(UNAUTHENTICATED);
      expect(recorded.calls).toEqual(['admins.findById']);
    },
  );
});

describe('StoreAdminTotpManagement.completeReset', () => {
  test('期限内の保留の秘密鍵の正しい認証コードで、入れ替え・リカバリコードの全件の置き換え・全セッションの削除を行い、操作した端末へ発行する', async () => {
    const { totpManagement, recorded, state } = setup({
      credential: resettingCredential(),
    });

    const result = await totpManagement.completeReset(
      CURRENT,
      VALID_CODE,
      META,
    );

    expect(result).toEqual({
      recoveryCodes: RECOVERY_PLAINS,
      session: ISSUED_SESSION,
    });
    expect(recorded.opened).toEqual([
      { sealed: sealedOf(GENERATED_SECRET), context: ADMIN_SECRET_CONTEXT },
    ]);
    expect(recorded.verifications).toEqual([
      { secret: GENERATED_SECRET, code: VALID_CODE, now: NOW },
    ]);
    expect(recorded.recoveryIssues).toEqual([ADMIN_HASH_PURPOSES.recoveryCode]);
    expect(recorded.commits).toEqual([
      {
        adminId: ADMIN_ID,
        commit: {
          pendingSealedSecret: sealedOf(GENERATED_SECRET),
          step: MATCHED_STEP,
          at: NOW,
          recoveryHashes: NEW_RECOVERY_HASHES,
        },
      },
    ]);
    expect(state.credential).toEqual({
      ...ENABLED_CREDENTIAL,
      sealedSecret: sealedOf(GENERATED_SECRET),
      lastUsedStep: MATCHED_STEP,
      pendingSealedSecret: null,
      pendingExpiresAt: null,
    });
    expect(state.recoveryHashes).toEqual(NEW_RECOVERY_HASHES);
    expect(recorded.sessionDeletions).toEqual([ADMIN_ID]);
    expect(recorded.sessionIssues).toEqual([{ adminId: ADMIN_ID, meta: META }]);
  });

  test('全セッションを消す書き込みの後にだけ操作した端末へ発行し、本人確認は求めない', async () => {
    const { totpManagement, recorded } = setup({
      credential: resettingCredential(),
    });

    await totpManagement.completeReset(CURRENT, VALID_CODE, META);

    expect(recorded.calls).toEqual([
      'admins.findById',
      'totpCredentials.find',
      'secretBox.open',
      'totp.verify',
      'recoveryCodeIssuer.issue',
      'totpCredentials.commitPendingRevokingSessions',
      'sessions.issue',
    ]);
  });

  test.each([
    ['期限ちょうどの保留', resettingCredential({ pendingExpiresAt: NOW })],
    [
      '期限を過ぎた保留',
      resettingCredential({
        pendingExpiresAt: new Date(NOW.getTime() - MINUTE_MS),
      }),
    ],
    ['保留の無い設定', ENABLED_CREDENTIAL],
    [
      '有効になっていない設定の保留',
      resettingCredential({ sealedSecret: null, enabledAt: null }),
    ],
  ] as const)(
    '%sは照合せずに設定の期限切れで拒否し、現在の設定を変えない',
    async (_label, credential) => {
      const { totpManagement, recorded, state } = setup({ credential });

      const error = await caught(
        totpManagement.completeReset(CURRENT, VALID_CODE, META),
      );

      expect(shapeOf(error)).toEqual(TOTP_SETUP_EXPIRED);
      expect(recorded.calls).toEqual([
        'admins.findById',
        'totpCredentials.find',
      ]);
      expect(state.credential).toEqual(credential);
      expect(state.recoveryHashes).toEqual(EXISTING_RECOVERY_HASHES);
      expect(recorded.sessionDeletions).toEqual([]);
    },
  );

  test('資格情報が無いときも設定の期限切れで拒否する', async () => {
    const { totpManagement } = setup({ credential: undefined });

    const error = await caught(
      totpManagement.completeReset(CURRENT, VALID_CODE, META),
    );

    expect(shapeOf(error)).toEqual(TOTP_SETUP_EXPIRED);
  });

  test('誤った認証コードは拒否し、リカバリコードを作らず現在の設定を変えない', async () => {
    const credential = resettingCredential();
    const { totpManagement, recorded, state } = setup({ credential });

    const error = await caught(
      totpManagement.completeReset(CURRENT, ['000', '000'].join(''), META),
    );

    expect(shapeOf(error)).toEqual(INVALID_SECOND_FACTOR);
    expect(recorded.recoveryIssues).toEqual([]);
    expect(recorded.commits).toEqual([]);
    expect(state.credential).toEqual(credential);
    expect(state.recoveryHashes).toEqual(EXISTING_RECOVERY_HASHES);
    expect(recorded.sessionIssues).toEqual([]);
  });

  test('6桁の数字でない認証コードは照合せずに拒否する', async () => {
    const { totpManagement, recorded } = setup({
      credential: resettingCredential(),
    });

    const error = await caught(
      totpManagement.completeReset(CURRENT, 'abc123', META),
    );

    expect(shapeOf(error)).toEqual(INVALID_SECOND_FACTOR);
    expect(recorded.verifications).toEqual([]);
  });

  test('照合の後に再設定が始め直されたら、照合した秘密鍵へ入れ替えず平文もセッションも渡さない', async () => {
    const { totpManagement, recorded, state } = setup({
      credential: resettingCredential(),
      restartedAfterFindWith: RESTARTED_SECRET,
    });

    const error = await caught(
      totpManagement.completeReset(CURRENT, VALID_CODE, META),
    );

    expect(shapeOf(error)).toEqual(TOTP_SETUP_EXPIRED);
    expect(state.credential?.sealedSecret).toBe(sealedOf(CURRENT_SECRET));
    expect(state.credential?.pendingSealedSecret).toBe(
      sealedOf(RESTARTED_SECRET),
    );
    expect(state.recoveryHashes).toEqual(EXISTING_RECOVERY_HASHES);
    expect(recorded.sessionDeletions).toEqual([]);
    expect(recorded.sessionIssues).toEqual([]);
  });

  test('入れ替えの書き込みに失敗したら、その例外をそのまま投げてセッションを発行しない', async () => {
    const writeError = new Error('D1の書き込みに失敗しました');
    const { totpManagement, recorded } = setup({
      credential: resettingCredential(),
      writeError,
    });

    const error = await rejectionOf(
      totpManagement.completeReset(CURRENT, VALID_CODE, META),
    );

    expect(error).toBe(writeError);
    expect(recorded.sessionIssues).toEqual([]);
  });

  test.each(UNAVAILABLE_OPERATORS)(
    '認可の後に%s操作者は資格情報を読まずに未ログインとして拒否する',
    async (_label, admins) => {
      const { totpManagement, recorded } = setup({
        admins,
        credential: resettingCredential(),
      });

      const error = await caught(
        totpManagement.completeReset(CURRENT, VALID_CODE, META),
      );

      expect(shapeOf(error)).toEqual(UNAUTHENTICATED);
      expect(recorded.calls).toEqual(['admins.findById']);
    },
  );
});

describe('StoreAdminTotpManagement.regenerateRecoveryCodes', () => {
  test('本人確認のうえで未使用のリカバリコードを新しい10個へ置き換えて全セッションを消し、操作した端末へ発行する', async () => {
    const { totpManagement, recorded, state } = setup();

    const result = await totpManagement.regenerateRecoveryCodes(
      CURRENT,
      RE_AUTHENTICATION,
      META,
    );

    expect(result).toEqual({
      recoveryCodes: RECOVERY_PLAINS,
      session: ISSUED_SESSION,
    });
    expect(recorded.reAuthentications).toEqual([
      { admin: adminOf(), input: RE_AUTHENTICATION, meta: META },
    ]);
    expect(recorded.recoveryIssues).toEqual([ADMIN_HASH_PURPOSES.recoveryCode]);
    expect(recorded.replacements).toEqual([
      { adminId: ADMIN_ID, hashes: NEW_RECOVERY_HASHES },
    ]);
    expect(state.recoveryHashes).toEqual(NEW_RECOVERY_HASHES);
    expect(state.recoveryHashes).not.toContain(EXISTING_RECOVERY_HASHES[0]);
    expect(state.credential).toEqual(ENABLED_CREDENTIAL);
    expect(recorded.sessionDeletions).toEqual([ADMIN_ID]);
    expect(recorded.sessionIssues).toEqual([{ adminId: ADMIN_ID, meta: META }]);
    expect(recorded.calls).toEqual([
      'admins.findById',
      'reAuthenticator.verify',
      'recoveryCodeIssuer.issue',
      'recoveryCodes.replaceAllRevokingSessions',
      'sessions.issue',
    ]);
  });

  test('本人確認に失敗したらリカバリコードを作らず置き換えない', async () => {
    const { totpManagement, recorded, state } = setup({
      reAuthError: REAUTHENTICATION_FAILED,
    });

    const error = await rejectionOf(
      totpManagement.regenerateRecoveryCodes(CURRENT, RE_AUTHENTICATION, META),
    );

    expect(error).toBe(REAUTHENTICATION_FAILED);
    expect(recorded.recoveryIssues).toEqual([]);
    expect(state.recoveryHashes).toEqual(EXISTING_RECOVERY_HASHES);
    expect(recorded.sessionIssues).toEqual([]);
  });

  test('本人確認の後に管理者が削除されて何も保存されなければ、使えない平文を返さず未ログインとして拒否する', async () => {
    const { totpManagement, recorded } = setup({ removedAfterReAuth: true });

    const error = await caught(
      totpManagement.regenerateRecoveryCodes(CURRENT, RE_AUTHENTICATION, META),
    );

    expect(shapeOf(error)).toEqual(UNAUTHENTICATED);
    expect(recorded.sessionDeletions).toEqual([]);
    expect(recorded.sessionIssues).toEqual([]);
  });

  test.each(UNAVAILABLE_OPERATORS)(
    '認可の後に%s操作者は本人確認へ進ませず未ログインとして拒否する',
    async (_label, admins) => {
      const { totpManagement, recorded } = setup({ admins });

      const error = await caught(
        totpManagement.regenerateRecoveryCodes(
          CURRENT,
          RE_AUTHENTICATION,
          META,
        ),
      );

      expect(shapeOf(error)).toEqual(UNAUTHENTICATED);
      expect(recorded.calls).toEqual(['admins.findById']);
    },
  );
});

describe('StoreAdminTotpManagementの操作', () => {
  test('多要素認証を無効にする操作を持たず、再設定の2段階とリカバリコードの再発行だけを持つ', () => {
    expect(
      Object.getOwnPropertyNames(StoreAdminTotpManagement.prototype).toSorted(),
    ).toEqual([
      'completeReset',
      'constructor',
      'regenerateRecoveryCodes',
      'startReset',
    ]);
  });
});
