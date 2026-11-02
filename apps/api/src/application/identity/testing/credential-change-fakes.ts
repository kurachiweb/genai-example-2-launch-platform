import type { HashPurpose } from '../../../../lib/core/crypto/keyed-hasher.ts';
import type { DisposableEmailStatus } from '../../../../lib/core/identity/disposable-email.ts';
import { AppError } from '../../../../lib/core/errors/app-error.ts';
import type { PasswordIdentifiers } from '../../../domain/auth/password-rules.ts';
import { AUTH_TOKEN_HASH_PURPOSES } from '../../../domain/identity/auth-token-purpose.ts';
import type {
  NewPasswordValidation,
  PasswordPolicy,
} from '../../auth/password-policy.ts';
import type { PasswordHasher } from '../../auth/ports.ts';
import type { SecretIssuer } from '../../auth/secret-issuer.ts';
import type {
  AuthenticatedPrincipal,
  Principal,
} from '../../session/session-verifier.ts';
import type { CurrentUser } from '../account-guard.ts';
import type { DisposableEmailCheck } from '../disposable-email-check.ts';
import type {
  AuthTokenStore,
  ConsumedAuthToken,
  IdentityMailer,
  LimitedMailKind,
  MailSendLimits,
  NewAuthToken,
  UserAccountStore,
  UserRecord,
} from '../ports.ts';
import type {
  ReAuthenticationInput,
  ReAuthenticator,
} from '../re-authenticator.ts';
import type { RequestMeta } from '../request-meta.ts';
import type { IssuedSession, SessionIssuer } from '../session-issuer.ts';

export const NOW = new Date('2026-11-02T03:04:05.678Z');

export const MINUTE_MS = 60 * 1000;

export const HOUR_MS = 60 * MINUTE_MS;

export const USER_ID = '01JCHANGE00000000000000001';

export const OTHER_USER_ID = '01JCHANGE00000000000000002';

export const EMAIL = 'Taro.Yamada@mail.example';

export const NEW_EMAIL = 'taro.new@mail.example';

export const TOKEN = 'plain-credential-change-token';

export const NEW_PASSWORD = ['correct', 'horse', 'battery', 'staple'].join(' ');

export const RE_AUTHENTICATION: ReAuthenticationInput = {
  currentPassword: ['current', 'horse', 'battery', 'staple'].join(' '),
  secondFactor: { kind: 'totp', code: ['123', '456'].join('') },
};

export const META: RequestMeta = {
  clientIp: '192.0.2.10',
  userAgent: 'Mozilla/5.0',
  now: NOW,
};

export const SAME_USER_OPERATOR: AuthenticatedPrincipal = {
  kind: 'authenticated',
  subjectKind: 'user',
  subjectId: USER_ID,
  sessionId: '01JSESSION0000000000000001',
};

export const ANONYMOUS_OPERATOR: Principal = { kind: 'anonymous' };

export const REISSUED_SESSION: IssuedSession = {
  sessionId: '01JSESSION0000000000000009',
  token: 'reissued-session-token',
  maxAgeSeconds: 2_592_000,
};

export const INVALID_LINK = {
  kind: 'unprocessable',
  code: 'invalid_link',
  message: 'このリンクは無効か、有効期限が切れています。',
} as const;

export const RATE_LIMITED = new AppError({
  kind: 'rate_limited',
  code: 'rate_limit_exceeded',
  message: '操作が集中しています。しばらく待ってから再度お試しください。',
  retryAfterSeconds: 1200,
});

export const REAUTHENTICATION_FAILED = new AppError({
  kind: 'unprocessable',
  code: 'reauthentication_failed',
  message: '現在のパスワードが正しくありません。',
  details: [
    {
      field: 'currentPassword',
      code: 'incorrect',
      message: '現在のパスワードが正しくありません。',
    },
  ],
});

export function userOf(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: USER_ID,
    status: 'active',
    emailVerifiedAt: new Date('2026-10-01T00:00:00.000Z'),
    deletedAt: null,
    pseudonymousId: '0b9c6f0e-6a55-4a1f-9d4e-2f3c5b7a8d91',
    email: EMAIL,
    passwordHash: 'pbkdf2-sha512$100000$salt$derived',
    nickname: 'やまだ たろう',
    handle: 'taroyamada01',
    disposableEmailStatus: 'regular',
    termsAgreedAt: new Date('2026-09-01T00:00:00.000Z'),
    lifecycleVersion: 0,
    ...overrides,
  };
}

export const currentOf = (user: UserRecord = userOf()): CurrentUser => ({
  principal: { ...SAME_USER_OPERATOR, subjectId: user.id },
  user,
});

export const hashOfPlain = (purpose: HashPurpose, plain: string): string =>
  `hashed(${purpose}):${plain}`;

export const storedHashOf = (password: string): string => `stored(${password})`;

export const EMAIL_CHANGE_PURPOSE = AUTH_TOKEN_HASH_PURPOSES.email_change;

export const PASSWORD_CHANGE_PURPOSE = AUTH_TOKEN_HASH_PURPOSES.password_change;

export const EMAIL_CHANGE_TOKEN: NewAuthToken = {
  userId: USER_ID,
  purpose: 'email_change',
  tokenHash: hashOfPlain(EMAIL_CHANGE_PURPOSE, TOKEN),
  expiresAt: new Date(NOW.getTime() + HOUR_MS),
  newEmail: NEW_EMAIL,
};

export const PENDING_PASSWORD_HASH = storedHashOf(NEW_PASSWORD);

export const PASSWORD_CHANGE_TOKEN: NewAuthToken = {
  userId: USER_ID,
  purpose: 'password_change',
  tokenHash: hashOfPlain(PASSWORD_CHANGE_PURPOSE, TOKEN),
  expiresAt: new Date(NOW.getTime() + 10 * MINUTE_MS),
  pendingPasswordHash: PENDING_PASSWORD_HASH,
};

export const NOT_CONFIRMABLE_USERS = [
  ['存在しない', undefined],
  ['退会済み', userOf({ deletedAt: new Date('2026-11-01T00:00:00.000Z') })],
  ['停止中', userOf({ status: 'suspended' })],
] as const;

export interface CredentialChangeFakeOptions {
  readonly user?: UserRecord | undefined;
  readonly tokens?: readonly NewAuthToken[];
  readonly reAuthError?: Error;
  readonly limitError?: Error;
  readonly emailInUse?: boolean;
  readonly emailChangeOutcome?: 'changed' | 'email-in-use';
  readonly validation?: NewPasswordValidation;
  readonly mailError?: Error;
  readonly applyError?: Error;
  readonly disposableError?: Error;
  readonly reissued?: IssuedSession | undefined;
}

interface MailRecord {
  readonly method: keyof IdentityMailer;
  readonly args: readonly unknown[];
}

export interface CredentialChangeRecorded {
  readonly calls: string[];
  readonly reAuthentications: {
    readonly user: UserRecord;
    readonly input: ReAuthenticationInput;
    readonly meta: RequestMeta;
  }[];
  readonly limits: {
    readonly kind: LimitedMailKind;
    readonly address: string;
    readonly meta: RequestMeta;
  }[];
  readonly emailInUseChecks: {
    readonly email: string;
    readonly exceptUserId: string | undefined;
  }[];
  readonly issued: { readonly purpose: HashPurpose; readonly plain: string }[];
  readonly hashed: { readonly purpose: HashPurpose; readonly plain: string }[];
  readonly policyChecks: {
    readonly password: string;
    readonly identifiers: PasswordIdentifiers;
  }[];
  readonly passwordHashes: string[];
  readonly emailChanges: {
    readonly userId: string;
    readonly newEmail: string;
    readonly at: Date;
  }[];
  readonly passwordChanges: {
    readonly userId: string;
    readonly passwordHash: string;
  }[];
  readonly disposableChecks: {
    readonly user: UserRecord;
    readonly at: Date;
  }[];
  readonly reissues: {
    readonly userId: string;
    readonly operator: Principal;
    readonly meta: RequestMeta;
  }[];
  readonly mails: MailRecord[];
}

// 使わないメソッドを呼んだら失敗させ、ユースケースが想定外のポートに触れたことを検出する
function partialFake<T extends object>(implemented: Partial<T>): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      return () => {
        throw new Error(`この偽物では使わない: ${String(property)}`);
      };
    },
  }) as T;
}

const settle = <T>(error: Error | undefined, value: T): Promise<T> =>
  error === undefined ? Promise.resolve(value) : Promise.reject(error);

function createAccountStore(
  recorded: CredentialChangeRecorded,
  options: CredentialChangeFakeOptions,
): UserAccountStore {
  const user = 'user' in options ? options.user : userOf();
  return partialFake<UserAccountStore>({
    findById(userId) {
      recorded.calls.push('users.findById');
      return Promise.resolve(user?.id === userId ? user : undefined);
    },
    isEmailInUse(email, exceptUserId) {
      recorded.calls.push('users.isEmailInUse');
      recorded.emailInUseChecks.push({ email, exceptUserId });
      return Promise.resolve(options.emailInUse ?? false);
    },
    applyEmailChange(userId, newEmail, at) {
      recorded.calls.push('users.applyEmailChange');
      recorded.emailChanges.push({ userId, newEmail, at });
      return settle(
        options.applyError,
        options.emailChangeOutcome ?? 'changed',
      );
    },
    applyPasswordChange(userId, passwordHash) {
      recorded.calls.push('users.applyPasswordChange');
      recorded.passwordChanges.push({ userId, passwordHash });
      return settle(options.applyError, undefined);
    },
  });
}

const consumedOf = (token: NewAuthToken): ConsumedAuthToken => ({
  userId: token.userId,
  newEmail: token.newEmail ?? null,
  pendingPasswordHash: token.pendingPasswordHash ?? null,
});

function createTokenStore(
  recorded: CredentialChangeRecorded,
  stored: NewAuthToken[],
): AuthTokenStore {
  return partialFake<AuthTokenStore>({
    replace(token) {
      recorded.calls.push('tokens.replace');
      const kept = stored.filter(
        (existing) =>
          existing.userId !== token.userId ||
          existing.purpose !== token.purpose,
      );
      stored.splice(0, stored.length, ...kept, token);
      return Promise.resolve();
    },
    consume(purpose, tokenHash, now) {
      recorded.calls.push('tokens.consume');
      const index = stored.findIndex(
        (token) =>
          token.purpose === purpose &&
          token.tokenHash === tokenHash &&
          token.expiresAt.getTime() > now.getTime(),
      );
      const [found] = index < 0 ? [] : stored.splice(index, 1);
      return Promise.resolve(
        found === undefined ? undefined : consumedOf(found),
      );
    },
  });
}

function createSecurityFakes(
  recorded: CredentialChangeRecorded,
  options: CredentialChangeFakeOptions,
) {
  const reAuthenticator: ReAuthenticator = {
    verify(user, input, meta) {
      recorded.calls.push('reAuthenticator.verify');
      recorded.reAuthentications.push({ user, input, meta });
      return settle(options.reAuthError, undefined);
    },
  };
  const secrets: SecretIssuer = {
    issue(purpose) {
      recorded.calls.push('secrets.issue');
      const plain = `issued-secret-${String(recorded.issued.length + 1)}`;
      recorded.issued.push({ purpose, plain });
      return Promise.resolve({ plain, hash: hashOfPlain(purpose, plain) });
    },
    hashOf(purpose, plain) {
      recorded.calls.push('secrets.hashOf');
      recorded.hashed.push({ purpose, plain });
      return Promise.resolve(hashOfPlain(purpose, plain));
    },
  };
  const passwordPolicy: PasswordPolicy = {
    validateNewPassword(password, identifiers) {
      recorded.calls.push('policy.validateNewPassword');
      recorded.policyChecks.push({ password, identifiers });
      return Promise.resolve(
        options.validation ?? { ok: true, pwnedCheck: 'checked' },
      );
    },
  };
  const passwordHasher = partialFake<PasswordHasher>({
    hash(password) {
      recorded.calls.push('password.hash');
      const hash = storedHashOf(password);
      recorded.passwordHashes.push(hash);
      return Promise.resolve(hash);
    },
  });
  return { reAuthenticator, secrets, passwordPolicy, passwordHasher };
}

function createMailFakes(
  recorded: CredentialChangeRecorded,
  options: CredentialChangeFakeOptions,
) {
  const mailLimits: MailSendLimits = {
    consume(kind, address, meta) {
      recorded.calls.push('limits.consume');
      recorded.limits.push({ kind, address, meta });
      return settle(options.limitError, undefined);
    },
  };
  const send =
    (method: keyof IdentityMailer) =>
    (...args: readonly unknown[]): Promise<void> => {
      recorded.calls.push(`mailer.${method}`);
      recorded.mails.push({ method, args });
      return settle(options.mailError, undefined);
    };
  const mailer = partialFake<IdentityMailer>({
    sendEmailChangeConfirmation: send('sendEmailChangeConfirmation'),
    sendEmailChanged: send('sendEmailChanged'),
    sendPasswordChangeConfirmation: send('sendPasswordChangeConfirmation'),
    sendPasswordChanged: send('sendPasswordChanged'),
  });
  return { mailLimits, mailer };
}

function createFollowUpFakes(
  recorded: CredentialChangeRecorded,
  options: CredentialChangeFakeOptions,
) {
  const disposableCheck: DisposableEmailCheck = {
    checkAndSave(user, at) {
      recorded.calls.push('disposable.checkAndSave');
      recorded.disposableChecks.push({ user, at });
      return settle<DisposableEmailStatus>(options.disposableError, 'regular');
    },
  };
  const sessionIssuer = partialFake<SessionIssuer>({
    reissueForOperator(userId, operator, meta) {
      recorded.calls.push('sessions.reissueForOperator');
      recorded.reissues.push({ userId, operator, meta });
      return Promise.resolve(
        'reissued' in options ? options.reissued : REISSUED_SESSION,
      );
    },
  });
  return { disposableCheck, sessionIssuer };
}

export function createCredentialChangeFakes(
  options: CredentialChangeFakeOptions,
  defaultTokens: readonly NewAuthToken[],
) {
  const recorded: CredentialChangeRecorded = {
    calls: [],
    reAuthentications: [],
    limits: [],
    emailInUseChecks: [],
    issued: [],
    hashed: [],
    policyChecks: [],
    passwordHashes: [],
    emailChanges: [],
    passwordChanges: [],
    disposableChecks: [],
    reissues: [],
    mails: [],
  };
  const stored = [...(options.tokens ?? defaultTokens)];
  return {
    recorded,
    stored,
    users: createAccountStore(recorded, options),
    tokens: createTokenStore(recorded, stored),
    ...createSecurityFakes(recorded, options),
    ...createMailFakes(recorded, options),
    ...createFollowUpFakes(recorded, options),
  };
}

export async function caught(action: Promise<unknown>): Promise<AppError> {
  try {
    await action;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('例外が発生しませんでした。');
}

export async function rejectionOf(action: Promise<unknown>): Promise<unknown> {
  return action.then(
    () => {
      throw new Error('例外が発生しませんでした。');
    },
    (error: unknown) => error,
  );
}

export const shapeOf = (error: AppError) => ({
  kind: error.kind,
  code: error.code,
  message: error.message,
});
