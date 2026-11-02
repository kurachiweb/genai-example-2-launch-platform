import {
  createKeyedHasher,
  type HashPurpose,
} from '../../../../lib/core/crypto/keyed-hasher.ts';
import {
  AppError,
  STATUS_BY_KIND,
} from '../../../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../../../lib/core/ids/id-generator.ts';
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
import { type Login, StoreLogin } from '../login.ts';
import type {
  LoginChallengeStore,
  NewLoginChallenge,
  RecoveryCodeStore,
  TotpCredential,
  TotpCredentialStore,
  UserAccountStore,
  UserRecord,
  UserSessionStore,
} from '../ports.ts';
import type { RequestMeta } from '../request-meta.ts';
import { USER_RECOVERY_CODE_HASH_PURPOSE } from '../second-factor-check.ts';
import type { SessionIssuer } from '../session-issuer.ts';

export const LOGIN_NOW = new Date('2026-11-02T03:04:05.678Z');

export const PASSWORD = ['correct', 'horse', 'battery', 'staple'].join(' ');

export const WRONG_PASSWORD = ['wrong', 'horse', 'battery', 'staple'].join(' ');

export const VALID_CODE = ['123', '456'].join('');

export const RAW_RECOVERY_CODE = 'abcd'.repeat(4);

export const FORMATTED_RECOVERY_CODE = ['abcd', 'abcd', 'abcd', 'abcd'].join(
  '-',
);

export const USER_ID = '01JUSER000000000000000000A';

export const EMAIL = 'taro.yamada@mail.example';

export const LOGIN_META: RequestMeta = {
  clientIp: '192.0.2.10',
  userAgent: 'Mozilla/5.0',
  now: LOGIN_NOW,
};

const TEST_PEPPER = ['login', 'unit', 'test'].join('-');

const TOTP_SECRET = ['totp', 'secret', 'of', 'user'].join('-');

const VALID_STEP = 59_000_000;

const storedHashOf = (password: string): string => `stored(${password})`;

const sealedFor = (userId: string): string => `sealed(${userId})`;

export const baseUser = (overrides: Partial<UserRecord> = {}): UserRecord => ({
  id: USER_ID,
  status: 'active',
  emailVerifiedAt: new Date('2026-10-01T00:00:00.000Z'),
  deletedAt: null,
  pseudonymousId: '0b9c6f0e-6a55-4a1f-9d4e-2f3c5b7a8d91',
  email: EMAIL,
  passwordHash: storedHashOf(PASSWORD),
  nickname: 'やまだ たろう',
  handle: 'taroyamada01',
  disposableEmailStatus: 'regular',
  termsAgreedAt: new Date('2026-09-01T00:00:00.000Z'),
  lifecycleVersion: 0,
  ...overrides,
});

export const ENABLED_TOTP: TotpCredential = {
  sealedSecret: sealedFor(USER_ID),
  enabledAt: new Date('2026-10-01T00:00:00.000Z'),
  pendingExpiresAt: null,
  lastUsedStep: VALID_STEP - 1,
};

export const PENDING_TOTP: TotpCredential = {
  sealedSecret: sealedFor(USER_ID),
  enabledAt: null,
  pendingExpiresAt: new Date('2026-11-02T03:10:00.000Z'),
  lastUsedStep: null,
};

export interface ThrottleCall {
  readonly method: 'status' | 'recordFailure' | 'reset';
  readonly scope: LoginThrottleScope;
  readonly keys: LoginThrottleKeys;
}

export interface StoredChallenge extends NewLoginChallenge {
  readonly deleted: boolean;
}

export interface LoginFakeOptions {
  readonly users?: readonly UserRecord[];
  readonly totp?: TotpCredential;
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
        throw new Error(`ログインでは使わない: ${String(property)}`);
      };
    },
  }) as T;
}

interface LoginFakeState {
  readonly calls: string[];
  readonly throttleCalls: ThrottleCall[];
  readonly challenges: StoredChallenge[];
  readonly issuedSessions: { userId: string; meta: RequestMeta }[];
  readonly deletedSessions: { userId: string; sessionId: string }[];
  readonly users: Map<string, UserRecord>;
  readonly recoveryHashes: Set<string>;
  totpCredential: TotpCredential | undefined;
  throttleStatus: ThrottleStatus;
  dummyChecks: number;
}

function createThrottle(state: LoginFakeState): LoginThrottle {
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

function createAccountFakes(state: LoginFakeState) {
  const accounts = partialFake<UserAccountStore>({
    findById(userId) {
      state.calls.push('users.findById');
      return Promise.resolve(state.users.get(userId));
    },
    // ユースケース側が退会済みを除くことを確かめるため、退会済みの利用者も返す
    findNotWithdrawnByEmail(email) {
      state.calls.push('users.findNotWithdrawnByEmail');
      return Promise.resolve(
        [...state.users.values()].find(
          (user) => user.email.toLowerCase() === email.toLowerCase(),
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
  return { accounts, passwordHasher };
}

function createSecondFactorFakes(state: LoginFakeState) {
  const totpCredentials = partialFake<TotpCredentialStore>({
    find(userId) {
      state.calls.push('totpCredentials.find');
      return Promise.resolve(
        userId === USER_ID ? state.totpCredential : undefined,
      );
    },
    advanceStep(userId, step) {
      state.calls.push('totpCredentials.advanceStep');
      const current = state.totpCredential;
      if (
        userId !== USER_ID ||
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
      return sealed === sealedFor(context)
        ? Promise.resolve(TOTP_SECRET)
        : Promise.reject(new Error('文脈が一致しない'));
    },
  });
  const totp = partialFake<TotpAuthenticator>({
    verify(secret, code) {
      state.calls.push('totp.verify');
      return secret === TOTP_SECRET && code === VALID_CODE
        ? { ok: true, step: VALID_STEP }
        : { ok: false };
    },
  });
  const recoveryCodes = partialFake<RecoveryCodeStore>({
    consume(userId, codeHash) {
      state.calls.push('recoveryCodes.consume');
      if (userId !== USER_ID || !state.recoveryHashes.has(codeHash)) {
        return Promise.resolve(false);
      }
      state.recoveryHashes.delete(codeHash);
      return Promise.resolve(true);
    },
  });
  return { totpCredentials, secretBox, totp, recoveryCodes };
}

function createChallengeStore(state: LoginFakeState): LoginChallengeStore {
  return partialFake<LoginChallengeStore>({
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
          : { id: found.id, userId: found.userId },
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

function createSessionFakes(state: LoginFakeState) {
  const sessionIssuer = partialFake<SessionIssuer>({
    issue(userId, meta) {
      state.calls.push('sessions.issue');
      state.issuedSessions.push({ userId, meta });
      const count = String(state.issuedSessions.length);
      return Promise.resolve({
        sessionId: `01JSESSION${count.padStart(16, '0')}`,
        token: `session-token-${count}`,
        maxAgeSeconds: 2_592_000,
      });
    },
  });
  const userSessions = partialFake<UserSessionStore>({
    deleteOne(userId, sessionId) {
      state.calls.push('userSessions.deleteOne');
      state.deletedSessions.push({ userId, sessionId });
      return Promise.resolve(true);
    },
  });
  return { sessionIssuer, userSessions };
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
    generate: () => `01JCHALLENGE${String(sequence++).padStart(14, '0')}`,
  };
  return { secrets, ids };
}

export async function setupLogin(options: LoginFakeOptions = {}) {
  const keyedHasher = createKeyedHasher(TEST_PEPPER);
  const state: LoginFakeState = {
    calls: [],
    dummyChecks: 0,
    throttleCalls: [],
    challenges: [],
    issuedSessions: [],
    deletedSessions: [],
    users: new Map(
      (options.users ?? [baseUser()]).map((user) => [user.id, user]),
    ),
    recoveryHashes: new Set(
      await Promise.all(
        (options.recoveryRawCodes ?? []).map((raw) =>
          keyedHasher.hash(USER_RECOVERY_CODE_HASH_PURPOSE, raw),
        ),
      ),
    ),
    totpCredential: options.totp,
    throttleStatus: options.throttleStatus ?? UNLOCKED,
  };
  const { accounts, passwordHasher } = createAccountFakes(state);
  const secondFactor = createSecondFactorFakes(state);
  const { sessionIssuer, userSessions } = createSessionFakes(state);
  const { secrets, ids } = createSecretFakes();
  const login: Login = new StoreLogin(
    keyedHasher,
    createThrottle(state),
    accounts,
    passwordHasher,
    secondFactor.totpCredentials,
    secrets,
    ids,
    createChallengeStore(state),
    sessionIssuer,
    secondFactor.secretBox,
    secondFactor.totp,
    new HashingRecoveryCodeIssuer(
      partialFake<SecretGenerator>({}),
      keyedHasher,
    ),
    secondFactor.recoveryCodes,
    userSessions,
  );

  return {
    login,
    state,
    keysFor: (email: string): Promise<LoginThrottleKeys> =>
      createLoginThrottleKeys(keyedHasher, email, LOGIN_META.clientIp),
    resetRecords(): void {
      state.calls.length = 0;
      state.throttleCalls.length = 0;
    },
  };
}

export type LoginFakes = Awaited<ReturnType<typeof setupLogin>>;

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

export async function startChallenge(fakes: LoginFakes): Promise<string> {
  const result = await fakes.login.withPassword(
    { email: EMAIL, password: PASSWORD },
    LOGIN_META,
  );
  if (result.kind !== 'second-factor-required') {
    throw new Error('第2要素の待ちが発行されていません。');
  }
  fakes.resetRecords();
  return result.challenge;
}
