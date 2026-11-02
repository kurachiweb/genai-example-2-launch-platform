import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { AUTH_TOKEN_HASH_PURPOSES } from '../../domain/identity/auth-token-purpose.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import type { SessionView } from '../session/session-view.ts';
import type { AccountGuard } from './account-guard.ts';
import { prepareAuthToken } from './auth-token-issuance.ts';
import type { DisposableEmailCheck } from './disposable-email-check.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import { identityError } from './identity-errors.ts';
import type {
  AuthTokenStore,
  IdentityMailer,
  MailSendLimits,
  UserAccountStore,
} from './ports.ts';
import type { RequestMeta } from './request-meta.ts';

const logger = getAppLogger(['api', 'identity', 'email-verification']);

export type ResendVerificationResult = 'sent' | 'already-verified';

export interface EmailVerification {
  // 無効なリンクはAppError(unprocessable, invalid_link)を投げる
  verify(token: string, meta: RequestMeta): Promise<void>;
  resend(
    session: SessionView,
    meta: RequestMeta,
  ): Promise<ResendVerificationResult>;
}

@injectable()
export class StoreEmailVerification implements EmailVerification {
  constructor(
    @inject(AUTH_TYPES.SecretIssuer)
    private readonly secrets: SecretIssuer,
    @inject(IDENTITY_TYPES.AuthTokenStore)
    private readonly tokens: AuthTokenStore,
    @inject(IDENTITY_TYPES.UserAccountStore)
    private readonly users: UserAccountStore,
    @inject(IDENTITY_TYPES.DisposableEmailCheck)
    private readonly disposableCheck: DisposableEmailCheck,
    @inject(IDENTITY_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(IDENTITY_TYPES.MailSendLimits)
    private readonly mailLimits: MailSendLimits,
    @inject(IDENTITY_TYPES.IdentityMailer)
    private readonly mailer: IdentityMailer,
  ) {}

  async verify(token: string, meta: RequestMeta): Promise<void> {
    const tokenHash = await this.secrets.hashOf(
      AUTH_TOKEN_HASH_PURPOSES.email_verification,
      token,
    );
    const consumed = await this.tokens.consume(
      'email_verification',
      tokenHash,
      meta.now,
    );
    if (consumed === undefined) {
      throw identityError('invalid_link');
    }
    const user = await this.users.findById(consumed.userId);
    if (user === undefined || user.deletedAt !== null) {
      throw identityError('invalid_link');
    }
    // トークンの消費と確認済みの更新は別の書き込みのため、更新に失敗した利用者は確認メールの再送で取り戻す
    await this.users.markEmailVerified(user.id, meta.now);
    try {
      await this.disposableCheck.checkAndSave(user, meta.now);
    } catch (error: unknown) {
      // 確認済みにしてトークンも消費した後のため、失敗を返すと同じリンクで再試行できず、確認が終わったことも伝わらない
      logger.error(
        '確認したメールアドレスの使い捨て判定を保存できませんでした',
        {
          error,
          userId: user.id,
        },
      );
    }
  }

  async resend(
    session: SessionView,
    meta: RequestMeta,
  ): Promise<ResendVerificationResult> {
    const { user } = await this.guard.requireWritableUser(session);
    if (user.emailVerifiedAt !== null) {
      return 'already-verified';
    }
    await this.mailLimits.consume('email_verification', user.email, meta);
    const { token, plain } = await prepareAuthToken(
      this.secrets,
      user.id,
      'email_verification',
      meta.now,
    );
    await this.tokens.replace(token);
    await this.mailer.sendEmailVerification(user, plain, token.expiresAt);
    return 'sent';
  }
}
