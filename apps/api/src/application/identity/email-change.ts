import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { AUTH_TOKEN_HASH_PURPOSES } from '../../domain/identity/auth-token-purpose.ts';
import { checkAccountWritable } from '../../domain/identity/user-account.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import type { Principal } from '../session/session-verifier.ts';
import type { CurrentUser } from './account-guard.ts';
import { prepareAuthToken } from './auth-token-issuance.ts';
import type { DisposableEmailCheck } from './disposable-email-check.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import { invalidLinkError } from './invalid-link.ts';
import type {
  AuthTokenStore,
  IdentityMailer,
  MailSendLimits,
  UserAccountStore,
  UserRecord,
} from './ports.ts';
import type {
  ReAuthenticationInput,
  ReAuthenticator,
} from './re-authenticator.ts';
import type { RequestMeta } from './request-meta.ts';
import type { IssuedSession, SessionIssuer } from './session-issuer.ts';

export interface RequestEmailChangeCommand {
  readonly newEmail: string;
  readonly reAuthentication: ReAuthenticationInput;
}

export interface EmailChange {
  // 呼び出し側が先にAccountGuard.requireWritableUserとbot判定を通す。
  // 新しいメールアドレスの重複の有無を問わず同じ結果になり、本人確認の失敗と送信回数の上限だけを例外で伝える
  request(
    current: CurrentUser,
    command: RequestEmailChangeCommand,
    meta: RequestMeta,
  ): Promise<void>;
  // 無効なリンク・退会済みや停止中の利用者・確定の時点での重複はAppError(unprocessable, invalid_link)を投げる
  confirm(
    token: string,
    operator: Principal,
    meta: RequestMeta,
  ): Promise<{ readonly session: IssuedSession | undefined }>;
}

const logger = getAppLogger(['api', 'identity', 'email-change']);

const isConfirmable = (user: UserRecord | undefined): user is UserRecord =>
  user !== undefined &&
  checkAccountWritable(user, { requireVerifiedEmail: false }) === undefined;

@injectable()
export class StoreEmailChange implements EmailChange {
  constructor(
    @inject(IDENTITY_TYPES.ReAuthenticator)
    private readonly reAuthenticator: ReAuthenticator,
    @inject(IDENTITY_TYPES.MailSendLimits)
    private readonly mailLimits: MailSendLimits,
    @inject(IDENTITY_TYPES.UserAccountStore)
    private readonly users: UserAccountStore,
    @inject(IDENTITY_TYPES.AuthTokenStore)
    private readonly tokens: AuthTokenStore,
    @inject(AUTH_TYPES.SecretIssuer)
    private readonly secrets: SecretIssuer,
    @inject(IDENTITY_TYPES.IdentityMailer)
    private readonly mailer: IdentityMailer,
    @inject(IDENTITY_TYPES.DisposableEmailCheck)
    private readonly disposableCheck: DisposableEmailCheck,
    @inject(IDENTITY_TYPES.SessionIssuer)
    private readonly sessionIssuer: SessionIssuer,
  ) {}

  async request(
    current: CurrentUser,
    command: RequestEmailChangeCommand,
    meta: RequestMeta,
  ): Promise<void> {
    const { user } = current;
    await this.reAuthenticator.verify(user, command.reAuthentication, meta);
    const newEmail = trimWhiteSpace(command.newEmail);
    // 重複の有無を上限の到達の違いから推測させないよう、重複を調べる前に数える
    await this.mailLimits.consume('email_change', newEmail, meta);
    if (await this.users.isEmailInUse(newEmail, user.id)) {
      return;
    }
    const { token, plain } = await prepareAuthToken(
      this.secrets,
      user.id,
      'email_change',
      meta.now,
    );
    await this.tokens.replace({ ...token, newEmail });
    try {
      await this.mailer.sendEmailChangeConfirmation(
        user,
        newEmail,
        plain,
        token.expiresAt,
      );
    } catch (error: unknown) {
      // 送信の失敗を応答に出すと新しいメールアドレスが使われていないと分かるため、記録に留めて同じ結果を返す
      logger.error(
        'メールアドレス変更の確認メールの送信を要求できませんでした',
        { error, userId: user.id },
      );
    }
  }

  async confirm(
    token: string,
    operator: Principal,
    meta: RequestMeta,
  ): Promise<{ readonly session: IssuedSession | undefined }> {
    const tokenHash = await this.secrets.hashOf(
      AUTH_TOKEN_HASH_PURPOSES.email_change,
      token,
    );
    const consumed = await this.tokens.consume(
      'email_change',
      tokenHash,
      meta.now,
    );
    if (consumed === undefined || consumed.newEmail === null) {
      throw invalidLinkError();
    }
    const { newEmail } = consumed;
    const user = await this.users.findById(consumed.userId);
    if (!isConfirmable(user)) {
      throw invalidLinkError();
    }
    const outcome = await this.users.applyEmailChange(
      user.id,
      newEmail,
      meta.now,
    );
    if (outcome === 'email-in-use') {
      throw invalidLinkError();
    }
    const changed: UserRecord = {
      ...user,
      email: newEmail,
      emailVerifiedAt: meta.now,
      disposableEmailStatus: null,
    };
    await this.#checkDisposable(changed, meta.now);
    await this.#sendChanged(user.email, changed, meta.now);
    return {
      session: await this.sessionIssuer.reissueForOperator(
        user.id,
        operator,
        meta,
      ),
    };
  }

  async #checkDisposable(user: UserRecord, at: Date): Promise<void> {
    try {
      await this.disposableCheck.checkAndSave(user, at);
    } catch (error: unknown) {
      // 失敗を返すと、乗っ取りに気づくための変更前のアドレスへの完了メールが送られず、操作した端末へセッションも渡せなくなる
      logger.error('新しいメールアドレスの使い捨て判定を保存できませんでした', {
        error,
        userId: user.id,
      });
    }
  }

  async #sendChanged(
    previousEmail: string,
    user: UserRecord,
    at: Date,
  ): Promise<void> {
    try {
      await this.mailer.sendEmailChanged(previousEmail, user, at);
    } catch (error: unknown) {
      // 変更は確定済みでリンクも使用済みのため、失敗を返すと操作した端末へセッションを渡せなくなる
      logger.error(
        'メールアドレス変更の完了メールの送信を要求できませんでした',
        { error, userId: user.id },
      );
    }
  }
}
