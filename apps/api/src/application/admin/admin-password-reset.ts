import { inject, injectable } from 'inversify';

import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { ADMIN_HASH_PURPOSES } from '../../domain/admin/admin-auth-token-purpose.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { PasswordPolicy } from '../auth/password-policy.ts';
import type { PasswordHasher } from '../auth/ports.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import { prepareAdminAuthToken } from './admin-auth-token-issuance.ts';
import { adminError, adminPasswordRejectedError } from './admin-errors.ts';
import { ADMIN_TYPES } from './admin-types.ts';
import type {
  AdminAccountStore,
  AdminAuthTokenStore,
  AdminMailer,
  AdminMailSendLimits,
  AdminRecord,
  AdminRequestMeta,
} from './ports.ts';

export interface CompleteAdminPasswordResetInput {
  readonly token: string;
  // 長さなどの検証は方針の確認で行う
  readonly newPassword: string;
}

export interface AdminPasswordReset {
  // 呼び出し側が先にbot判定を通す。管理者の有無と状態を問わず同じ結果になり、送信回数の上限だけを例外で伝える
  request(email: string, meta: AdminRequestMeta): Promise<void>;
  // 無効なリンクはAppError(unprocessable, invalid_link)、方針の違反はAppError(unprocessable, password_rejected)を投げる
  complete(
    input: CompleteAdminPasswordResetInput,
    meta: AdminRequestMeta,
  ): Promise<void>;
}

const NEW_PASSWORD_FIELD = 'newPassword';

const RESET_HASH_PURPOSE = ADMIN_HASH_PURPOSES.authToken('password_reset');

const logger = getAppLogger(['api', 'admin', 'password-reset']);

const isActive = (admin: AdminRecord | undefined): admin is AdminRecord =>
  admin?.status === 'active';

@injectable()
export class StoreAdminPasswordReset implements AdminPasswordReset {
  constructor(
    @inject(ADMIN_TYPES.AdminMailSendLimits)
    private readonly mailLimits: AdminMailSendLimits,
    @inject(ADMIN_TYPES.AdminAccountStore)
    private readonly admins: AdminAccountStore,
    @inject(ADMIN_TYPES.AdminAuthTokenStore)
    private readonly tokens: AdminAuthTokenStore,
    @inject(AUTH_TYPES.SecretIssuer)
    private readonly secrets: SecretIssuer,
    @inject(AUTH_TYPES.PasswordPolicy)
    private readonly passwordPolicy: PasswordPolicy,
    @inject(AUTH_TYPES.PasswordHasher)
    private readonly passwordHasher: PasswordHasher,
    @inject(ADMIN_TYPES.AdminMailer)
    private readonly mailer: AdminMailer,
  ) {}

  async request(email: string, meta: AdminRequestMeta): Promise<void> {
    const address = trimWhiteSpace(email);
    // 管理者の有無を上限の到達の違いから推測させないよう、管理者を探す前に数える
    await this.mailLimits.consume('password_reset', address, meta);
    const admin = await this.admins.findByEmail(address);
    if (!isActive(admin)) {
      return;
    }
    const { token, plain } = await prepareAdminAuthToken(
      this.secrets,
      admin.id,
      'password_reset',
      meta.now,
    );
    await this.tokens.replace(token);
    try {
      await this.mailer.sendPasswordReset(admin, plain, token.expiresAt);
    } catch (error: unknown) {
      // 送信の失敗を応答に出すと送信対象の管理者がいると分かるため、記録に留めて同じ結果を返す
      logger.error('パスワードリセットのメールの送信を要求できませんでした', {
        error,
        adminId: admin.id,
      });
    }
  }

  async complete(
    input: CompleteAdminPasswordResetInput,
    meta: AdminRequestMeta,
  ): Promise<void> {
    const tokenHash = await this.secrets.hashOf(
      RESET_HASH_PURPOSE,
      input.token,
    );
    // 方針に反したパスワードで同じリンクを使い切らせないよう、消費せずに読んで管理者を特定する
    const found = await this.tokens.findValid(
      'password_reset',
      tokenHash,
      meta.now,
    );
    if (found === undefined) {
      throw adminError('invalid_link');
    }
    const admin = await this.admins.findById(found.adminId);
    if (!isActive(admin)) {
      throw adminError('invalid_link');
    }
    const validation = await this.passwordPolicy.validateNewPassword(
      input.newPassword,
      { nickname: admin.nickname ?? undefined, email: admin.email },
    );
    if (!validation.ok) {
      throw adminPasswordRejectedError(
        validation.violation,
        NEW_PASSWORD_FIELD,
      );
    }
    const passwordHash = await this.passwordHasher.hash(input.newPassword);
    const consumed = await this.tokens.consume(
      'password_reset',
      tokenHash,
      meta.now,
    );
    if (consumed?.adminId !== admin.id) {
      throw adminError('invalid_link');
    }
    await this.admins.applyPasswordReset(admin.id, passwordHash);
    await this.#sendCompleted(admin, meta.now);
  }

  async #sendCompleted(admin: AdminRecord, at: Date): Promise<void> {
    try {
      await this.mailer.sendPasswordResetCompleted(admin, at);
    } catch (error: unknown) {
      // パスワードは更新済みでリンクも使用済みのため、失敗を返すと管理者が再設定をやり直せなくなる
      logger.error(
        'パスワードリセットの完了メールの送信を要求できませんでした',
        { error, adminId: admin.id },
      );
    }
  }
}
