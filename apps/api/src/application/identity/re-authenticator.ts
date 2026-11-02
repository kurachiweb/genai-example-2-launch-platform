import { inject, injectable } from 'inversify';

import type { KeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { SecondFactorInput } from '../../domain/auth/second-factor.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type {
  LoginThrottle,
  LoginThrottleKeys,
  PasswordHasher,
  SecretBox,
  TotpAuthenticator,
} from '../auth/ports.ts';
import type { RecoveryCodeIssuer } from '../auth/recovery-code-issuer.ts';
import {
  CURRENT_PASSWORD_INCORRECT_MESSAGE,
  IDENTITY_ERRORS,
  REAUTHENTICATION_FAILED_CODE,
} from './identity-errors.ts';
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

export interface ReAuthenticationInput {
  readonly currentPassword: string;
  readonly secondFactor: SecondFactorInput | undefined;
}

export interface ReAuthenticator {
  // 通らなければAppError(unprocessable, reauthentication_failed)を投げる
  verify(
    user: UserRecord,
    input: ReAuthenticationInput,
    meta: RequestMeta,
  ): Promise<void>;
}

// 詳細の欄は本人確認の入力の中の相対の経路で示す。操作ごとに本人確認の入力の置き場所が異なるため、リゾルバが入力の形に合わせて前に経路を足す
export const CURRENT_PASSWORD_FIELD = 'currentPassword';

export const SECOND_FACTOR_FIELD = 'secondFactor';

export const SECOND_FACTOR_FIELDS: Readonly<
  Record<SecondFactorInput['kind'], string>
> = Object.freeze({
  totp: 'secondFactor.totpCode',
  recovery: 'secondFactor.recoveryCode',
});

const SECOND_FACTOR_INCORRECT_MESSAGE =
  IDENTITY_ERRORS.invalid_second_factor.message;

const reAuthenticationFailedError = (
  field: string,
  code: 'incorrect' | 'required',
  message: string,
): AppError =>
  new AppError({
    kind: 'unprocessable',
    code: REAUTHENTICATION_FAILED_CODE,
    message,
    details: [{ field, code, message }],
  });

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
      throw reAuthenticationFailedError(
        CURRENT_PASSWORD_FIELD,
        'incorrect',
        CURRENT_PASSWORD_INCORRECT_MESSAGE,
      );
    }
    if (!isTotpEnabled(await this.totpCredentials.find(user.id))) {
      return;
    }
    if (input.secondFactor === undefined) {
      await this.#recordFailure(keys, meta);
      throw reAuthenticationFailedError(
        SECOND_FACTOR_FIELD,
        'required',
        SECOND_FACTOR_INCORRECT_MESSAGE,
      );
    }
    const passed = await checkSecondFactor(
      this.#secondFactor,
      user.id,
      input.secondFactor,
      meta.now,
    );
    if (!passed) {
      await this.#recordFailure(keys, meta);
      throw reAuthenticationFailedError(
        SECOND_FACTOR_FIELDS[input.secondFactor.kind],
        'incorrect',
        SECOND_FACTOR_INCORRECT_MESSAGE,
      );
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
