import { inject, injectable } from 'inversify';

import {
  hashPurpose,
  type KeyedHasher,
} from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import type { SecondFactorInput } from '../../domain/auth/second-factor.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type {
  LoginThrottle,
  PasswordHasher,
  SecretBox,
  TotpAuthenticator,
} from '../auth/ports.ts';
import type { RecoveryCodeIssuer } from '../auth/recovery-code-issuer.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import type { AuthenticatedPrincipal } from '../session/session-verifier.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import {
  checkUserLoginThrottle,
  type LoginThrottleCheckDependencies,
  USER_LOGIN_THROTTLE_SCOPE,
} from './login-throttle-check.ts';
import type {
  LoginChallengeStore,
  RecoveryCodeStore,
  TotpCredentialStore,
  UserAccountStore,
  UserRecord,
  UserSessionStore,
} from './ports.ts';
import type { RequestMeta } from './request-meta.ts';
import {
  checkSecondFactor,
  isTotpEnabled,
  type SecondFactorCheckDependencies,
} from './second-factor-check.ts';
import type { IssuedSession, SessionIssuer } from './session-issuer.ts';

export type PasswordLoginResult =
  | {
      readonly kind: 'authenticated';
      readonly userId: string;
      readonly session: IssuedSession;
    }
  | {
      readonly kind: 'second-factor-required';
      // 第2要素の段階の要求と組にする平文で、応答にだけ使い保存しない
      readonly challenge: string;
      readonly expiresAt: Date;
    };

export interface SecondFactorLoginResult {
  readonly userId: string;
  readonly session: IssuedSession;
}

export interface Login {
  withPassword(
    input: { readonly email: string; readonly password: string },
    meta: RequestMeta,
  ): Promise<PasswordLoginResult>;
  withSecondFactor(
    input: {
      readonly challenge: string;
      readonly secondFactor: SecondFactorInput;
    },
    meta: RequestMeta,
  ): Promise<SecondFactorLoginResult>;
  logout(principal: AuthenticatedPrincipal): Promise<void>;
}

export const LOGIN_CHALLENGE_TTL_SECONDS = 300;

// 保存を始めた用途の名前を変えると保存済みのハッシュ値と一致しなくなるため、名前は変えない
export const USER_LOGIN_CHALLENGE_HASH_PURPOSE = hashPurpose(
  'user-login-challenge',
);

const MS_PER_SECOND = 1000;

const INVALID_CREDENTIALS_MESSAGE =
  'メールアドレスまたはパスワードが正しくありません。';

const ACCOUNT_UNAVAILABLE_MESSAGE =
  'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。';

const INVALID_SECOND_FACTOR_MESSAGE = '認証コードが正しくありません。';

const LOGIN_CHALLENGE_EXPIRED_MESSAGE =
  '認証の有効期限が切れました。もう一度ログインしてください。';

const invalidCredentialsError = (): AppError =>
  new AppError({
    kind: 'unauthenticated',
    code: 'invalid_credentials',
    message: INVALID_CREDENTIALS_MESSAGE,
  });

const accountUnavailableError = (): AppError =>
  new AppError({
    kind: 'forbidden',
    code: 'account_unavailable',
    message: ACCOUNT_UNAVAILABLE_MESSAGE,
  });

const invalidSecondFactorError = (): AppError =>
  new AppError({
    kind: 'unauthenticated',
    code: 'invalid_second_factor',
    message: INVALID_SECOND_FACTOR_MESSAGE,
  });

const loginChallengeExpiredError = (): AppError =>
  new AppError({
    kind: 'unauthenticated',
    code: 'login_challenge_expired',
    message: LOGIN_CHALLENGE_EXPIRED_MESSAGE,
  });

const activeUser = (user: UserRecord | undefined): UserRecord | undefined =>
  user === undefined || user.deletedAt !== null ? undefined : user;

@injectable()
export class StoreLogin implements Login {
  readonly #secondFactor: SecondFactorCheckDependencies;
  readonly #throttleCheck: LoginThrottleCheckDependencies;

  constructor(
    @inject(PLATFORM_TYPES.KeyedHasher)
    keyedHasher: KeyedHasher,
    @inject(AUTH_TYPES.LoginThrottle)
    private readonly throttle: LoginThrottle,
    @inject(IDENTITY_TYPES.UserAccountStore)
    private readonly users: UserAccountStore,
    @inject(AUTH_TYPES.PasswordHasher)
    private readonly passwordHasher: PasswordHasher,
    @inject(IDENTITY_TYPES.TotpCredentialStore)
    private readonly totpCredentials: TotpCredentialStore,
    @inject(AUTH_TYPES.SecretIssuer)
    private readonly secrets: SecretIssuer,
    @inject(PLATFORM_TYPES.IdGenerator)
    private readonly ids: IdGenerator,
    @inject(IDENTITY_TYPES.LoginChallengeStore)
    private readonly challenges: LoginChallengeStore,
    @inject(IDENTITY_TYPES.SessionIssuer)
    private readonly sessionIssuer: SessionIssuer,
    @inject(AUTH_TYPES.SecretBox)
    secretBox: SecretBox,
    @inject(AUTH_TYPES.TotpAuthenticator)
    totp: TotpAuthenticator,
    @inject(AUTH_TYPES.RecoveryCodeIssuer)
    recoveryCodeIssuer: RecoveryCodeIssuer,
    @inject(IDENTITY_TYPES.RecoveryCodeStore)
    recoveryCodes: RecoveryCodeStore,
    @inject(IDENTITY_TYPES.UserSessionStore)
    private readonly userSessions: UserSessionStore,
  ) {
    this.#throttleCheck = { keyedHasher, throttle };
    this.#secondFactor = {
      totpCredentials,
      secretBox,
      totp,
      recoveryCodeIssuer,
      recoveryCodes,
    };
  }

  async withPassword(
    input: { readonly email: string; readonly password: string },
    meta: RequestMeta,
  ): Promise<PasswordLoginResult> {
    const email = trimWhiteSpace(input.email);
    const keys = await checkUserLoginThrottle(this.#throttleCheck, email, meta);
    // 退会済みは未登録と同じ扱いにし、登録の有無と退会の有無を応答から推測させない
    const user = activeUser(await this.users.findNotWithdrawnByEmail(email));
    // 利用者がいないときもダミーの照合で同じ計算量を使い、応答時間から登録の有無を推測させない
    const matched =
      user === undefined
        ? await this.passwordHasher.verifyAgainstDummy(input.password)
        : await this.passwordHasher.verify(input.password, user.passwordHash);
    if (user === undefined || !matched) {
      await this.throttle.recordFailure(
        USER_LOGIN_THROTTLE_SCOPE,
        keys,
        meta.now,
      );
      throw invalidCredentialsError();
    }
    // 停止はパスワードを知る本人にだけ伝え、ログインの失敗としては数えない
    if (user.status === 'suspended') {
      throw accountUnavailableError();
    }
    if (isTotpEnabled(await this.totpCredentials.find(user.id))) {
      return this.#issueChallenge(user.id, meta);
    }
    await this.throttle.reset(USER_LOGIN_THROTTLE_SCOPE, keys);
    const session = await this.sessionIssuer.issue(user.id, meta);
    return { kind: 'authenticated', userId: user.id, session };
  }

  async withSecondFactor(
    input: {
      readonly challenge: string;
      readonly secondFactor: SecondFactorInput;
    },
    meta: RequestMeta,
  ): Promise<SecondFactorLoginResult> {
    const tokenHash = await this.secrets.hashOf(
      USER_LOGIN_CHALLENGE_HASH_PURPOSE,
      input.challenge,
    );
    const challenge = await this.challenges.findValid(tokenHash, meta.now);
    if (challenge === undefined) {
      throw loginChallengeExpiredError();
    }
    const user = activeUser(await this.users.findById(challenge.userId));
    if (user === undefined) {
      await this.challenges.delete(challenge.id);
      throw loginChallengeExpiredError();
    }
    // 待ちの発行後に停止された利用者は、第2要素を照合してもログインできないため、照合も失敗の記録もしない
    if (user.status === 'suspended') {
      await this.challenges.delete(challenge.id);
      throw accountUnavailableError();
    }
    // 待ちの発行後にメールアドレスが変わっても、パスワードの段階と同じ利用者の単位で数えるよう現在の値を使う
    const keys = await checkUserLoginThrottle(
      this.#throttleCheck,
      user.email,
      meta,
    );
    const passed = await checkSecondFactor(
      this.#secondFactor,
      user.id,
      input.secondFactor,
      meta.now,
    );
    if (!passed) {
      await this.throttle.recordFailure(
        USER_LOGIN_THROTTLE_SCOPE,
        keys,
        meta.now,
      );
      throw invalidSecondFactorError();
    }
    await this.challenges.delete(challenge.id);
    await this.throttle.reset(USER_LOGIN_THROTTLE_SCOPE, keys);
    const session = await this.sessionIssuer.issue(user.id, meta);
    return { userId: user.id, session };
  }

  async logout(principal: AuthenticatedPrincipal): Promise<void> {
    if (principal.subjectKind !== 'user') {
      return;
    }
    await this.userSessions.deleteOne(principal.subjectId, principal.sessionId);
  }

  async #issueChallenge(
    userId: string,
    meta: RequestMeta,
  ): Promise<PasswordLoginResult> {
    const secret = await this.secrets.issue(USER_LOGIN_CHALLENGE_HASH_PURPOSE);
    const expiresAt = new Date(
      meta.now.getTime() + LOGIN_CHALLENGE_TTL_SECONDS * MS_PER_SECOND,
    );
    await this.challenges.insert({
      id: this.ids.generate(),
      userId,
      tokenHash: secret.hash,
      expiresAt,
    });
    return {
      kind: 'second-factor-required',
      challenge: secret.plain,
      expiresAt,
    };
  }
}
