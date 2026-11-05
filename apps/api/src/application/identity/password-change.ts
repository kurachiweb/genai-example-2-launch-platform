import { inject, injectable } from 'inversify';

import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { Principal } from '../../../lib/core/session/session-view.ts';
import { AUTH_TOKEN_HASH_PURPOSES } from '../../domain/identity/auth-token-purpose.ts';
import { checkAccountWritable } from '../../domain/identity/user-account.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { PasswordPolicy } from '../auth/password-policy.ts';
import type { PasswordHasher } from '../auth/ports.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import { prepareAuthToken } from './auth-token-issuance.ts';
import { loadCurrentUserRecord } from './current-user-record.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import { identityError } from './identity-errors.ts';
import { passwordRejectedError } from './password-rejection.ts';
import type {
  AuthTokenStore,
  IdentityMailer,
  UserAccountStore,
  UserRecord,
} from './ports.ts';
import type {
  ReAuthenticationInput,
  ReAuthenticator,
} from './re-authenticator.ts';
import type { RequestMeta } from './request-meta.ts';
import type { IssuedSession, SessionIssuer } from './session-issuer.ts';

export interface RequestPasswordChangeCommand {
  // 長さなどの検証は方針の確認で行う
  readonly newPassword: string;
  readonly reAuthentication: ReAuthenticationInput;
}

export interface PasswordChange {
  // 呼び出し側が先にAccountGuard.requireWritableUserとbot判定を通す。
  // 方針の違反はAppError(unprocessable, password_rejected)を投げる
  request(
    current: CurrentUser,
    command: RequestPasswordChangeCommand,
    meta: RequestMeta,
  ): Promise<void>;
  // 無効なリンク・退会済みや停止中の利用者はAppError(unprocessable, invalid_link)を投げる
  confirm(
    token: string,
    operator: Principal,
    meta: RequestMeta,
  ): Promise<{ readonly session: IssuedSession | undefined }>;
}

const NEW_PASSWORD_FIELD = 'newPassword';

const logger = getAppLogger(['api', 'identity', 'password-change']);

const isConfirmable = (user: UserRecord | undefined): user is UserRecord =>
  user !== undefined &&
  checkAccountWritable(user, { requireVerifiedEmail: false }) === undefined;

@injectable()
export class StorePasswordChange implements PasswordChange {
  constructor(
    @inject(IDENTITY_TYPES.ReAuthenticator)
    private readonly reAuthenticator: ReAuthenticator,
    @inject(AUTH_TYPES.PasswordPolicy)
    private readonly passwordPolicy: PasswordPolicy,
    @inject(AUTH_TYPES.PasswordHasher)
    private readonly passwordHasher: PasswordHasher,
    @inject(IDENTITY_TYPES.UserAccountStore)
    private readonly users: UserAccountStore,
    @inject(IDENTITY_TYPES.AuthTokenStore)
    private readonly tokens: AuthTokenStore,
    @inject(AUTH_TYPES.SecretIssuer)
    private readonly secrets: SecretIssuer,
    @inject(IDENTITY_TYPES.IdentityMailer)
    private readonly mailer: IdentityMailer,
    @inject(IDENTITY_TYPES.SessionIssuer)
    private readonly sessionIssuer: SessionIssuer,
  ) {}

  async request(
    current: CurrentUser,
    command: RequestPasswordChangeCommand,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await loadCurrentUserRecord(this.users, current);
    await this.reAuthenticator.verify(user, command.reAuthentication, meta);
    const validation = await this.passwordPolicy.validateNewPassword(
      command.newPassword,
      { handle: user.handle, nickname: user.nickname, email: user.email },
    );
    if (!validation.ok) {
      throw passwordRejectedError(validation.violation, NEW_PASSWORD_FIELD);
    }
    const pendingPasswordHash = await this.passwordHasher.hash(
      command.newPassword,
    );
    const { token, plain } = await prepareAuthToken(
      this.secrets,
      user.id,
      'password_change',
      meta.now,
    );
    await this.tokens.replace({ ...token, pendingPasswordHash });
    await this.mailer.sendPasswordChangeConfirmation(
      user,
      plain,
      token.expiresAt,
    );
  }

  async confirm(
    token: string,
    operator: Principal,
    meta: RequestMeta,
  ): Promise<{ readonly session: IssuedSession | undefined }> {
    const tokenHash = await this.secrets.hashOf(
      AUTH_TOKEN_HASH_PURPOSES.password_change,
      token,
    );
    const consumed = await this.tokens.consume(
      'password_change',
      tokenHash,
      meta.now,
    );
    if (consumed === undefined || consumed.pendingPasswordHash === null) {
      throw identityError('invalid_link');
    }
    const { pendingPasswordHash } = consumed;
    const user = await this.users.findById(consumed.userId);
    if (!isConfirmable(user)) {
      throw identityError('invalid_link');
    }
    await this.users.applyPasswordChange(user.id, pendingPasswordHash);
    await this.#sendChanged(user, meta.now);
    return {
      session: await this.sessionIssuer.reissueForOperator(
        user.id,
        operator,
        meta,
      ),
    };
  }

  async #sendChanged(user: UserRecord, at: Date): Promise<void> {
    try {
      await this.mailer.sendPasswordChanged(user, at);
    } catch (error: unknown) {
      // パスワードは更新済みでリンクも使用済みのため、失敗を返すと操作した端末へセッションを渡せなくなる
      logger.error('パスワード変更の完了メールの送信を要求できませんでした', {
        error,
        userId: user.id,
      });
    }
  }
}
