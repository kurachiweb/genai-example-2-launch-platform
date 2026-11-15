import { inject, injectable } from 'inversify';

import type { KeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { LoginThrottleCheckDependencies } from '../auth/login-throttle-check.ts';
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
import {
  ADMIN_LOGIN_THROTTLE_SCOPE,
  checkAdminLoginThrottle,
} from './admin-login-throttle-check.ts';
import {
  type AdminSecondFactorCheckDependencies,
  checkAdminSecondFactor,
} from './admin-second-factor-check.ts';
import { ADMIN_TYPES } from './admin-types.ts';
import type {
  AdminRecord,
  AdminRecoveryCodeStore,
  AdminRequestMeta,
  AdminTotpCredentialStore,
} from './ports.ts';

export type AdminReAuthenticationInput = ReAuthenticationInput;

export interface AdminReAuthenticator {
  // 通らなければAppError(unprocessable, reauthentication_failed)を投げる
  verify(
    admin: AdminRecord,
    input: AdminReAuthenticationInput,
    meta: AdminRequestMeta,
  ): Promise<void>;
}

@injectable()
export class StoreAdminReAuthenticator implements AdminReAuthenticator {
  readonly #throttleCheck: LoginThrottleCheckDependencies;
  readonly #secondFactor: AdminSecondFactorCheckDependencies;

  constructor(
    @inject(PLATFORM_TYPES.KeyedHasher)
    keyedHasher: KeyedHasher,
    @inject(AUTH_TYPES.LoginThrottle)
    private readonly throttle: LoginThrottle,
    @inject(AUTH_TYPES.PasswordHasher)
    private readonly passwordHasher: PasswordHasher,
    @inject(ADMIN_TYPES.AdminTotpCredentialStore)
    totpCredentials: AdminTotpCredentialStore,
    @inject(AUTH_TYPES.SecretBox)
    secretBox: SecretBox,
    @inject(AUTH_TYPES.TotpAuthenticator)
    totp: TotpAuthenticator,
    @inject(AUTH_TYPES.RecoveryCodeIssuer)
    recoveryCodeIssuer: RecoveryCodeIssuer,
    @inject(ADMIN_TYPES.AdminRecoveryCodeStore)
    recoveryCodes: AdminRecoveryCodeStore,
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

  // ログインの成功ではないため、通っても失敗の記録は消さない。管理者は多要素認証を無効にできないため、第2要素を常に求める
  async verify(
    admin: AdminRecord,
    input: AdminReAuthenticationInput,
    meta: AdminRequestMeta,
  ): Promise<void> {
    const keys = await checkAdminLoginThrottle(
      this.#throttleCheck,
      admin.email,
      meta,
    );
    // パスワードが誤りの時に第2要素を照合すると、本人でない者の入力でリカバリコードや時間窓を使い切らせてしまう
    if (!(await this.#passwordMatches(admin, input.currentPassword))) {
      await this.#recordFailure(keys, meta);
      throw currentPasswordIncorrectError();
    }
    if (input.secondFactor === undefined) {
      await this.#recordFailure(keys, meta);
      throw secondFactorRequiredError();
    }
    const passed = await checkAdminSecondFactor(
      this.#secondFactor,
      admin.id,
      input.secondFactor,
      meta.now,
    );
    if (!passed) {
      await this.#recordFailure(keys, meta);
      throw secondFactorIncorrectError(input.secondFactor.kind);
    }
  }

  #passwordMatches(admin: AdminRecord, password: string): Promise<boolean> {
    return admin.passwordHash === null
      ? this.passwordHasher.verifyAgainstDummy(password)
      : this.passwordHasher.verify(password, admin.passwordHash);
  }

  async #recordFailure(
    keys: LoginThrottleKeys,
    meta: AdminRequestMeta,
  ): Promise<void> {
    await this.throttle.recordFailure(
      ADMIN_LOGIN_THROTTLE_SCOPE,
      keys,
      meta.now,
    );
  }
}
