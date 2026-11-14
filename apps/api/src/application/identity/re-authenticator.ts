import { inject, injectable } from 'inversify';

import type { KeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type {
  LoginThrottle,
  LoginThrottleKeys,
  PasswordHasher,
  SecretBox,
  TotpAuthenticator,
} from '../auth/ports.ts';
import {
  currentPasswordIncorrectError,
  type ReAuthenticationInput,
  secondFactorIncorrectError,
  secondFactorRequiredError,
} from '../auth/re-authentication.ts';
import type { RecoveryCodeIssuer } from '../auth/recovery-code-issuer.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import {
  checkUserLoginThrottle,
  type LoginThrottleCheckDependencies,
  USER_LOGIN_THROTTLE_SCOPE,
} from './login-throttle-check.ts';
import type {
  RecoveryCodeStore,
  TotpCredentialStore,
  UserRecord,
} from './ports.ts';
import type { RequestMeta } from './request-meta.ts';
import {
  checkSecondFactor,
  isTotpEnabled,
  type SecondFactorCheckDependencies,
} from './second-factor-check.ts';

export type { ReAuthenticationInput } from '../auth/re-authentication.ts';

export interface ReAuthenticator {
  // 通らなければAppError(unprocessable, reauthentication_failed)を投げる
  verify(
    user: UserRecord,
    input: ReAuthenticationInput,
    meta: RequestMeta,
  ): Promise<void>;
}

@injectable()
export class StoreReAuthenticator implements ReAuthenticator {
  readonly #throttleCheck: LoginThrottleCheckDependencies;
  readonly #secondFactor: SecondFactorCheckDependencies;

  constructor(
    @inject(PLATFORM_TYPES.KeyedHasher)
    keyedHasher: KeyedHasher,
    @inject(AUTH_TYPES.LoginThrottle)
    private readonly throttle: LoginThrottle,
    @inject(AUTH_TYPES.PasswordHasher)
    private readonly passwordHasher: PasswordHasher,
    @inject(IDENTITY_TYPES.TotpCredentialStore)
    private readonly totpCredentials: TotpCredentialStore,
    @inject(AUTH_TYPES.SecretBox)
    secretBox: SecretBox,
    @inject(AUTH_TYPES.TotpAuthenticator)
    totp: TotpAuthenticator,
    @inject(AUTH_TYPES.RecoveryCodeIssuer)
    recoveryCodeIssuer: RecoveryCodeIssuer,
    @inject(IDENTITY_TYPES.RecoveryCodeStore)
    recoveryCodes: RecoveryCodeStore,
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

  // ログインの成功ではないため、通っても失敗の記録は消さない
  async verify(
    user: UserRecord,
    input: ReAuthenticationInput,
    meta: RequestMeta,
  ): Promise<void> {
    const keys = await checkUserLoginThrottle(
      this.#throttleCheck,
      user.email,
      meta,
    );
    // パスワードが誤りの時に第2要素を照合すると、本人でない者の入力でリカバリコードや時間窓を使い切らせてしまう
    if (
      !(await this.passwordHasher.verify(
        input.currentPassword,
        user.passwordHash,
      ))
    ) {
      await this.#recordFailure(keys, meta);
      throw currentPasswordIncorrectError();
    }
    if (!isTotpEnabled(await this.totpCredentials.find(user.id))) {
      return;
    }
    if (input.secondFactor === undefined) {
      await this.#recordFailure(keys, meta);
      throw secondFactorRequiredError();
    }
    const passed = await checkSecondFactor(
      this.#secondFactor,
      user.id,
      input.secondFactor,
      meta.now,
    );
    if (!passed) {
      await this.#recordFailure(keys, meta);
      throw secondFactorIncorrectError(input.secondFactor.kind);
    }
  }

  async #recordFailure(
    keys: LoginThrottleKeys,
    meta: RequestMeta,
  ): Promise<void> {
    await this.throttle.recordFailure(
      USER_LOGIN_THROTTLE_SCOPE,
      keys,
      meta.now,
    );
  }
}
