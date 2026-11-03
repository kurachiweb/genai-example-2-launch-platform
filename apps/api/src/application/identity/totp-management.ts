import { inject, injectable } from 'inversify';

import { normalizeTotpCode } from '../../domain/auth/second-factor.ts';
import { checkAccountWritable } from '../../domain/identity/user-account.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { SecretBox, TotpAuthenticator } from '../auth/ports.ts';
import type { RecoveryCodeIssuer } from '../auth/recovery-code-issuer.ts';
import type { CurrentUser } from './account-guard.ts';
import { identityError } from './identity-errors.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import type {
  IdentitySettings,
  RecoveryCodeStore,
  TotpCredential,
  TotpCredentialStore,
  UserRecord,
} from './ports.ts';
import type {
  ReAuthenticationInput,
  ReAuthenticator,
} from './re-authenticator.ts';
import type { RequestMeta } from './request-meta.ts';
import {
  isTotpEnabled,
  USER_RECOVERY_CODE_HASH_PURPOSE,
} from './second-factor-check.ts';
import type { IssuedSession, SessionIssuer } from './session-issuer.ts';

export interface TotpSetupView {
  readonly otpauthUri: string;
  // 認証アプリへ手入力するためのbase32
  readonly secret: string;
  readonly expiresAt: Date;
}

export interface IssuedRecoveryCodesResult {
  // 平文はこの応答でだけ見せる
  readonly recoveryCodes: readonly string[];
  readonly session: IssuedSession;
}

// 本人確認は停止・退会を見ないため、各操作が停止中・退会済みを拒否する。開始と有効化は未確認も拒否する
export interface TotpManagement {
  start(
    current: CurrentUser,
    reAuthentication: ReAuthenticationInput,
    meta: RequestMeta,
  ): Promise<TotpSetupView>;
  enable(
    current: CurrentUser,
    code: string,
    meta: RequestMeta,
  ): Promise<IssuedRecoveryCodesResult>;
  disable(
    current: CurrentUser,
    reAuthentication: ReAuthenticationInput,
    meta: RequestMeta,
  ): Promise<{ readonly session: IssuedSession }>;
  regenerateRecoveryCodes(
    current: CurrentUser,
    reAuthentication: ReAuthenticationInput,
    meta: RequestMeta,
  ): Promise<IssuedRecoveryCodesResult>;
}

export const TOTP_SETUP_TTL_SECONDS = 600;

const MS_PER_SECOND = 1000;

function assertWritable(user: UserRecord, requireVerifiedEmail: boolean): void {
  const denial = checkAccountWritable(user, { requireVerifiedEmail });
  if (denial === 'email-not-verified') {
    throw identityError('email_not_verified');
  }
  if (denial !== undefined) {
    throw identityError('account_unavailable');
  }
}

// 期限ちょうどを期限切れとする
const isValidPending = (
  credential: TotpCredential | undefined,
  now: Date,
): credential is TotpCredential =>
  credential !== undefined &&
  credential.enabledAt === null &&
  credential.pendingExpiresAt !== null &&
  credential.pendingExpiresAt.getTime() > now.getTime();

// 認証アプリに表示されるラベルへメールアドレスを出さないよう、ハンドルを使う
const accountLabelOf = (user: UserRecord): string => `@${user.handle}`;

@injectable()
export class StoreTotpManagement implements TotpManagement {
  constructor(
    @inject(IDENTITY_TYPES.ReAuthenticator)
    private readonly reAuthenticator: ReAuthenticator,
    @inject(IDENTITY_TYPES.TotpCredentialStore)
    private readonly totpCredentials: TotpCredentialStore,
    @inject(IDENTITY_TYPES.RecoveryCodeStore)
    private readonly recoveryCodes: RecoveryCodeStore,
    @inject(IDENTITY_TYPES.SessionIssuer)
    private readonly sessionIssuer: SessionIssuer,
    @inject(IDENTITY_TYPES.IdentitySettings)
    private readonly settings: IdentitySettings,
    @inject(AUTH_TYPES.TotpAuthenticator)
    private readonly totp: TotpAuthenticator,
    @inject(AUTH_TYPES.SecretBox)
    private readonly secretBox: SecretBox,
    @inject(AUTH_TYPES.RecoveryCodeIssuer)
    private readonly recoveryCodeIssuer: RecoveryCodeIssuer,
  ) {}

  async start(
    current: CurrentUser,
    reAuthentication: ReAuthenticationInput,
    meta: RequestMeta,
  ): Promise<TotpSetupView> {
    const { user } = current;
    assertWritable(user, true);
    if (isTotpEnabled(await this.totpCredentials.find(user.id))) {
      throw identityError('totp_already_enabled');
    }
    await this.reAuthenticator.verify(user, reAuthentication, meta);
    const secret = this.totp.generateSecret();
    const sealedSecret = await this.secretBox.seal(secret, user.id);
    const expiresAt = new Date(
      meta.now.getTime() + TOTP_SETUP_TTL_SECONDS * MS_PER_SECOND,
    );
    const saved = await this.totpCredentials.savePending(
      user.id,
      sealedSecret,
      expiresAt,
    );
    if (saved === 'already-enabled') {
      throw identityError('totp_already_enabled');
    }
    return {
      otpauthUri: this.totp.buildUri(
        secret,
        this.settings.totpIssuer,
        accountLabelOf(user),
      ),
      secret,
      expiresAt,
    };
  }

  async enable(
    current: CurrentUser,
    code: string,
    meta: RequestMeta,
  ): Promise<IssuedRecoveryCodesResult> {
    const { user } = current;
    assertWritable(user, true);
    const credential = await this.totpCredentials.find(user.id);
    if (isTotpEnabled(credential)) {
      throw identityError('totp_already_enabled');
    }
    if (!isValidPending(credential, meta.now)) {
      throw identityError('totp_setup_expired');
    }
    const normalized = normalizeTotpCode(code);
    if (normalized === undefined) {
      throw identityError('invalid_second_factor');
    }
    const secret = await this.secretBox.open(credential.sealedSecret, user.id);
    const verification = this.totp.verify(secret, normalized, meta.now);
    if (!verification.ok) {
      throw identityError('invalid_second_factor');
    }
    const issued = await this.recoveryCodeIssuer.issue(
      USER_RECOVERY_CODE_HASH_PURPOSE,
    );
    // 照合と有効化の間に設定が始め直されても、利用者の認証アプリに無い秘密鍵を有効にしない
    const enabled = await this.totpCredentials.enableRevokingSessions(
      user.id,
      credential.sealedSecret,
      verification.step,
      meta.now,
      issued.hashes,
    );
    if (enabled === 'not-pending') {
      throw identityError('totp_setup_expired');
    }
    return {
      recoveryCodes: issued.plains,
      session: await this.#reissueSession(user.id, meta),
    };
  }

  async disable(
    current: CurrentUser,
    reAuthentication: ReAuthenticationInput,
    meta: RequestMeta,
  ): Promise<{ readonly session: IssuedSession }> {
    const { user } = current;
    await this.#verifyEnabled(user, reAuthentication, meta);
    const disabled = await this.totpCredentials.disableRevokingSessions(
      user.id,
    );
    if (disabled === 'not-enabled') {
      throw identityError('totp_not_enabled');
    }
    return { session: await this.#reissueSession(user.id, meta) };
  }

  async regenerateRecoveryCodes(
    current: CurrentUser,
    reAuthentication: ReAuthenticationInput,
    meta: RequestMeta,
  ): Promise<IssuedRecoveryCodesResult> {
    const { user } = current;
    await this.#verifyEnabled(user, reAuthentication, meta);
    const issued = await this.recoveryCodeIssuer.issue(
      USER_RECOVERY_CODE_HASH_PURPOSE,
    );
    const replaced = await this.recoveryCodes.replaceAllRevokingSessions(
      user.id,
      issued.hashes,
    );
    // 本人確認の間に無効化されると何も保存されないため、使えない平文を返さない
    if (replaced === 'not-enabled') {
      throw identityError('totp_not_enabled');
    }
    return {
      recoveryCodes: issued.plains,
      session: await this.#reissueSession(user.id, meta),
    };
  }

  async #verifyEnabled(
    user: UserRecord,
    reAuthentication: ReAuthenticationInput,
    meta: RequestMeta,
  ): Promise<void> {
    assertWritable(user, false);
    if (!isTotpEnabled(await this.totpCredentials.find(user.id))) {
      throw identityError('totp_not_enabled');
    }
    await this.reAuthenticator.verify(user, reAuthentication, meta);
  }

  // 全セッションは設定の書き込みと同じ一括の書き込みで消えている。操作した端末は認証済みの同じ利用者のため、再発行の条件を確かめずに発行する
  #reissueSession(userId: string, meta: RequestMeta): Promise<IssuedSession> {
    return this.sessionIssuer.issue(userId, meta);
  }
}
