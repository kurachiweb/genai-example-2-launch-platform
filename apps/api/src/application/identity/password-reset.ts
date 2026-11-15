import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { AUTH_TOKEN_HASH_PURPOSES } from '../../domain/identity/auth-token-purpose.ts';
import { checkAccountWritable } from '../../domain/identity/user-account.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { PasswordPolicy } from '../auth/password-policy.ts';
import type { PasswordHasher } from '../auth/ports.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import { prepareAuthToken } from './auth-token-issuance.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import { identityError } from './identity-errors.ts';
import { passwordRejectedError } from './password-rejection.ts';
import type {
  AuthTokenStore,
  IdentityMailer,
  MailSendLimits,
  UserAccountStore,
  UserRecord,
} from './ports.ts';
import type { RequestMeta } from './request-meta.ts';

export interface CompletePasswordResetCommand {
  readonly token: string;
  // 長さなどの検証は方針の確認で行う
  readonly newPassword: string;
}

export interface PasswordReset {
  // アカウントの有無と状態を問わず同じ結果になり、送信回数の上限だけを例外で伝える
  request(email: string, meta: RequestMeta): Promise<void>;
  // 無効なリンクはAppError(unprocessable, invalid_link)、方針の違反はAppError(unprocessable, password_rejected)を投げる
  complete(
    command: CompletePasswordResetCommand,
    meta: RequestMeta,
  ): Promise<void>;
}

const NEW_PASSWORD_FIELD = 'newPassword';

const logger = getAppLogger(['api', 'identity', 'password-reset']);

const isResettable = (user: UserRecord | undefined): user is UserRecord =>
  user !== undefined &&
  checkAccountWritable(user, { requireVerifiedEmail: false }) === undefined;

@injectable()
export class StorePasswordReset implements PasswordReset {
  constructor(
    @inject(IDENTITY_TYPES.MailSendLimits)
    private readonly mailLimits: MailSendLimits,
    @inject(IDENTITY_TYPES.UserAccountStore)
    private readonly users: UserAccountStore,
    @inject(IDENTITY_TYPES.AuthTokenStore)
    private readonly tokens: AuthTokenStore,
    @inject(AUTH_TYPES.SecretIssuer)
    private readonly secrets: SecretIssuer,
    @inject(AUTH_TYPES.PasswordPolicy)
    private readonly passwordPolicy: PasswordPolicy,
    @inject(AUTH_TYPES.PasswordHasher)
    private readonly passwordHasher: PasswordHasher,
    @inject(IDENTITY_TYPES.IdentityMailer)
    private readonly mailer: IdentityMailer,
  ) {}

  async request(email: string, meta: RequestMeta): Promise<void> {
    const address = trimWhiteSpace(email);
    // アカウントの有無を上限の到達の違いから推測させないよう、利用者を探す前に数える
    await this.mailLimits.consume('password_reset', address, meta);
    const user = await this.users.findNotWithdrawnByEmail(address);
    if (!isResettable(user)) {
      return;
    }
    const { token, plain } = await prepareAuthToken(
      this.secrets,
      user.id,
      'password_reset',
      meta.now,
    );
    await this.tokens.replace(token);
    try {
      await this.mailer.sendPasswordReset(user, plain, token.expiresAt);
    } catch (error: unknown) {
      // 送信の失敗を応答に出すと送信対象のアカウントがあると分かるため、記録に留めて同じ結果を返す
      logger.error('パスワードリセットのメールの送信を要求できませんでした', {
        error,
        userId: user.id,
      });
    }
  }

  async complete(
    command: CompletePasswordResetCommand,
    meta: RequestMeta,
  ): Promise<void> {
    const tokenHash = await this.secrets.hashOf(
      AUTH_TOKEN_HASH_PURPOSES.password_reset,
      command.token,
    );
    // 方針に反したパスワードで同じリンクを使い切らせないよう、消費せずに読んで利用者を特定する
    const found = await this.tokens.findValid(
      'password_reset',
      tokenHash,
      meta.now,
    );
    if (found === undefined) {
      throw identityError('invalid_link');
    }
    const user = await this.users.findById(found.userId);
    if (!isResettable(user)) {
      throw identityError('invalid_link');
    }
    const validation = await this.passwordPolicy.validateNewPassword(
      command.newPassword,
      { handle: user.handle, nickname: user.nickname, email: user.email },
    );
    if (!validation.ok) {
      throw passwordRejectedError(validation.violation, NEW_PASSWORD_FIELD);
    }
    const passwordHash = await this.passwordHasher.hash(command.newPassword);
    const consumed = await this.tokens.consume(
      'password_reset',
      tokenHash,
      meta.now,
    );
    if (consumed === undefined) {
      throw identityError('invalid_link');
    }
    await this.users.applyPasswordReset(user.id, passwordHash, meta.now);
    await this.#sendCompleted(user, meta.now);
  }

  async #sendCompleted(user: UserRecord, at: Date): Promise<void> {
    try {
      await this.mailer.sendPasswordResetCompleted(user, at);
    } catch (error: unknown) {
      // パスワードは更新済みでリンクも使用済みのため、失敗を返すと利用者が再設定をやり直せなくなる
      logger.error(
        'パスワードリセットの完了メールの送信を要求できませんでした',
        {
          error,
          userId: user.id,
        },
      );
    }
  }
}
