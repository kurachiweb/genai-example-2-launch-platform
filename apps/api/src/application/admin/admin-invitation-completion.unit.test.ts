import { describe, expect, test } from 'bun:test';

import { ADMIN_HASH_PURPOSES } from '../../domain/admin/admin-auth-token-purpose.ts';
import { ADMIN_SESSION_POLICY } from '../../domain/admin/admin-session-policy.ts';
import { normalizeRecoveryCodeInput } from '../../domain/auth/recovery-code-format.ts';
import { newSessionTimes } from '../../domain/auth/session-policy.ts';
import { ADMIN_TOTP_SETUP_TTL_SECONDS } from './admin-invitation.ts';
import {
  activeAdmin,
  type AdminInvitationFakes,
  GENERATED_TOTP_SECRET,
  hashedOf,
  INVITATION_META,
  INVITATION_NOW,
  INVITATION_TOKEN,
  INVITED_EMAIL,
  INVITED_ID,
  invitedAdmin,
  NEW_PASSWORD,
  sealedOf,
  setupAdminInvitation,
  storedHashOf,
  TOTP_ISSUER,
  VALID_CODE,
  VALID_STEP,
  validInvitationToken,
} from './testing/admin-invitation-fakes.ts';
import { caught, errorShape } from './testing/admin-login-fakes.ts';

const NICKNAME_LIKE_PASSWORD = ['night', 'owl', 'ADMIN'].join(' ');
const LOCAL_PART_LIKE_PASSWORD = ['INVITED', '1'].join('');
const SHORT_PASSWORD = ['sh', 'ort'].join('');
const MS_PER_SECOND = 1000;

const SETUP_EXPIRES_AT = new Date(
  INVITATION_NOW.getTime() + ADMIN_TOTP_SETUP_TTL_SECONDS * MS_PER_SECOND,
);

const SEALED_PENDING = sealedOf(GENERATED_TOTP_SECRET, `admin:${INVITED_ID}`);

const INVITATION_LINK_INVALID = {
  kind: 'unprocessable',
  code: 'invalid_link',
  message:
    'このリンクは無効か、有効期限が切れています。招待した管理者に再送を依頼してください。',
  status: 422,
  retryAfterSeconds: undefined,
};

const TOTP_SETUP_EXPIRED = {
  kind: 'unprocessable',
  code: 'totp_setup_expired',
  message: '設定の有効期限が切れました。最初からやり直してください。',
  status: 422,
  retryAfterSeconds: undefined,
};

const INVALID_SECOND_FACTOR = {
  kind: 'unauthenticated',
  code: 'invalid_second_factor',
  message: '認証コードが正しくありません。',
  status: 401,
  retryAfterSeconds: undefined,
};

const ADMIN_MATCHES_IDENTITY_MESSAGE =
  'ニックネーム・メールアドレス(@より前の部分を含む)と同じパスワードは使えません。';

const START_INPUT = {
  token: INVITATION_TOKEN,
  nickname: '  新しい管理者  ',
  password: NEW_PASSWORD,
};

const PENDING_TOTP = {
  sealedSecret: null,
  enabledAt: null,
  lastUsedStep: null,
  pendingSealedSecret: SEALED_PENDING,
  pendingExpiresAt: SETUP_EXPIRES_AT,
};

const PROFILED_INVITED = invitedAdmin({
  nickname: '新しい管理者',
  passwordHash: storedHashOf(NEW_PASSWORD),
});

function setupStarted(
  overrides: Parameters<typeof setupAdminInvitation>[0] = {},
): AdminInvitationFakes {
  return setupAdminInvitation({
    admins: [PROFILED_INVITED],
    tokens: [validInvitationToken()],
    totp: PENDING_TOTP,
    ...overrides,
  });
}

describe('StoreAdminInvitation.start', () => {
  test('有効なトークンでは、トークンを消費せずにニックネームとパスワードを仮に保存し、10分の保留のTOTPの秘密鍵を管理者の文脈で封じて保存する', async () => {
    const fakes = setupAdminInvitation({
      admins: [invitedAdmin()],
      tokens: [validInvitationToken()],
    });

    const view = await fakes.invitation.start(START_INPUT, INVITATION_META);

    expect(ADMIN_TOTP_SETUP_TTL_SECONDS).toBe(600);
    expect(view).toEqual({
      otpauthUri: `otpauth://totp/${TOTP_ISSUER}:管理者:新しい管理者?secret=${GENERATED_TOTP_SECRET}`,
      secret: GENERATED_TOTP_SECRET,
      expiresAt: SETUP_EXPIRES_AT,
    });
    expect(fakes.state.calls).not.toContain('tokens.consume');
    expect(fakes.state.tokens).toEqual([validInvitationToken()]);
    expect(fakes.state.pendingProfiles).toEqual([
      {
        adminId: INVITED_ID,
        nickname: '新しい管理者',
        passwordHash: storedHashOf(NEW_PASSWORD),
      },
    ]);
    expect(fakes.state.totp.get(INVITED_ID)).toEqual(PENDING_TOTP);
    expect(fakes.state.admins.get(INVITED_ID)?.status).toBe('invited');
    expect(fakes.state.pwnedChecks).toEqual([NEW_PASSWORD]);
  });

  test('ニックネームに@を含むと、認証アプリのラベルにニックネームを出さない', async () => {
    const fakes = setupAdminInvitation({
      admins: [invitedAdmin()],
      tokens: [validInvitationToken()],
    });

    await fakes.invitation.start(
      { ...START_INPUT, nickname: 'ops@team' },
      INVITATION_META,
    );

    expect(fakes.state.uriLabels).toEqual(['管理者']);
    expect(fakes.state.pendingProfiles[0]?.nickname).toBe('ops@team');
  });

  test.each([
    ['存在しない', [validInvitationToken({ tokenHash: 'other' })]],
    ['期限切れの', [validInvitationToken({ expiresAt: INVITATION_NOW })]],
    ['使用済みの', [validInvitationToken({ consumed: true })]],
    ['別の用途の', [validInvitationToken({ purpose: 'password_reset' })]],
  ] as const)(
    '%sトークンは、再送の依頼を添えたリンクの無効として何も保存しない',
    async (_label, tokens) => {
      const fakes = setupAdminInvitation({
        admins: [invitedAdmin()],
        tokens,
      });

      const error = await caught(
        fakes.invitation.start(START_INPUT, INVITATION_META),
      );

      expect(errorShape(error)).toEqual(INVITATION_LINK_INVALID);
      expect(fakes.state.calls).toEqual(['tokens.findValid']);
    },
  );

  test.each([
    ['既に有効な', [activeAdmin()]],
    ['削除された', []],
  ] as const)(
    '%s管理者のトークンは、リンクの無効として何も保存しない',
    async (_label, admins) => {
      const fakes = setupAdminInvitation({
        admins,
        tokens: [validInvitationToken()],
      });

      const error = await caught(
        fakes.invitation.start(START_INPUT, INVITATION_META),
      );

      expect(errorShape(error)).toEqual(INVITATION_LINK_INVALID);
      expect(fakes.state.pendingProfiles).toEqual([]);
      expect(fakes.state.calls).not.toContain('totpCredentials.savePending');
    },
  );

  test.each([
    ['空白だけの', ' 　', 'empty'],
    ['26書記素の', 'あ'.repeat(26), 'too-long'],
  ] as const)(
    '%sニックネームは、ニックネームの欄の入力の検証の失敗として照合も保存もしない',
    async (_label, nickname, code) => {
      const fakes = setupAdminInvitation({
        admins: [invitedAdmin()],
        tokens: [validInvitationToken()],
      });

      const error = await caught(
        fakes.invitation.start({ ...START_INPUT, nickname }, INVITATION_META),
      );

      expect(error.code).toBe('validation_error');
      expect(error.details).toEqual([
        expect.objectContaining({ field: 'nickname', code }),
      ]);
      expect(fakes.state.pwnedChecks).toEqual([]);
      expect(fakes.state.pendingProfiles).toEqual([]);
    },
  );

  test('25書記素のニックネームは受け付ける', async () => {
    const fakes = setupAdminInvitation({
      admins: [invitedAdmin()],
      tokens: [validInvitationToken()],
    });

    await fakes.invitation.start(
      { ...START_INPUT, nickname: 'あ'.repeat(25) },
      INVITATION_META,
    );

    expect(fakes.state.pendingProfiles[0]?.nickname).toBe('あ'.repeat(25));
  });

  test.each([
    [
      'ニックネーム',
      { nickname: 'Night Owl Admin', password: NICKNAME_LIKE_PASSWORD },
    ],
    ['メールアドレス全体', { password: INVITED_EMAIL.toUpperCase() }],
    ['@より前の部分', { password: LOCAL_PART_LIKE_PASSWORD }],
  ] as const)(
    '大文字小文字を区別せずに%sと同じパスワードは、管理者用の文言で拒否して漏洩照合も保存もしない',
    async (_label, input) => {
      const fakes = setupAdminInvitation({
        admins: [invitedAdmin()],
        tokens: [validInvitationToken()],
      });

      const error = await caught(
        fakes.invitation.start({ ...START_INPUT, ...input }, INVITATION_META),
      );

      expect(error).toMatchObject({
        kind: 'unprocessable',
        code: 'password_rejected',
        message: ADMIN_MATCHES_IDENTITY_MESSAGE,
      });
      expect(error.details).toEqual([
        {
          field: 'password',
          code: 'matches_identity',
          message: ADMIN_MATCHES_IDENTITY_MESSAGE,
        },
      ]);
      expect(fakes.state.pwnedChecks).toEqual([]);
      expect(fakes.state.pendingProfiles).toEqual([]);
    },
  );

  test('8文字未満のパスワードは長さの違反で拒否する', async () => {
    const fakes = setupAdminInvitation({
      admins: [invitedAdmin()],
      tokens: [validInvitationToken()],
    });

    const error = await caught(
      fakes.invitation.start(
        { ...START_INPUT, password: SHORT_PASSWORD },
        INVITATION_META,
      ),
    );

    expect(error.code).toBe('password_rejected');
    expect(error.details?.[0]?.code).toBe('too_short');
  });

  test('漏洩済みと判明したパスワードは拒否して保存しない', async () => {
    const fakes = setupAdminInvitation({
      admins: [invitedAdmin()],
      tokens: [validInvitationToken()],
      pwnedResult: { kind: 'pwned' },
    });

    const error = await caught(
      fakes.invitation.start(START_INPUT, INVITATION_META),
    );

    expect(error.code).toBe('password_rejected');
    expect(error.details?.[0]?.code).toBe('pwned');
    expect(fakes.state.pendingProfiles).toEqual([]);
  });

  test('漏洩照合ができなくてもパスワードを受け付け、運用者が検知できるよう記録する', async () => {
    const fakes = setupAdminInvitation({
      admins: [invitedAdmin()],
      tokens: [validInvitationToken()],
      pwnedResult: { kind: 'unavailable', reason: 'timeout' },
    });

    await fakes.invitation.start(START_INPUT, INVITATION_META);

    expect(fakes.state.incidents).toEqual([
      { kind: 'pwned-password-check-unavailable', reason: 'timeout' },
    ]);
    expect(fakes.state.pendingProfiles).toHaveLength(1);
  });
});

describe('StoreAdminInvitation.complete', () => {
  test('正しい認証コードでは、トークンを消費し、有効化・TOTPの確定・リカバリコード10個・セッションを1つの書き込みで保存して、平文のコードとセッションを返す', async () => {
    const fakes = setupStarted();

    const result = await fakes.invitation.complete(
      { token: INVITATION_TOKEN, totpCode: ` ${VALID_CODE} ` },
      INVITATION_META,
    );

    expect(fakes.state.tokens[0]?.consumed).toBe(true);
    expect(fakes.state.activations).toHaveLength(1);
    const activation = fakes.state.activations[0]?.activation;
    expect(fakes.state.activations[0]?.adminId).toBe(INVITED_ID);
    expect(activation).toMatchObject({
      at: INVITATION_NOW,
      step: VALID_STEP,
      pendingSealedSecret: SEALED_PENDING,
    });
    expect(result.recoveryCodes).toHaveLength(10);
    expect(new Set(result.recoveryCodes).size).toBe(10);
    const expectedHashes = await Promise.all(
      result.recoveryCodes.map((code) =>
        fakes.keyedHasher.hash(
          ADMIN_HASH_PURPOSES.recoveryCode,
          normalizeRecoveryCodeInput(code) ?? '',
        ),
      ),
    );
    expect(activation?.recoveryHashes).toEqual(expectedHashes);
    const times = newSessionTimes(INVITATION_NOW, ADMIN_SESSION_POLICY);
    expect(activation?.session).toEqual({
      id: result.session.sessionId,
      adminId: INVITED_ID,
      tokenHash: hashedOf('admin-session', result.session.token),
      userAgent: 'Mozilla/5.0',
      ...times,
    });
    expect(result.session.maxAgeSeconds).toBeGreaterThan(0);
    expect(fakes.state.admins.get(INVITED_ID)?.status).toBe('active');
    expect(fakes.state.calls.indexOf('tokens.consume')).toBeLessThan(
      fakes.state.calls.indexOf('admins.activate'),
    );
  });

  test('照合する秘密鍵は管理者の文脈で開いた保留のものを使う', async () => {
    const fakes = setupStarted({
      totp: {
        ...PENDING_TOTP,
        pendingSealedSecret: sealedOf(GENERATED_TOTP_SECRET, INVITED_ID),
      },
    });

    const failure = fakes.invitation.complete(
      { token: INVITATION_TOKEN, totpCode: VALID_CODE },
      INVITATION_META,
    );

    const rejection = await failure.then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(rejection).toEqual(new Error('文脈が一致しない'));
    expect(fakes.state.admins.get(INVITED_ID)?.status).toBe('invited');
  });

  test.each([
    [
      '存在しないトークン',
      { tokens: [validInvitationToken({ tokenHash: 'other' })] },
    ],
    [
      '期限切れのトークン',
      { tokens: [validInvitationToken({ expiresAt: INVITATION_NOW })] },
    ],
    ['既に有効な管理者のトークン', { admins: [activeAdmin()] }],
  ] as const)(
    '%sは、再送の依頼を添えたリンクの無効として何も変えない',
    async (_label, overrides) => {
      const fakes = setupStarted(overrides);

      const error = await caught(
        fakes.invitation.complete(
          { token: INVITATION_TOKEN, totpCode: VALID_CODE },
          INVITATION_META,
        ),
      );

      expect(errorShape(error)).toEqual(INVITATION_LINK_INVALID);
      expect(fakes.state.calls).not.toContain('tokens.consume');
      expect(fakes.state.activations).toEqual([]);
    },
  );

  test.each([
    ['TOTPの設定を始めていない', undefined],
    [
      '設定の開始から10分が経った',
      { ...PENDING_TOTP, pendingExpiresAt: INVITATION_NOW },
    ],
    ['保留の秘密鍵が無い', { ...PENDING_TOTP, pendingSealedSecret: null }],
  ] as const)(
    '%s場合は設定のやり直しを求め、トークンを消費せず招待中のままにする',
    async (_label, totp) => {
      const fakes = setupAdminInvitation({
        admins: [PROFILED_INVITED],
        tokens: [validInvitationToken()],
        ...(totp === undefined ? {} : { totp }),
      });

      const error = await caught(
        fakes.invitation.complete(
          { token: INVITATION_TOKEN, totpCode: VALID_CODE },
          INVITATION_META,
        ),
      );

      expect(errorShape(error)).toEqual(TOTP_SETUP_EXPIRED);
      expect(fakes.state.tokens[0]?.consumed).toBe(false);
      expect(fakes.state.admins.get(INVITED_ID)?.status).toBe('invited');
    },
  );

  test.each([
    ['誤った', '000000', true],
    ['数字でない', 'abcdef', false],
  ] as const)(
    '%s認証コードは拒否し、トークンを消費せず招待中のままにする',
    async (_label, totpCode, verified) => {
      const fakes = setupStarted();

      const error = await caught(
        fakes.invitation.complete(
          { token: INVITATION_TOKEN, totpCode },
          INVITATION_META,
        ),
      );

      expect(errorShape(error)).toEqual(INVALID_SECOND_FACTOR);
      expect(fakes.state.calls.includes('totp.verify')).toBe(verified);
      expect(fakes.state.tokens[0]?.consumed).toBe(false);
      expect(fakes.state.admins.get(INVITED_ID)?.status).toBe('invited');
    },
  );

  test('照合の後に同じトークンの消費に負けると、リンクの無効として有効化しない', async () => {
    const fakes = setupStarted({ consumeLoses: true });

    const error = await caught(
      fakes.invitation.complete(
        { token: INVITATION_TOKEN, totpCode: VALID_CODE },
        INVITATION_META,
      ),
    );

    expect(errorShape(error)).toEqual(INVITATION_LINK_INVALID);
    expect(fakes.state.calls).not.toContain('admins.activate');
  });

  test('有効化の条件を満たさず取り消されると、リンクの無効としてリカバリコードもセッションも返さない', async () => {
    const fakes = setupStarted({ activateResult: 'not-invited' });

    const error = await caught(
      fakes.invitation.complete(
        { token: INVITATION_TOKEN, totpCode: VALID_CODE },
        INVITATION_META,
      ),
    );

    expect(errorShape(error)).toEqual(INVITATION_LINK_INVALID);
    expect(fakes.state.admins.get(INVITED_ID)?.status).toBe('invited');
  });

  test('1段目と2段目を続けて行うと、2段目の完了までは招待中のままで、完了で有効になる', async () => {
    const fakes = setupAdminInvitation({
      admins: [invitedAdmin()],
      tokens: [validInvitationToken()],
    });

    await fakes.invitation.start(START_INPUT, INVITATION_META);
    const afterStart = fakes.state.admins.get(INVITED_ID);
    await fakes.invitation.complete(
      { token: INVITATION_TOKEN, totpCode: VALID_CODE },
      INVITATION_META,
    );

    expect(afterStart?.status).toBe('invited');
    expect(fakes.state.admins.get(INVITED_ID)).toMatchObject({
      status: 'active',
      nickname: '新しい管理者',
      title: null,
      avatarFileId: null,
    });
  });
});
