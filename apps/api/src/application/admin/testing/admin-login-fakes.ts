import {
  createKeyedHasher,
  type HashPurpose,
  type KeyedHasher,
} from '../../../../lib/core/crypto/keyed-hasher.ts';
import {
  AppError,
  STATUS_BY_KIND,
} from '../../../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../../../lib/core/ids/id-generator.ts';
import { ADMIN_HASH_PURPOSES } from '../../../domain/admin/admin-auth-token-purpose.ts';
import type { ThrottleStatus } from '../../../domain/auth/login-throttle-state.ts';
import { createLoginThrottleKeys } from '../../auth/login-throttle-keys.ts';
import type {
  LoginThrottle,
  LoginThrottleKeys,
  LoginThrottleScope,
  PasswordHasher,
  SecretBox,
  SecretGenerator,
  TotpAuthenticator,
} from '../../auth/ports.ts';
import { HashingRecoveryCodeIssuer } from '../../auth/recovery-code-issuer.ts';
import type { SecretIssuer } from '../../auth/secret-issuer.ts';
import { type AdminLogin, StoreAdminLogin } from '../admin-login.ts';
import {
  type AdminReAuthenticator,
  StoreAdminReAuthenticator,
} from '../admin-re-authenticator.ts';
import type { AdminSessionIssuer } from '../admin-session-issuer.ts';
import type {
  AdminAccountStore,
  AdminLoginChallengeStore,
  AdminRecord,
  AdminRecoveryCodeStore,
  AdminRequestMeta,
  AdminSessionStore,
  AdminTotpCredential,
  AdminTotpCredentialStore,
  NewAdminLoginChallenge,
} from '../ports.ts';

export const ADMIN_LOGIN_NOW = new Date('2026-11-03T03:04:05.678Z');

export const PASSWORD = ['correct', 'horse', 'battery', 'staple'].join(' ');

export const WRONG_PASSWORD = ['wrong', 'horse', 'battery', 'staple'].join(' ');

export const VALID_CODE = ['123', '456'].join('');

export const RAW_RECOVERY_CODE = 'abcd'.repeat(4);

export const FORMATTED_RECOVERY_CODE = ['abcd', 'abcd', 'abcd', 'abcd'].join(
  '-',
);

export const ADMIN_ID = '01JC0ADMN00000000000000001';

export const ADMIN_EMAIL = 'admin1@mail.example';

export const ADMIN_LOGIN_META: AdminRequestMeta = {
  clientIp: '192.0.2.20',
  userAgent: 'Mozilla/5.0',
  now: ADMIN_LOGIN_NOW,
};

export const ISSUED_ADMIN_SESSION = Object.freeze({
  sessionId: '01JC0SESN00000000000000001',
  token: 'admin-session-token-1',
  maxAgeSeconds: 3600,
});

const TEST_PEPPER = ['admin', 'login', 'unit', 'test'].join('-');

const CURRENT_TOTP_SECRET = ['totp', 'secret', 'of', 'admin'].join('-');

const PENDING_TOTP_SECRET = ['pending', 'totp', 'secret'].join('-');

export const VALID_STEP = 59_000_000;

const storedHashOf = (password: string): string => `stored(${password})`;

const sealedOf = (secret: string, context: string): string =>
  `sealed(${secret}@${context})`;

export const baseAdmin = (
  overrides: Partial<AdminRecord> = {},
): AdminRecord => ({
  id: ADMIN_ID,
  role: 'moderator',
  status: 'active',
  invitationExpiresAt: null,
  email: ADMIN_EMAIL,
  passwordHash: storedHashOf(PASSWORD),
  nickname: '管理者1',
  title: null,
  avatarFileId: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  activatedAt: new Date('2026-10-01T00:00:00.000Z'),
  ...overrides,
});

// 招待の完了で確定した秘密鍵を、管理者の秘密鍵の文脈で封じたもの
export const ENABLED_ADMIN_TOTP: AdminTotpCredential = {
  sealedSecret: sealedOf(CURRENT_TOTP_SECRET, `admin:${ADMIN_ID}`),
  enabledAt: new Date('2026-10-01T00:00:00.000Z'),
  lastUsedStep: VALID_STEP - 1,
  pendingSealedSecret: null,
  pendingExpiresAt: null,
};

// 再設定の途中で、保留の秘密鍵だけが認証コードに一致する状態
export const RESETTING_ADMIN_TOTP: AdminTotpCredential = {
  ...ENABLED_ADMIN_TOTP,
  sealedSecret: sealedOf(PENDING_TOTP_SECRET, `admin:${ADMIN_ID}`),
  pendingSealedSecret: sealedOf(CURRENT_TOTP_SECRET, `admin:${ADMIN_ID}`),
  pendingExpiresAt: new Date('2026-11-03T03:10:00.000Z'),
};

// 利用者と同じく管理者のIDだけを文脈にして封じたもの。管理者の文脈では開けない
export const USER_CONTEXT_ADMIN_TOTP: AdminTotpCredential = {
  ...ENABLED_ADMIN_TOTP,
  sealedSecret: sealedOf(CURRENT_TOTP_SECRET, ADMIN_ID),
};

export interface ThrottleCall {
  readonly method: 'status' | 'recordFailure' | 'reset';
  readonly scope: LoginThrottleScope;
  readonly keys: LoginThrottleKeys;
}

export interface StoredAdminChallenge extends NewAdminLoginChallenge {
  readonly deleted: boolean;
}

export interface AdminLoginFakeOptions {
  readonly admins?: readonly AdminRecord[];
  readonly totp?: AdminTotpCredential | null;
  readonly recoveryRawCodes?: readonly string[];
  readonly throttleStatus?: ThrottleStatus;
}

const UNLOCKED: ThrottleStatus = { locked: false };

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

interface AdminLoginFakeState {
  readonly calls: string[];
  readonly throttleCalls: ThrottleCall[];
  readonly challenges: StoredAdminChallenge[];
  readonly issuedSessions: { adminId: string; meta: AdminRequestMeta }[];
  readonly deletedSessions: { adminId: string; sessionId: string }[];
  readonly openedContexts: string[];
  readonly admins: Map<string, AdminRecord>;
  readonly recoveryHashes: Set<string>;
  totpCredential: AdminTotpCredential | undefined;
  throttleStatus: ThrottleStatus;
  dummyChecks: number;
}

function createThrottle(state: AdminLoginFakeState): LoginThrottle {
  const record = (
    method: ThrottleCall['method'],
    scope: LoginThrottleScope,
    keys: LoginThrottleKeys,
  ): void => {
    state.calls.push(`throttle.${method}`);
    state.throttleCalls.push({ method, scope, keys });
  };
  return {
    status(scope, keys) {
      record('status', scope, keys);
      return Promise.resolve(state.throttleStatus);
    },
    recordFailure(scope, keys) {
      record('recordFailure', scope, keys);
      return Promise.resolve(UNLOCKED);
    },
    reset(scope, keys) {
      record('reset', scope, keys);
      return Promise.resolve();
    },
  };
}

function createAccountFakes(state: AdminLoginFakeState) {
  // ユースケース側が招待中を除くことを確かめるため、招待中の管理者も返す
  const admins = partialFake<AdminAccountStore>({
    findById(adminId) {
      state.calls.push('admins.findById');
      return Promise.resolve(state.admins.get(adminId));
    },
    findByEmail(email) {
      state.calls.push('admins.findByEmail');
      return Promise.resolve(
        [...state.admins.values()].find(
          (admin) => admin.email.toLowerCase() === email.toLowerCase(),
        ),
      );
    },
  });
  const passwordHasher = partialFake<PasswordHasher>({
    verify(password, stored) {
      state.calls.push('password.check');
      return Promise.resolve(stored === storedHashOf(password));
    },
    verifyAgainstDummy() {
      state.calls.push('password.check');
      state.dummyChecks += 1;
      return Promise.resolve(false);
    },
  });
  return { admins, passwordHasher };
}

function createSecondFactorFakes(state: AdminLoginFakeState) {
  const totpCredentials = partialFake<AdminTotpCredentialStore>({
    find(adminId) {
      state.calls.push('totpCredentials.find');
      return Promise.resolve(
        adminId === ADMIN_ID ? state.totpCredential : undefined,
      );
    },
    advanceStep(adminId, step) {
      state.calls.push('totpCredentials.advanceStep');
      const current = state.totpCredential;
      if (
        adminId !== ADMIN_ID ||
        current === undefined ||
        (current.lastUsedStep !== null && current.lastUsedStep >= step)
      ) {
        return Promise.resolve(false);
      }
      state.totpCredential = { ...current, lastUsedStep: step };
      return Promise.resolve(true);
    },
  });
  const secretBox = partialFake<SecretBox>({
    open(sealed, context) {
      state.calls.push('secretBox.open');
      state.openedContexts.push(context);
      const secret = [CURRENT_TOTP_SECRET, PENDING_TOTP_SECRET].find(
        (candidate) => sealed === sealedOf(candidate, context),
      );
      return secret === undefined
        ? Promise.reject(new Error('文脈が一致しない'))
        : Promise.resolve(secret);
    },
  });
  const totp = partialFake<TotpAuthenticator>({
    verify(secret, code) {
      state.calls.push('totp.verify');
      return secret === CURRENT_TOTP_SECRET && code === VALID_CODE
        ? { ok: true, step: VALID_STEP }
        : { ok: false };
    },
  });
  const recoveryCodes = partialFake<AdminRecoveryCodeStore>({
    consume(adminId, codeHash) {
      state.calls.push('recoveryCodes.consume');
      if (adminId !== ADMIN_ID || !state.recoveryHashes.has(codeHash)) {
        return Promise.resolve(false);
      }
      state.recoveryHashes.delete(codeHash);
      return Promise.resolve(true);
    },
  });
  return { totpCredentials, secretBox, totp, recoveryCodes };
}

function createChallengeStore(
  state: AdminLoginFakeState,
): AdminLoginChallengeStore {
  return partialFake<AdminLoginChallengeStore>({
    insert(challenge) {
      state.calls.push('challenges.insert');
      state.challenges.push({ ...challenge, deleted: false });
      return Promise.resolve();
    },
    findValid(tokenHash, now) {
      state.calls.push('challenges.findValid');
      const found = state.challenges.find(
        (challenge) =>
          !challenge.deleted &&
          challenge.tokenHash === tokenHash &&
          challenge.expiresAt.getTime() > now.getTime(),
      );
      return Promise.resolve(
        found === undefined
          ? undefined
          : { id: found.id, adminId: found.adminId },
      );
    },
    delete(id) {
      state.calls.push('challenges.delete');
      const index = state.challenges.findIndex(
        (challenge) => challenge.id === id,
      );
      const found = state.challenges[index];
      if (found !== undefined) {
        state.challenges[index] = { ...found, deleted: true };
      }
      return Promise.resolve();
    },
  });
}

function createSessionFakes(state: AdminLoginFakeState) {
  const sessionIssuer = partialFake<AdminSessionIssuer>({
    issue(adminId, meta) {
      state.calls.push('sessions.issue');
      state.issuedSessions.push({ adminId, meta });
      return Promise.resolve(ISSUED_ADMIN_SESSION);
    },
  });
  const sessions = partialFake<AdminSessionStore>({
    deleteOne(adminId, sessionId) {
      state.calls.push('sessions.deleteOne');
      state.deletedSessions.push({ adminId, sessionId });
      return Promise.resolve(true);
    },
  });
  return { sessionIssuer, sessions };
}

function createSecretFakes() {
  let issuedCount = 0;
  const secrets: SecretIssuer = {
    issue(purpose: HashPurpose) {
      issuedCount += 1;
      const plain = `challenge-plain-${String(issuedCount)}`;
      return Promise.resolve({ plain, hash: `hashed(${purpose}):${plain}` });
    },
    hashOf(purpose: HashPurpose, plain: string) {
      return Promise.resolve(`hashed(${purpose}):${plain}`);
    },
  };
  let sequence = 0;
  const ids: IdGenerator = {
    generate: () => `01JC0CHLG${String(sequence++).padStart(17, '0')}`,
  };
  return { secrets, ids };
}

async function createState(
  keyedHasher: KeyedHasher,
  options: AdminLoginFakeOptions,
): Promise<AdminLoginFakeState> {
  return {
    calls: [],
    dummyChecks: 0,
    throttleCalls: [],
    challenges: [],
    issuedSessions: [],
    deletedSessions: [],
    openedContexts: [],
    admins: new Map(
      (options.admins ?? [baseAdmin()]).map((admin) => [admin.id, admin]),
    ),
    recoveryHashes: new Set(
      await Promise.all(
        (options.recoveryRawCodes ?? []).map((raw) =>
          keyedHasher.hash(ADMIN_HASH_PURPOSES.recoveryCode, raw),
        ),
      ),
    ),
    totpCredential:
      options.totp === null ? undefined : (options.totp ?? ENABLED_ADMIN_TOTP),
    throttleStatus: options.throttleStatus ?? UNLOCKED,
  };
}

export async function setupAdminLogin(options: AdminLoginFakeOptions = {}) {
  const keyedHasher = createKeyedHasher(TEST_PEPPER);
  const state = await createState(keyedHasher, options);
  const { admins, passwordHasher } = createAccountFakes(state);
  const secondFactor = createSecondFactorFakes(state);
  const { sessionIssuer, sessions } = createSessionFakes(state);
  const { secrets, ids } = createSecretFakes();
  const login: AdminLogin = new StoreAdminLogin(
    keyedHasher,
    createThrottle(state),
    admins,
    passwordHasher,
    secrets,
    ids,
    createChallengeStore(state),
    sessionIssuer,
    sessions,
    secondFactor.totpCredentials,
    secondFactor.secretBox,
    secondFactor.totp,
    new HashingRecoveryCodeIssuer(
      partialFake<SecretGenerator>({}),
      keyedHasher,
    ),
    secondFactor.recoveryCodes,
  );

  return {
    login,
    state,
    keysFor: (email: string): Promise<LoginThrottleKeys> =>
      createLoginThrottleKeys(keyedHasher, email, ADMIN_LOGIN_META.clientIp),
    resetRecords(): void {
      state.calls.length = 0;
      state.throttleCalls.length = 0;
      state.openedContexts.length = 0;
    },
  };
}

export type AdminLoginFakes = Awaited<ReturnType<typeof setupAdminLogin>>;

export async function setupAdminReAuthenticator(
  options: AdminLoginFakeOptions = {},
) {
  const keyedHasher = createKeyedHasher(TEST_PEPPER);
  const state = await createState(keyedHasher, options);
  const { passwordHasher } = createAccountFakes(state);
  const secondFactor = createSecondFactorFakes(state);
  const reAuthenticator: AdminReAuthenticator = new StoreAdminReAuthenticator(
    keyedHasher,
    createThrottle(state),
    passwordHasher,
    secondFactor.totpCredentials,
    secondFactor.secretBox,
    secondFactor.totp,
    new HashingRecoveryCodeIssuer(
      partialFake<SecretGenerator>({}),
      keyedHasher,
    ),
    secondFactor.recoveryCodes,
  );

  return {
    reAuthenticator,
    state,
    keysFor: (email: string): Promise<LoginThrottleKeys> =>
      createLoginThrottleKeys(keyedHasher, email, ADMIN_LOGIN_META.clientIp),
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

export interface ErrorShape {
  readonly kind: string;
  readonly code: string;
  readonly message: string;
  readonly status: number;
  readonly retryAfterSeconds: number | undefined;
}

export const errorShape = (error: AppError): ErrorShape => ({
  kind: error.kind,
  code: error.code,
  message: error.message,
  status: STATUS_BY_KIND[error.kind],
  retryAfterSeconds: error.retryAfterSeconds,
});

export async function startAdminChallenge(
  fakes: AdminLoginFakes,
): Promise<string> {
  const { challenge } = await fakes.login.withPassword(
    { email: ADMIN_EMAIL, password: PASSWORD },
    ADMIN_LOGIN_META,
  );
  fakes.resetRecords();
  return challenge;
}
