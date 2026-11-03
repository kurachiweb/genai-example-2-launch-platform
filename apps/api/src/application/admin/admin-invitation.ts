import { inject, injectable } from 'inversify';

import { checkAdminNickname } from '../../../common-lib/admin/admin-input-rules.ts';
import { ADMIN_ACCOUNT_INVITE_ACTION } from '../../../common-lib/admin/audit-actions/admin-foundation.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import {
  type AdminSnapshot,
  checkInvitable,
} from '../../domain/admin/admin-account.ts';
import {
  ADMIN_AUTH_TOKEN_TTL_SECONDS,
  ADMIN_HASH_PURPOSES,
} from '../../domain/admin/admin-auth-token-purpose.ts';
import { normalizeTotpCode } from '../../domain/auth/second-factor.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { PasswordPolicy } from '../auth/password-policy.ts';
import type {
  PasswordHasher,
  SecretBox,
  TotpAuthenticator,
} from '../auth/ports.ts';
import type { RecoveryCodeIssuer } from '../auth/recovery-code-issuer.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import type { CurrentAdmin } from './admin-authorizer.ts';
import {
  adminError,
  adminInvitationLinkError,
  adminNicknameRejectedError,
  adminPasswordRejectedError,
} from './admin-errors.ts';
import { adminTotpSecretContext } from './admin-second-factor-check.ts';
import { prepareAdminSession } from './admin-session-issuer.ts';
import { ADMIN_TYPES } from './admin-types.ts';
import type {
  AuditLogRecorder,
  PreparedAuditEntry,
} from './audit-log-recorder.ts';
import type {
  AdminAccountStore,
  AdminAuthTokenStore,
  AdminMailer,
  AdminRecord,
  AdminRequestMeta,
  AdminSettings,
  AdminTotpCredential,
  AdminTotpCredentialStore,
  AdminTotpSetupView,
  IssuedAdminSession,
  NewAdminInvitationToken,
} from './ports.ts';

export interface AdminInvitationStartInput {
  readonly token: string;
  readonly nickname: string;
  readonly password: string;
}

export interface AdminInvitationCompleteInput {
  readonly token: string;
  readonly totpCode: string;
}

export interface AdminInvitationCompletion {
  // 平文はこの応答でだけ見せる
  readonly recoveryCodes: readonly string[];
  readonly session: IssuedAdminSession;
}

// 無効・期限切れ・使用済みの招待のトークンと有効な管理者のトークンは、区別せずにリンクの無効にする
export interface AdminInvitation {
  invite(
    current: CurrentAdmin,
    input: { readonly email: string; readonly reason?: string },
    meta: AdminRequestMeta,
  ): Promise<void>;
  resend(
    current: CurrentAdmin,
    input: { readonly adminId: string; readonly reason?: string },
    meta: AdminRequestMeta,
  ): Promise<void>;
  // トークンを消費せずに仮の保存とTOTPの保留を行い、管理者は完了まで招待中のままにする
  start(
    input: AdminInvitationStartInput,
    meta: AdminRequestMeta,
  ): Promise<AdminTotpSetupView>;
  complete(
    input: AdminInvitationCompleteInput,
    meta: AdminRequestMeta,
  ): Promise<AdminInvitationCompletion>;
}

export const ADMIN_TOTP_SETUP_TTL_SECONDS = 600;

const MS_PER_SECOND = 1000;

const TOTP_ACCOUNT_LABEL_PREFIX = '管理者';

const INVITATION_HASH_PURPOSE = ADMIN_HASH_PURPOSES.authToken('invitation');

interface IssuedInvitationToken {
  readonly plain: string;
  readonly token: NewAdminInvitationToken;
}

interface ValidPendingTotp extends AdminTotpCredential {
  readonly pendingSealedSecret: string;
}

// 操作者は認可で有効と確かめた管理者のため、可否の判定に使うロール以外は有効の状態として組み立てる
const operatorSnapshot = (current: CurrentAdmin): AdminSnapshot => ({
  id: current.id,
  role: current.role,
  status: 'active',
  invitationExpiresAt: null,
});

// 認証アプリのラベルはメールアドレスを締め出すため@を拒むので、@を含むニックネームはラベルに出さない
export const adminTotpAccountLabelOf = (nickname: string | null): string =>
  nickname === null || nickname.includes('@')
    ? TOTP_ACCOUNT_LABEL_PREFIX
    : `${TOTP_ACCOUNT_LABEL_PREFIX}:${nickname}`;

// 期限ちょうどを期限切れとする
const isValidPending = (
  credential: AdminTotpCredential | undefined,
  now: Date,
): credential is ValidPendingTotp =>
  credential !== undefined &&
  credential.pendingSealedSecret !== null &&
  credential.pendingExpiresAt !== null &&
  credential.pendingExpiresAt.getTime() > now.getTime();

@injectable()
export class StoreAdminInvitation implements AdminInvitation {
  constructor(
    @inject(ADMIN_TYPES.AdminAccountStore)
    private readonly admins: AdminAccountStore,
    @inject(ADMIN_TYPES.AdminAuthTokenStore)
    private readonly tokens: AdminAuthTokenStore,
    @inject(ADMIN_TYPES.AdminTotpCredentialStore)
    private readonly totpCredentials: AdminTotpCredentialStore,
    @inject(ADMIN_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(ADMIN_TYPES.AdminMailer)
    private readonly mailer: AdminMailer,
    @inject(ADMIN_TYPES.AdminSettings)
    private readonly settings: AdminSettings,
    @inject(AUTH_TYPES.SecretIssuer)
    private readonly secrets: SecretIssuer,
    @inject(PLATFORM_TYPES.IdGenerator)
    private readonly ids: IdGenerator,
    @inject(AUTH_TYPES.PasswordPolicy)
    private readonly passwordPolicy: PasswordPolicy,
    @inject(AUTH_TYPES.PasswordHasher)
    private readonly passwordHasher: PasswordHasher,
    @inject(AUTH_TYPES.TotpAuthenticator)
    private readonly totp: TotpAuthenticator,
    @inject(AUTH_TYPES.SecretBox)
    private readonly secretBox: SecretBox,
    @inject(AUTH_TYPES.RecoveryCodeIssuer)
    private readonly recoveryCodeIssuer: RecoveryCodeIssuer,
  ) {}

  async invite(
    current: CurrentAdmin,
    input: { readonly email: string; readonly reason?: string },
    meta: AdminRequestMeta,
  ): Promise<void> {
    this.#assertInvitable(current);
    const email = trimWhiteSpace(input.email);
    const adminId = this.ids.generate();
    const audit = this.#prepareAudit(current, adminId, input.reason, meta);
    const issued = await this.#issueToken(meta);
    const created = await this.admins.insertInvited(
      { id: adminId, email, invitedAt: meta.now },
      issued.token,
      audit,
    );
    if (created === 'email-in-use') {
      throw adminError('admin_email_in_use');
    }
    await this.mailer.sendInvitation(
      email,
      issued.plain,
      issued.token.expiresAt,
    );
  }

  async resend(
    current: CurrentAdmin,
    input: { readonly adminId: string; readonly reason?: string },
    meta: AdminRequestMeta,
  ): Promise<void> {
    this.#assertInvitable(current);
    const target = await this.admins.findById(input.adminId);
    if (target?.status !== 'invited') {
      throw adminError('not_found');
    }
    const audit = this.#prepareAudit(current, target.id, input.reason, meta);
    const issued = await this.#issueToken(meta);
    const reissued = await this.admins.reissueInvitation(
      target.id,
      issued.token,
      audit,
    );
    if (reissued === 'not-invited') {
      throw adminError('not_found');
    }
    await this.mailer.sendInvitation(
      target.email,
      issued.plain,
      issued.token.expiresAt,
    );
  }

  async start(
    input: AdminInvitationStartInput,
    meta: AdminRequestMeta,
  ): Promise<AdminTotpSetupView> {
    const { admin } = await this.#findInvitation(input.token, meta);
    const nicknameViolation = checkAdminNickname(input.nickname);
    if (nicknameViolation !== undefined) {
      throw adminNicknameRejectedError(nicknameViolation);
    }
    const nickname = trimWhiteSpace(input.nickname);
    const validation = await this.passwordPolicy.validateNewPassword(
      input.password,
      { nickname, email: admin.email },
    );
    if (!validation.ok) {
      throw adminPasswordRejectedError(validation.violation);
    }
    const passwordHash = await this.passwordHasher.hash(input.password);
    await this.admins.savePendingProfile(admin.id, { nickname, passwordHash });
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
        adminTotpAccountLabelOf(nickname),
      ),
      secret,
      expiresAt,
    };
  }

  async complete(
    input: AdminInvitationCompleteInput,
    meta: AdminRequestMeta,
  ): Promise<AdminInvitationCompletion> {
    const { admin, tokenHash } = await this.#findInvitation(input.token, meta);
    const credential = await this.totpCredentials.find(admin.id);
    if (!isValidPending(credential, meta.now)) {
      throw adminError('totp_setup_expired');
    }
    const step = await this.#verifyPendingCode(
      admin.id,
      credential.pendingSealedSecret,
      input.totpCode,
      meta.now,
    );
    const consumed = await this.tokens.consume(
      'invitation',
      tokenHash,
      meta.now,
    );
    if (consumed?.adminId !== admin.id) {
      throw adminInvitationLinkError();
    }
    const [recoveryCodes, session] = await Promise.all([
      this.recoveryCodeIssuer.issue(ADMIN_HASH_PURPOSES.recoveryCode),
      prepareAdminSession(this.secrets, this.ids, admin.id, meta),
    ]);
    // 照合と有効化の間に設定が始め直されても、運営者の認証アプリに無い秘密鍵を有効にしない
    const activated = await this.admins.activate(admin.id, {
      at: meta.now,
      step,
      pendingSealedSecret: credential.pendingSealedSecret,
      recoveryHashes: recoveryCodes.hashes,
      session: session.record,
    });
    // トークンは消費済みのため、同じリンクでやり直せず再送が要る
    if (activated === 'not-invited') {
      throw adminInvitationLinkError();
    }
    return { recoveryCodes: recoveryCodes.plains, session: session.issued };
  }

  #assertInvitable(current: CurrentAdmin): void {
    if (checkInvitable(operatorSnapshot(current)) !== undefined) {
      throw adminError('forbidden');
    }
  }

  #prepareAudit(
    current: CurrentAdmin,
    targetAdminId: string,
    reason: string | undefined,
    meta: AdminRequestMeta,
  ): PreparedAuditEntry {
    return this.auditLog.prepare({
      operatorAdminId: current.id,
      action: ADMIN_ACCOUNT_INVITE_ACTION.name,
      targetIds: [targetAdminId],
      ...(reason === undefined ? {} : { reason }),
      occurredAt: meta.now,
    });
  }

  async #issueToken(meta: AdminRequestMeta): Promise<IssuedInvitationToken> {
    const secret = await this.secrets.issue(INVITATION_HASH_PURPOSE);
    return {
      plain: secret.plain,
      token: {
        tokenHash: secret.hash,
        expiresAt: new Date(
          meta.now.getTime() +
            ADMIN_AUTH_TOKEN_TTL_SECONDS.invitation * MS_PER_SECOND,
        ),
      },
    };
  }

  async #findInvitation(
    token: string,
    meta: AdminRequestMeta,
  ): Promise<{ readonly admin: AdminRecord; readonly tokenHash: string }> {
    const tokenHash = await this.secrets.hashOf(INVITATION_HASH_PURPOSE, token);
    const found = await this.tokens.findValid(
      'invitation',
      tokenHash,
      meta.now,
    );
    if (found === undefined) {
      throw adminInvitationLinkError();
    }
    const admin = await this.admins.findById(found.adminId);
    if (admin?.status !== 'invited') {
      throw adminInvitationLinkError();
    }
    return { admin, tokenHash };
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
}
