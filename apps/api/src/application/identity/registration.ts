import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import {
  GENERATED_HANDLE_ALPHABET,
  GENERATED_HANDLE_LENGTH,
} from '../../domain/identity/handle.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { PasswordPolicy } from '../auth/password-policy.ts';
import type { PasswordHasher, SecretGenerator } from '../auth/ports.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import { prepareAuthToken } from './auth-token-issuance.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import { passwordRejectedError } from './password-rejection.ts';
import type {
  HandleAvailability,
  IdentityMailer,
  MailSendLimits,
  NewAuthToken,
  NewSessionRecord,
  NewUserRecord,
  UserAccountStore,
  UserRecord,
} from './ports.ts';
import type { RequestMeta } from './request-meta.ts';
import { type IssuedSession, prepareUserSession } from './session-issuer.ts';

export interface RegisterUserCommand {
  // 検証済みのもの
  readonly nickname: string;
  readonly email: string;
  readonly password: string;
  readonly agreedToTerms: true;
}

export interface RegistrationResult {
  readonly userId: string;
  readonly session: IssuedSession;
}

export interface Registration {
  register(
    command: RegisterUserCommand,
    meta: RequestMeta,
  ): Promise<RegistrationResult>;
}

// 事前の重複判定と、同時の作成による保存時の衝突を合わせた候補の数
export const HANDLE_GENERATION_ATTEMPTS = 5;

interface HandleCandidates {
  next(): Promise<string>;
}

// 作成直後の利用者の版はテーブルの既定値と同じ
const INITIAL_LIFECYCLE_VERSION = 0;

const EMAIL_UNAVAILABLE_MESSAGE = 'このメールアドレスは登録できません。';

const logger = getAppLogger(['api', 'identity', 'registration']);

const emailUnavailableError = (): AppError =>
  new AppError({
    kind: 'conflict',
    code: 'registration_email_unavailable',
    message: EMAIL_UNAVAILABLE_MESSAGE,
  });

const createdUserRecord = (user: NewUserRecord): UserRecord => ({
  ...user,
  status: 'active',
  emailVerifiedAt: null,
  deletedAt: null,
  disposableEmailStatus: null,
  lifecycleVersion: INITIAL_LIFECYCLE_VERSION,
});

@injectable()
export class StoreRegistration implements Registration {
  constructor(
    @inject(IDENTITY_TYPES.MailSendLimits)
    private readonly mailLimits: MailSendLimits,
    @inject(IDENTITY_TYPES.UserAccountStore)
    private readonly users: UserAccountStore,
    @inject(IDENTITY_TYPES.HandleAvailability)
    private readonly handles: HandleAvailability,
    @inject(AUTH_TYPES.SecretGenerator)
    private readonly generator: SecretGenerator,
    @inject(AUTH_TYPES.PasswordPolicy)
    private readonly passwordPolicy: PasswordPolicy,
    @inject(AUTH_TYPES.PasswordHasher)
    private readonly passwordHasher: PasswordHasher,
    @inject(AUTH_TYPES.SecretIssuer)
    private readonly secrets: SecretIssuer,
    @inject(PLATFORM_TYPES.IdGenerator)
    private readonly ids: IdGenerator,
    @inject(IDENTITY_TYPES.IdentityMailer)
    private readonly mailer: IdentityMailer,
  ) {}

  async register(
    command: RegisterUserCommand,
    meta: RequestMeta,
  ): Promise<RegistrationResult> {
    const email = trimWhiteSpace(command.email);
    const nickname = trimWhiteSpace(command.nickname);
    // アカウントの有無やメールアドレスの重複を応答の違いから推測させないよう、判定より前に数える
    await this.mailLimits.consume('email_verification', email, meta);
    if (await this.users.isEmailInUse(email)) {
      throw emailUnavailableError();
    }
    const handleCandidates = this.#handleCandidates();
    const handle = await handleCandidates.next();
    const validation = await this.passwordPolicy.validateNewPassword(
      command.password,
      { handle, nickname, email },
    );
    if (!validation.ok) {
      throw passwordRejectedError(validation.violation);
    }
    const passwordHash = await this.passwordHasher.hash(command.password);
    const userId = this.ids.generate();
    const [verification, session] = await Promise.all([
      prepareAuthToken(this.secrets, userId, 'email_verification', meta.now),
      prepareUserSession(this.secrets, this.ids, userId, meta),
    ]);
    const user = await this.#createUser(
      {
        id: userId,
        pseudonymousId: this.generator.uuid(),
        email,
        passwordHash,
        nickname,
        handle,
        termsAgreedAt: meta.now,
      },
      verification.token,
      session.record,
      handleCandidates,
    );
    await this.#sendVerification(
      user,
      verification.plain,
      verification.token.expiresAt,
    );
    return { userId, session: session.issued };
  }

  async #createUser(
    initial: NewUserRecord,
    token: NewAuthToken,
    session: NewSessionRecord,
    handleCandidates: HandleCandidates,
  ): Promise<UserRecord> {
    let user = initial;
    for (;;) {
      const result = await this.users.createWithVerification(
        user,
        token,
        session,
      );
      if (result === 'created') {
        return createdUserRecord(user);
      }
      if (result === 'email-in-use') {
        throw emailUnavailableError();
      }
      user = { ...user, handle: await handleCandidates.next() };
    }
  }

  // 候補の数は事前の確認と保存時の衝突で共有し、使い切ったら想定外の失敗として投げる
  #handleCandidates(): HandleCandidates {
    let generated = 0;
    const next = async (): Promise<string> => {
      while (generated < HANDLE_GENERATION_ATTEMPTS) {
        generated += 1;
        const candidate = this.generator.randomString(
          GENERATED_HANDLE_LENGTH,
          GENERATED_HANDLE_ALPHABET,
        );
        if (await this.handles.isAvailable(candidate)) {
          return candidate;
        }
      }
      throw new Error(
        `重複しないハンドルを${String(HANDLE_GENERATION_ATTEMPTS)}回の生成で決められませんでした。`,
      );
    };
    return { next };
  }

  async #sendVerification(
    user: UserRecord,
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    try {
      await this.mailer.sendEmailVerification(user, token, expiresAt);
    } catch (error: unknown) {
      // 利用者は作成済みでログインもできるため、確認メールは未確認の帯からの再送で取り戻せる
      logger.error('登録の確認メールの送信を要求できませんでした', {
        error,
        userId: user.id,
      });
    }
  }
}
