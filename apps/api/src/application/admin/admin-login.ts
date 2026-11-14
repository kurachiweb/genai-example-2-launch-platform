import { inject, injectable } from 'inversify';

import type { KeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import type { AuthenticatedPrincipal } from '../../../lib/core/session/session-view.ts';
import { ADMIN_HASH_PURPOSES } from '../../domain/admin/admin-auth-token-purpose.ts';
import type { SecondFactorInput } from '../../domain/auth/second-factor.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { LoginThrottleCheckDependencies } from '../auth/login-throttle-check.ts';
import type {
  LoginThrottle,
  PasswordHasher,
  SecretBox,
  TotpAuthenticator,
} from '../auth/ports.ts';
import type { RecoveryCodeIssuer } from '../auth/recovery-code-issuer.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import { adminError } from './admin-errors.ts';
import {
  ADMIN_LOGIN_THROTTLE_SCOPE,
  checkAdminLoginThrottle,
} from './admin-login-throttle-check.ts';
import {
  type AdminSecondFactorCheckDependencies,
  checkAdminSecondFactor,
} from './admin-second-factor-check.ts';
import type { AdminSessionIssuer } from './admin-session-issuer.ts';
import { ADMIN_TYPES } from './admin-types.ts';
import type {
  AdminAccountStore,
  AdminLoginChallengeStore,
  AdminRecord,
  AdminRecoveryCodeStore,
  AdminRequestMeta,
  AdminSessionStore,
  AdminTotpCredentialStore,
  IssuedAdminSession,
} from './ports.ts';

export interface AdminLoginChallengeIssued {
  readonly adminId: string;
  // 第2要素の段階の要求と組にする平文で、応答にだけ使い保存しない
  readonly challenge: string;
  readonly expiresAt: Date;
}

export interface AdminSecondFactorLoginResult {
  readonly adminId: string;
  readonly session: IssuedAdminSession;
}

export interface AdminLogin {
  // 有効な管理者は必ず第2要素を求めるため、パスワードの段階ではセッションを発行しない
  withPassword(
    input: { readonly email: string; readonly password: string },
    meta: AdminRequestMeta,
  ): Promise<AdminLoginChallengeIssued>;
  withSecondFactor(
    input: {
      readonly challenge: string;
      readonly secondFactor: SecondFactorInput;
    },
    meta: AdminRequestMeta,
  ): Promise<AdminSecondFactorLoginResult>;
  logout(principal: AuthenticatedPrincipal): Promise<void>;
}

export const ADMIN_LOGIN_CHALLENGE_TTL_SECONDS = 300;

const MS_PER_SECOND = 1000;

type ActiveAdmin = AdminRecord & {
  readonly status: 'active';
  readonly passwordHash: string;
};

const isActiveAdmin = (admin: AdminRecord | undefined): admin is ActiveAdmin =>
  admin?.status === 'active' && admin.passwordHash !== null;

const activeAdmin = (
  admin: AdminRecord | undefined,
): ActiveAdmin | undefined => (isActiveAdmin(admin) ? admin : undefined);

@injectable()
export class StoreAdminLogin implements AdminLogin {
  readonly #throttleCheck: LoginThrottleCheckDependencies;
  readonly #secondFactor: AdminSecondFactorCheckDependencies;

  constructor(
    @inject(PLATFORM_TYPES.KeyedHasher)
    keyedHasher: KeyedHasher,
    @inject(AUTH_TYPES.LoginThrottle)
    private readonly throttle: LoginThrottle,
    @inject(ADMIN_TYPES.AdminAccountStore)
    private readonly admins: AdminAccountStore,
    @inject(AUTH_TYPES.PasswordHasher)
    private readonly passwordHasher: PasswordHasher,
    @inject(AUTH_TYPES.SecretIssuer)
    private readonly secrets: SecretIssuer,
    @inject(PLATFORM_TYPES.IdGenerator)
    private readonly ids: IdGenerator,
    @inject(ADMIN_TYPES.AdminLoginChallengeStore)
    private readonly challenges: AdminLoginChallengeStore,
    @inject(ADMIN_TYPES.AdminSessionIssuer)
    private readonly sessionIssuer: AdminSessionIssuer,
    @inject(ADMIN_TYPES.AdminSessionStore)
    private readonly sessions: AdminSessionStore,
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

  async withPassword(
    input: { readonly email: string; readonly password: string },
    meta: AdminRequestMeta,
  ): Promise<AdminLoginChallengeIssued> {
    const email = trimWhiteSpace(input.email);
    const keys = await checkAdminLoginThrottle(
      this.#throttleCheck,
      email,
      meta,
    );
    // 招待中は未登録と同じ扱いにし、ダミーの照合で同じ計算量を使って、応答から登録や招待の有無を推測させない
    const admin = activeAdmin(await this.admins.findByEmail(email));
    const matched =
      admin === undefined
        ? await this.passwordHasher.verifyAgainstDummy(input.password)
        : await this.passwordHasher.verify(input.password, admin.passwordHash);
    if (admin === undefined || !matched) {
      await this.throttle.recordFailure(
        ADMIN_LOGIN_THROTTLE_SCOPE,
        keys,
        meta.now,
      );
      throw adminError('invalid_credentials');
    }
    return this.#issueChallenge(admin.id, meta);
  }

  async withSecondFactor(
    input: {
      readonly challenge: string;
      readonly secondFactor: SecondFactorInput;
    },
    meta: AdminRequestMeta,
  ): Promise<AdminSecondFactorLoginResult> {
    const tokenHash = await this.secrets.hashOf(
      ADMIN_HASH_PURPOSES.loginChallenge,
      input.challenge,
    );
    const challenge = await this.challenges.findValid(tokenHash, meta.now);
    if (challenge === undefined) {
      throw adminError('login_challenge_expired');
    }
    const admin = activeAdmin(await this.admins.findById(challenge.adminId));
    if (admin === undefined) {
      await this.challenges.delete(challenge.id);
      throw adminError('login_challenge_expired');
    }
    // 待ちの発行後にメールアドレスが変わっても、パスワードの段階と同じ管理者の単位で数えるよう現在の値を使う
    const keys = await checkAdminLoginThrottle(
      this.#throttleCheck,
      admin.email,
      meta,
    );
    const passed = await checkAdminSecondFactor(
      this.#secondFactor,
      admin.id,
      input.secondFactor,
      meta.now,
    );
    if (!passed) {
      await this.throttle.recordFailure(
        ADMIN_LOGIN_THROTTLE_SCOPE,
        keys,
        meta.now,
      );
      throw adminError('invalid_second_factor');
    }
    await this.challenges.delete(challenge.id);
    await this.throttle.reset(ADMIN_LOGIN_THROTTLE_SCOPE, keys);
    const session = await this.sessionIssuer.issue(admin.id, meta);
    return { adminId: admin.id, session };
  }

  async logout(principal: AuthenticatedPrincipal): Promise<void> {
    if (principal.subjectKind !== 'admin') {
      return;
    }
    await this.sessions.deleteOne(principal.subjectId, principal.sessionId);
  }

  async #issueChallenge(
    adminId: string,
    meta: AdminRequestMeta,
  ): Promise<AdminLoginChallengeIssued> {
    const secret = await this.secrets.issue(ADMIN_HASH_PURPOSES.loginChallenge);
    const expiresAt = new Date(
      meta.now.getTime() + ADMIN_LOGIN_CHALLENGE_TTL_SECONDS * MS_PER_SECOND,
    );
    await this.challenges.insert({
      id: this.ids.generate(),
      adminId,
      tokenHash: secret.hash,
      expiresAt,
    });
    return { adminId, challenge: secret.plain, expiresAt };
  }
}
