import { inject, injectable } from 'inversify';

import { ADMIN_HASH_PURPOSES } from '../../domain/admin/admin-auth-token-purpose.ts';
import { normalizeTotpCode } from '../../domain/auth/second-factor.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { SecretBox, TotpAuthenticator } from '../auth/ports.ts';
import type { RecoveryCodeIssuer } from '../auth/recovery-code-issuer.ts';
import type { CurrentAdmin } from './admin-authorizer.ts';
import { adminError } from './admin-errors.ts';
import {
  ADMIN_TOTP_SETUP_TTL_SECONDS,
  adminTotpAccountLabelOf,
} from './admin-invitation.ts';
import { requireOperatorRecord } from './admin-operator-record.ts';
import type {
  AdminReAuthenticationInput,
  AdminReAuthenticator,
} from './admin-re-authenticator.ts';
import { adminTotpSecretContext } from './admin-second-factor-check.ts';
import type { AdminSessionIssuer } from './admin-session-issuer.ts';
import { ADMIN_TYPES } from './admin-types.ts';
import type {
  AdminAccountStore,
  AdminRecoveryCodeStore,
  AdminRequestMeta,
  AdminSettings,
  AdminTotpCredential,
  AdminTotpCredentialStore,
  AdminTotpSetupView,
  IssuedAdminSession,
} from './ports.ts';

export interface IssuedAdminRecoveryCodes {
  // 平文はこの応答でだけ見せる
  readonly recoveryCodes: readonly string[];
  readonly session: IssuedAdminSession;
}

// 有効な管理者は必ず多要素認証を使うため、無効にする操作を持たない
export interface AdminTotpManagement {
  // 本人確認の失敗はAppError(unprocessable, reauthentication_failed)を投げる。現在の設定は完了まで有効なまま残す
  startReset(
    current: CurrentAdmin,
    reAuthentication: AdminReAuthenticationInput,
    meta: AdminRequestMeta,
  ): Promise<AdminTotpSetupView>;
  // 保留が無い・期限切れはAppError(unprocessable, totp_setup_expired)、誤りはAppError(unauthenticated, invalid_second_factor)を投げる
  completeReset(
    current: CurrentAdmin,
    code: string,
    meta: AdminRequestMeta,
  ): Promise<IssuedAdminRecoveryCodes>;
  regenerateRecoveryCodes(
    current: CurrentAdmin,
    reAuthentication: AdminReAuthenticationInput,
    meta: AdminRequestMeta,
  ): Promise<IssuedAdminRecoveryCodes>;
}

const MS_PER_SECOND = 1000;

interface ValidPendingTotp extends AdminTotpCredential {
  readonly pendingSealedSecret: string;
}

// 期限ちょうどを期限切れとする
const isValidPendingOfEnabled = (
  credential: AdminTotpCredential | undefined,
  now: Date,
): credential is ValidPendingTotp =>
  credential !== undefined &&
  credential.enabledAt !== null &&
  credential.pendingSealedSecret !== null &&
  credential.pendingExpiresAt !== null &&
  credential.pendingExpiresAt.getTime() > now.getTime();

@injectable()
export class StoreAdminTotpManagement implements AdminTotpManagement {
  constructor(
    @inject(ADMIN_TYPES.AdminReAuthenticator)
    private readonly reAuthenticator: AdminReAuthenticator,
    @inject(ADMIN_TYPES.AdminAccountStore)
    private readonly admins: AdminAccountStore,
    @inject(ADMIN_TYPES.AdminTotpCredentialStore)
    private readonly totpCredentials: AdminTotpCredentialStore,
    @inject(ADMIN_TYPES.AdminRecoveryCodeStore)
    private readonly recoveryCodes: AdminRecoveryCodeStore,
    @inject(ADMIN_TYPES.AdminSessionIssuer)
    private readonly sessionIssuer: AdminSessionIssuer,
    @inject(ADMIN_TYPES.AdminSettings)
    private readonly settings: AdminSettings,
    @inject(AUTH_TYPES.TotpAuthenticator)
    private readonly totp: TotpAuthenticator,
    @inject(AUTH_TYPES.SecretBox)
    private readonly secretBox: SecretBox,
    @inject(AUTH_TYPES.RecoveryCodeIssuer)
    private readonly recoveryCodeIssuer: RecoveryCodeIssuer,
  ) {}

  async startReset(
    current: CurrentAdmin,
    reAuthentication: AdminReAuthenticationInput,
    meta: AdminRequestMeta,
  ): Promise<AdminTotpSetupView> {
    const admin = await requireOperatorRecord(this.admins, current);
    await this.reAuthenticator.verify(admin, reAuthentication, meta);
    const secret = this.totp.generateSecret();
    const sealedSecret = await this.secretBox.seal(
      secret,
      adminTotpSecretContext(admin.id),
    );
    const expiresAt = new Date(
      meta.now.getTime() + ADMIN_TOTP_SETUP_TTL_SECONDS * MS_PER_SECOND,
    );
    await this.totpCredentials.savePending(admin.id, sealedSecret, expiresAt);
    return {
      otpauthUri: this.totp.buildUri(
        secret,
        this.settings.totpIssuer,
        adminTotpAccountLabelOf(admin.nickname),
      ),
      secret,
      expiresAt,
    };
  }

  async completeReset(
    current: CurrentAdmin,
    code: string,
    meta: AdminRequestMeta,
  ): Promise<IssuedAdminRecoveryCodes> {
    const admin = await requireOperatorRecord(this.admins, current);
    const credential = await this.totpCredentials.find(admin.id);
    if (!isValidPendingOfEnabled(credential, meta.now)) {
      throw adminError('totp_setup_expired');
    }
    const step = await this.#verifyPendingCode(
      admin.id,
      credential.pendingSealedSecret,
      code,
      meta.now,
    );
    const issued = await this.recoveryCodeIssuer.issue(
      ADMIN_HASH_PURPOSES.recoveryCode,
    );
    // 照合と入れ替えの間に再設定が始め直されても、運営者の認証アプリに無い秘密鍵へ入れ替えない
    const committed = await this.totpCredentials.commitPendingRevokingSessions(
      admin.id,
      {
        pendingSealedSecret: credential.pendingSealedSecret,
        step,
        at: meta.now,
        recoveryHashes: issued.hashes,
      },
    );
    if (committed === 'not-pending') {
      throw adminError('totp_setup_expired');
    }
    return {
      recoveryCodes: issued.plains,
      session: await this.#reissueSession(admin.id, meta),
    };
  }

  async regenerateRecoveryCodes(
    current: CurrentAdmin,
    reAuthentication: AdminReAuthenticationInput,
    meta: AdminRequestMeta,
  ): Promise<IssuedAdminRecoveryCodes> {
    const admin = await requireOperatorRecord(this.admins, current);
    await this.reAuthenticator.verify(admin, reAuthentication, meta);
    const issued = await this.recoveryCodeIssuer.issue(
      ADMIN_HASH_PURPOSES.recoveryCode,
    );
    const replaced = await this.recoveryCodes.replaceAllRevokingSessions(
      admin.id,
      issued.hashes,
    );
    // 有効な管理者の多要素認証は無効にできず、設定が無いのは本人確認の間に管理者が削除された時だけのため、使えない平文を返さずに未ログインとする
    if (replaced === 'not-enabled') {
      throw adminError('unauthenticated');
    }
    return {
      recoveryCodes: issued.plains,
      session: await this.#reissueSession(admin.id, meta),
    };
  }

  async #verifyPendingCode(
    adminId: string,
    pendingSealedSecret: string,
    code: string,
    now: Date,
  ): Promise<number> {
    const normalized = normalizeTotpCode(code);
    if (normalized === undefined) {
      throw adminError('invalid_second_factor');
    }
    const secret = await this.secretBox.open(
      pendingSealedSecret,
      adminTotpSecretContext(adminId),
    );
    const verification = this.totp.verify(secret, normalized, now);
    if (!verification.ok) {
      throw adminError('invalid_second_factor');
    }
    return verification.step;
  }

  // 全セッションは設定の書き込みと同じ一括の書き込みで消えている。操作した端末は認証済みの同じ管理者のため、再発行の条件を確かめずに発行する
  #reissueSession(
    adminId: string,
    meta: AdminRequestMeta,
  ): Promise<IssuedAdminSession> {
    return this.sessionIssuer.issue(adminId, meta);
  }
}
