import { inject, injectable } from 'inversify';

import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { PasswordPolicy } from '../auth/password-policy.ts';
import type { PasswordHasher } from '../auth/ports.ts';
import { adminPasswordRejectedError } from './admin-errors.ts';
import { requireOperatorRecord } from './admin-operator-record.ts';
import type {
  AdminReAuthenticationInput,
  AdminReAuthenticator,
} from './admin-re-authenticator.ts';
import type { AdminSessionIssuer } from './admin-session-issuer.ts';
import { ADMIN_TYPES } from './admin-types.ts';
import type {
  AdminAccountStore,
  AdminMailer,
  AdminRecord,
  AdminRequestMeta,
  IssuedAdminSession,
} from './ports.ts';

export interface ChangeAdminPasswordInput {
  // 長さなどの検証は方針の確認で行う
  readonly newPassword: string;
  readonly reAuthentication: AdminReAuthenticationInput;
}

export interface AdminPasswordChange {
  // 本人確認の失敗はAppError(unprocessable, reauthentication_failed)、方針の違反はAppError(unprocessable, password_rejected)を投げる。
  // 全セッションを消した後に、操作した端末へ渡す新しいセッションを返す
  change(
    current: CurrentAdmin,
    input: ChangeAdminPasswordInput,
    meta: AdminRequestMeta,
  ): Promise<{ readonly session: IssuedAdminSession }>;
}

const NEW_PASSWORD_FIELD = 'newPassword';

const logger = getAppLogger(['api', 'admin', 'password-change']);

@injectable()
export class StoreAdminPasswordChange implements AdminPasswordChange {
  constructor(
    @inject(ADMIN_TYPES.AdminReAuthenticator)
    private readonly reAuthenticator: AdminReAuthenticator,
    @inject(AUTH_TYPES.PasswordPolicy)
    private readonly passwordPolicy: PasswordPolicy,
    @inject(AUTH_TYPES.PasswordHasher)
    private readonly passwordHasher: PasswordHasher,
    @inject(ADMIN_TYPES.AdminAccountStore)
    private readonly admins: AdminAccountStore,
    @inject(ADMIN_TYPES.AdminMailer)
    private readonly mailer: AdminMailer,
    @inject(ADMIN_TYPES.AdminSessionIssuer)
    private readonly sessionIssuer: AdminSessionIssuer,
  ) {}

  async change(
    current: CurrentAdmin,
    input: ChangeAdminPasswordInput,
    meta: AdminRequestMeta,
  ): Promise<{ readonly session: IssuedAdminSession }> {
    const admin = await requireOperatorRecord(this.admins, current);
    await this.reAuthenticator.verify(admin, input.reAuthentication, meta);
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
    await this.admins.applyPasswordChange(admin.id, passwordHash);
    await this.#sendChanged(admin, meta.now);
    // 操作した端末は本人確認を通った同じ管理者のため、他の端末と同じく消えたセッションの代わりをこの端末にだけ渡す
    return { session: await this.sessionIssuer.issue(admin.id, meta) };
  }

  async #sendChanged(admin: AdminRecord, at: Date): Promise<void> {
    try {
      await this.mailer.sendPasswordChanged(admin, at);
    } catch (error: unknown) {
      // パスワードは更新済みのため、失敗を返すと操作した端末へセッションを渡せずログアウトしたままになる
      logger.error('パスワード変更の完了メールの送信を要求できませんでした', {
        error,
        adminId: admin.id,
      });
    }
  }
}
