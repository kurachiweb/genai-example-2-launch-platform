import { inject, injectable } from 'inversify';

import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { Principal } from '../../../lib/core/session/session-view.ts';
import { ADMIN_HASH_PURPOSES } from '../../domain/admin/admin-auth-token-purpose.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import { prepareAdminAuthToken } from './admin-auth-token-issuance.ts';
import { adminError } from './admin-errors.ts';
import { requireOperatorRecord } from './admin-operator-record.ts';
import type {
  AdminReAuthenticationInput,
  AdminReAuthenticator,
} from './admin-re-authenticator.ts';
import type { AdminSessionIssuer } from './admin-session-issuer.ts';
import { ADMIN_TYPES } from './admin-types.ts';
import type {
  AdminAccountStore,
  AdminAuthTokenStore,
  AdminMailer,
  AdminMailSendLimits,
  AdminRecord,
  AdminRequestMeta,
  IssuedAdminSession,
} from './ports.ts';

export interface RequestAdminEmailChangeInput {
  readonly newEmail: string;
  readonly reAuthentication: AdminReAuthenticationInput;
}

export interface AdminEmailChange {
  // 新しいメールアドレスの重複の有無を問わず同じ結果になり、本人確認の失敗と送信回数の上限だけを例外で伝える
  request(
    current: CurrentAdmin,
    input: RequestAdminEmailChangeInput,
    meta: AdminRequestMeta,
  ): Promise<void>;
  // 無効なリンク・有効でない管理者・確定の時点での重複はAppError(unprocessable, invalid_link)を投げる
  confirm(
    token: string,
    operator: Principal,
    meta: AdminRequestMeta,
  ): Promise<{ readonly session: IssuedAdminSession | undefined }>;
}

const EMAIL_CHANGE_HASH_PURPOSE = ADMIN_HASH_PURPOSES.authToken('email_change');

const logger = getAppLogger(['api', 'admin', 'email-change']);

@injectable()
export class StoreAdminEmailChange implements AdminEmailChange {
  constructor(
    @inject(ADMIN_TYPES.AdminReAuthenticator)
    private readonly reAuthenticator: AdminReAuthenticator,
    @inject(ADMIN_TYPES.AdminMailSendLimits)
    private readonly mailLimits: AdminMailSendLimits,
    @inject(ADMIN_TYPES.AdminAccountStore)
    private readonly admins: AdminAccountStore,
    @inject(ADMIN_TYPES.AdminAuthTokenStore)
    private readonly tokens: AdminAuthTokenStore,
    @inject(AUTH_TYPES.SecretIssuer)
    private readonly secrets: SecretIssuer,
    @inject(ADMIN_TYPES.AdminMailer)
    private readonly mailer: AdminMailer,
    @inject(ADMIN_TYPES.AdminSessionIssuer)
    private readonly sessionIssuer: AdminSessionIssuer,
  ) {}

  async request(
    current: CurrentAdmin,
    input: RequestAdminEmailChangeInput,
    meta: AdminRequestMeta,
  ): Promise<void> {
    const admin = await requireOperatorRecord(this.admins, current);
    await this.reAuthenticator.verify(admin, input.reAuthentication, meta);
    const newEmail = trimWhiteSpace(input.newEmail);
    // 重複の有無を上限の到達の違いから推測させないよう、重複を調べる前に数える
    await this.mailLimits.consume('email_change', newEmail, meta);
    const holder = await this.admins.findByEmail(newEmail);
    if (holder !== undefined && holder.id !== admin.id) {
      return;
    }
    const { token, plain } = await prepareAdminAuthToken(
      this.secrets,
      admin.id,
      'email_change',
      meta.now,
    );
    await this.tokens.replace({ ...token, newEmail });
    try {
      await this.mailer.sendEmailChangeConfirmation(
        admin,
        newEmail,
        plain,
        token.expiresAt,
      );
    } catch (error: unknown) {
      // 送信の失敗を応答に出すと新しいメールアドレスが使われていないと分かるため、記録に留めて同じ結果を返す
      logger.error(
        'メールアドレス変更の確認メールの送信を要求できませんでした',
        { error, adminId: admin.id },
      );
    }
  }

  async confirm(
    token: string,
    operator: Principal,
    meta: AdminRequestMeta,
  ): Promise<{ readonly session: IssuedAdminSession | undefined }> {
    const tokenHash = await this.secrets.hashOf(
      EMAIL_CHANGE_HASH_PURPOSE,
      token,
    );
    const consumed = await this.tokens.consume(
      'email_change',
      tokenHash,
      meta.now,
    );
    if (consumed === undefined || consumed.newEmail === null) {
      throw adminError('invalid_link');
    }
    const { newEmail } = consumed;
    const admin = await this.admins.findById(consumed.adminId);
    if (admin?.status !== 'active') {
      throw adminError('invalid_link');
    }
    const outcome = await this.admins.applyEmailChange(admin.id, newEmail);
    if (outcome === 'email-in-use') {
      throw adminError('invalid_link');
    }
    await this.#sendChanged(
      admin.email,
      { ...admin, email: newEmail },
      meta.now,
    );
    return {
      session: await this.sessionIssuer.reissueForOperator(
        admin.id,
        operator,
        meta,
      ),
    };
  }

  async #sendChanged(
    previousEmail: string,
    admin: AdminRecord,
    at: Date,
  ): Promise<void> {
    try {
      await this.mailer.sendEmailChanged(previousEmail, admin, at);
    } catch (error: unknown) {
      // 変更は確定済みでリンクも使用済みのため、失敗を返すと操作した端末へセッションを渡せなくなる
      logger.error(
        'メールアドレス変更の完了メールの送信を要求できませんでした',
        { error, adminId: admin.id },
      );
    }
  }
}
