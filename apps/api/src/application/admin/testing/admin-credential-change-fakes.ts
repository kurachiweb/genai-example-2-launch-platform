import { AppError } from '../../../../lib/core/errors/app-error.ts';
import type { HashPurpose } from '../../../../lib/core/crypto/keyed-hasher.ts';
import { ADMIN_HASH_PURPOSES } from '../../../domain/admin/admin-auth-token-purpose.ts';
import type { PasswordIdentifiers } from '../../../domain/auth/password-rules.ts';
import type {
  NewPasswordValidation,
  PasswordPolicy,
} from '../../auth/password-policy.ts';
import type { PasswordHasher } from '../../auth/ports.ts';
import { currentPasswordIncorrectError } from '../../auth/re-authentication.ts';
import type { SecretIssuer } from '../../auth/secret-issuer.ts';
import type {
  AuthenticatedPrincipal,
  Principal,
} from '../../session/session-verifier.ts';
import type { CurrentAdmin } from '../admin-authorizer.ts';
import {
  type AdminEmailChange,
  StoreAdminEmailChange,
} from '../admin-email-change.ts';
import {
  type AdminPasswordChange,
  StoreAdminPasswordChange,
} from '../admin-password-change.ts';
import {
  type AdminPasswordReset,
  StoreAdminPasswordReset,
} from '../admin-password-reset.ts';
import type {
  AdminReAuthenticationInput,
  AdminReAuthenticator,
} from '../admin-re-authenticator.ts';
import type { AdminSessionIssuer } from '../admin-session-issuer.ts';
import type {
  AdminAccountStore,
  AdminAuthTokenStore,
  AdminLimitedMailKind,
  AdminMailer,
  AdminMailSendLimits,
  AdminRecord,
  AdminRequestMeta,
  ConsumedAdminAuthToken,
  IssuedAdminSession,
  NewAdminAuthToken,
} from '../ports.ts';

export const NOW = new Date('2026-11-03T03:04:05.678Z');

export const MINUTE_MS = 60 * 1000;

export const HOUR_MS = 60 * MINUTE_MS;

export const ADMIN_ID = '01JCRED000000000000000001';

export const OTHER_ADMIN_ID = '01JCRED000000000000000002';

export const EMAIL = 'Hanako.Admin@mail.example';

export const OTHER_EMAIL = 'other.admin@mail.example';

export const NEW_EMAIL = 'hanako.new@mail.example';

export const NICKNAME = 'はなこ';

export const TOKEN = 'plain-admin-credential-token';

export const NEW_PASSWORD = ['violet', 'otter', 'kettle', 'harbor'].join(' ');

export const RE_AUTHENTICATION: AdminReAuthenticationInput = {
  currentPassword: ['current', 'otter', 'kettle', 'harbor'].join(' '),
  secondFactor: { kind: 'totp', code: ['246', '813'].join('') },
};

export const META: AdminRequestMeta = {
  clientIp: '192.0.2.40',
  userAgent: 'Mozilla/5.0',
  now: NOW,
};

export const SAME_ADMIN_OPERATOR: AuthenticatedPrincipal = {
  kind: 'authenticated',
  subjectKind: 'admin',
  subjectId: ADMIN_ID,
  sessionId: '01JCREDSESN000000000000001',
};

export const ANONYMOUS_OPERATOR: Principal = { kind: 'anonymous' };

export const ISSUED_SESSION: IssuedAdminSession = {
  sessionId: '01JCREDSESN000000000000009',
  token: 'issued-admin-session-token',
  maxAgeSeconds: 3600,
};

export const INVALID_LINK = {
  kind: 'unprocessable',
  code: 'invalid_link',
  message: 'このリンクは無効か、有効期限が切れています。',
} as const;

export const UNAUTHENTICATED = {
  kind: 'unauthenticated',
  code: 'unauthenticated',
  message: 'ログインが必要です。',
} as const;

export const RATE_LIMITED = new AppError({
  kind: 'rate_limited',
  code: 'rate_limit_exceeded',
  message: '操作が集中しています。しばらく待ってから再度お試しください。',
  retryAfterSeconds: 1200,
});

export const REAUTHENTICATION_FAILED = currentPasswordIncorrectError();

export const storedHashOf = (password: string): string => `stored(${password})`;

export const hashOfPlain = (purpose: HashPurpose, plain: string): string =>
  `hashed(${purpose}):${plain}`;

export const PASSWORD_RESET_PURPOSE =
  ADMIN_HASH_PURPOSES.authToken('password_reset');

export const EMAIL_CHANGE_PURPOSE =
  ADMIN_HASH_PURPOSES.authToken('email_change');

export function adminOf(overrides: Partial<AdminRecord> = {}): AdminRecord {
  return {
    id: ADMIN_ID,
    role: 'moderator',
    status: 'active',
    invitationExpiresAt: null,
    email: EMAIL,
    passwordHash: storedHashOf(RE_AUTHENTICATION.currentPassword),
    nickname: NICKNAME,
    title: null,
    avatarFileId: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    activatedAt: new Date('2026-10-01T01:00:00.000Z'),
    ...overrides,
  };
}

export const invitedAdminOf = (
  overrides: Partial<AdminRecord> = {},
): AdminRecord =>
  adminOf({
    status: 'invited',
    invitationExpiresAt: new Date('2026-11-04T00:00:00.000Z'),
    passwordHash: null,
    nickname: null,
    activatedAt: null,
    ...overrides,
  });

export const currentAdminOf = (
  admin: AdminRecord = adminOf(),
): CurrentAdmin => ({
  id: admin.id,
  role: admin.role,
  nickname: admin.nickname ?? '',
  sessionId: SAME_ADMIN_OPERATOR.sessionId,
});

export const PASSWORD_RESET_TOKEN: NewAdminAuthToken = {
  adminId: ADMIN_ID,
  purpose: 'password_reset',
  tokenHash: hashOfPlain(PASSWORD_RESET_PURPOSE, TOKEN),
  expiresAt: new Date(NOW.getTime() + 30 * MINUTE_MS),
};

export const EMAIL_CHANGE_TOKEN: NewAdminAuthToken = {
  adminId: ADMIN_ID,
  purpose: 'email_change',
  tokenHash: hashOfPlain(EMAIL_CHANGE_PURPOSE, TOKEN),
  expiresAt: new Date(NOW.getTime() + 24 * HOUR_MS),
  newEmail: NEW_EMAIL,
};

export interface AdminCredentialChangeFakeOptions {
  readonly admins?: readonly AdminRecord[];
  readonly tokens?: readonly NewAdminAuthToken[];
  readonly reAuthError?: Error;
  readonly limitError?: Error;
  readonly emailChangeOutcome?: 'changed' | 'email-in-use';
  readonly validation?: NewPasswordValidation;
  readonly mailError?: Error;
  readonly applyError?: Error;
  readonly consumeLoses?: boolean;
  readonly reissued?: IssuedAdminSession | undefined;
}

interface MailRecord {
  readonly method: keyof AdminMailer;
  readonly args: readonly unknown[];
}

export interface AdminCredentialChangeRecorded {
  readonly calls: string[];
  readonly reAuthentications: {
    readonly admin: AdminRecord;
    readonly input: AdminReAuthenticationInput;
    readonly meta: AdminRequestMeta;
  }[];
  readonly limits: {
    readonly kind: AdminLimitedMailKind;
    readonly address: string;
    readonly meta: AdminRequestMeta;
  }[];
  readonly emailLookups: string[];
  readonly issued: { readonly purpose: HashPurpose; readonly plain: string }[];
  readonly hashed: { readonly purpose: HashPurpose; readonly plain: string }[];
  readonly policyChecks: {
    readonly password: string;
    readonly identifiers: PasswordIdentifiers;
  }[];
  readonly passwordResets: {
    readonly adminId: string;
    readonly passwordHash: string;
  }[];
  readonly emailChanges: {
    readonly adminId: string;
    readonly newEmail: string;
  }[];
  readonly passwordChanges: {
    readonly adminId: string;
    readonly passwordHash: string;
  }[];
  readonly sessionIssues: {
    readonly adminId: string;
    readonly meta: AdminRequestMeta;
  }[];
  readonly reissues: {
    readonly adminId: string;
    readonly operator: Principal;
    readonly meta: AdminRequestMeta;
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
  recorded: AdminCredentialChangeRecorded,
  options: AdminCredentialChangeFakeOptions,
): AdminAccountStore {
  const admins = options.admins ?? [adminOf()];
  return partialFake<AdminAccountStore>({
    findById(adminId) {
      recorded.calls.push('admins.findById');
      return Promise.resolve(admins.find((admin) => admin.id === adminId));
    },
    findByEmail(email) {
      recorded.calls.push('admins.findByEmail');
      recorded.emailLookups.push(email);
      return Promise.resolve(
        admins.find(
          (admin) => admin.email.toLowerCase() === email.toLowerCase(),
        ),
      );
    },
    applyPasswordReset(adminId, passwordHash) {
      recorded.calls.push('admins.applyPasswordReset');
      recorded.passwordResets.push({ adminId, passwordHash });
      return settle(options.applyError, undefined);
    },
    applyEmailChange(adminId, newEmail) {
      recorded.calls.push('admins.applyEmailChange');
      recorded.emailChanges.push({ adminId, newEmail });
      return settle(
        options.applyError,
        options.emailChangeOutcome ?? 'changed',
      );
    },
    applyPasswordChange(adminId, passwordHash) {
      recorded.calls.push('admins.applyPasswordChange');
      recorded.passwordChanges.push({ adminId, passwordHash });
      return settle(options.applyError, undefined);
    },
  });
}

const consumedOf = (token: NewAdminAuthToken): ConsumedAdminAuthToken => ({
  adminId: token.adminId,
  newEmail: token.newEmail ?? null,
});

function createTokenStore(
  recorded: AdminCredentialChangeRecorded,
  stored: NewAdminAuthToken[],
  options: AdminCredentialChangeFakeOptions,
): AdminAuthTokenStore {
  const indexOf = (
    purpose: NewAdminAuthToken['purpose'] | 'invitation',
    tokenHash: string,
    now: Date,
  ): number =>
    stored.findIndex(
      (token) =>
        token.purpose === purpose &&
        token.tokenHash === tokenHash &&
        token.expiresAt.getTime() > now.getTime(),
    );
  return partialFake<AdminAuthTokenStore>({
    replace(token) {
      recorded.calls.push('tokens.replace');
      const kept = stored.filter(
        (existing) =>
          existing.adminId !== token.adminId ||
          existing.purpose !== token.purpose,
      );
      stored.splice(0, stored.length, ...kept, token);
      return Promise.resolve();
    },
    findValid(purpose, tokenHash, now) {
      recorded.calls.push('tokens.findValid');
      const found = stored[indexOf(purpose, tokenHash, now)];
      return Promise.resolve(
        found === undefined ? undefined : consumedOf(found),
      );
    },
    consume(purpose, tokenHash, now) {
      recorded.calls.push('tokens.consume');
      const index = indexOf(purpose, tokenHash, now);
      const [found] = index < 0 ? [] : stored.splice(index, 1);
      if (found === undefined || options.consumeLoses === true) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(consumedOf(found));
    },
  });
}

function createSecurityFakes(
  recorded: AdminCredentialChangeRecorded,
  options: AdminCredentialChangeFakeOptions,
) {
  const reAuthenticator: AdminReAuthenticator = {
    verify(admin, input, meta) {
      recorded.calls.push('reAuthenticator.verify');
      recorded.reAuthentications.push({ admin, input, meta });
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
      return Promise.resolve(storedHashOf(password));
    },
  });
  return { reAuthenticator, secrets, passwordPolicy, passwordHasher };
}

function createMailFakes(
  recorded: AdminCredentialChangeRecorded,
  options: AdminCredentialChangeFakeOptions,
) {
  const mailLimits: AdminMailSendLimits = {
    consume(kind, address, meta) {
      recorded.calls.push('limits.consume');
      recorded.limits.push({ kind, address, meta });
      return settle(options.limitError, undefined);
    },
  };
  const send =
    (method: keyof AdminMailer) =>
    (...args: readonly unknown[]): Promise<void> => {
      recorded.calls.push(`mailer.${method}`);
      recorded.mails.push({ method, args });
      return settle(options.mailError, undefined);
    };
  const mailer = partialFake<AdminMailer>({
    sendPasswordReset: send('sendPasswordReset'),
    sendPasswordResetCompleted: send('sendPasswordResetCompleted'),
    sendEmailChangeConfirmation: send('sendEmailChangeConfirmation'),
    sendEmailChanged: send('sendEmailChanged'),
    sendPasswordChanged: send('sendPasswordChanged'),
  });
  return { mailLimits, mailer };
}

function createSessionIssuer(
  recorded: AdminCredentialChangeRecorded,
  options: AdminCredentialChangeFakeOptions,
): AdminSessionIssuer {
  return {
    issue(adminId, meta) {
      recorded.calls.push('sessions.issue');
      recorded.sessionIssues.push({ adminId, meta });
      return Promise.resolve(ISSUED_SESSION);
    },
    reissueForOperator(adminId, operator, meta) {
      recorded.calls.push('sessions.reissueForOperator');
      recorded.reissues.push({ adminId, operator, meta });
      return Promise.resolve(
        'reissued' in options ? options.reissued : ISSUED_SESSION,
      );
    },
  };
}

function createFakes(
  options: AdminCredentialChangeFakeOptions,
  defaultTokens: readonly NewAdminAuthToken[],
) {
  const recorded: AdminCredentialChangeRecorded = {
    calls: [],
    reAuthentications: [],
    limits: [],
    emailLookups: [],
    issued: [],
    hashed: [],
    policyChecks: [],
    passwordResets: [],
    emailChanges: [],
    passwordChanges: [],
    sessionIssues: [],
    reissues: [],
    mails: [],
  };
  const stored = [...(options.tokens ?? defaultTokens)];
  return {
    recorded,
    stored,
    admins: createAccountStore(recorded, options),
    tokens: createTokenStore(recorded, stored, options),
    sessionIssuer: createSessionIssuer(recorded, options),
    ...createSecurityFakes(recorded, options),
    ...createMailFakes(recorded, options),
  };
}

export function setupAdminPasswordReset(
  options: AdminCredentialChangeFakeOptions = {},
) {
  const fakes = createFakes(options, [PASSWORD_RESET_TOKEN]);
  const passwordReset: AdminPasswordReset = new StoreAdminPasswordReset(
    fakes.mailLimits,
    fakes.admins,
    fakes.tokens,
    fakes.secrets,
    fakes.passwordPolicy,
    fakes.passwordHasher,
    fakes.mailer,
  );
  return { passwordReset, recorded: fakes.recorded, stored: fakes.stored };
}

export function setupAdminEmailChange(
  options: AdminCredentialChangeFakeOptions = {},
) {
  const fakes = createFakes(options, [EMAIL_CHANGE_TOKEN]);
  const emailChange: AdminEmailChange = new StoreAdminEmailChange(
    fakes.reAuthenticator,
    fakes.mailLimits,
    fakes.admins,
    fakes.tokens,
    fakes.secrets,
    fakes.mailer,
    fakes.sessionIssuer,
  );
  return { emailChange, recorded: fakes.recorded, stored: fakes.stored };
}

export function setupAdminPasswordChange(
  options: AdminCredentialChangeFakeOptions = {},
) {
  const fakes = createFakes(options, []);
  const passwordChange: AdminPasswordChange = new StoreAdminPasswordChange(
    fakes.reAuthenticator,
    fakes.passwordPolicy,
    fakes.passwordHasher,
    fakes.admins,
    fakes.mailer,
    fakes.sessionIssuer,
  );
  return { passwordChange, recorded: fakes.recorded };
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
