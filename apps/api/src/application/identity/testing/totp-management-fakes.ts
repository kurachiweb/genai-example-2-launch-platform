import type { HashPurpose } from '../../../../lib/core/crypto/keyed-hasher.ts';
import { AppError } from '../../../../lib/core/errors/app-error.ts';
import type { SecretBox, TotpAuthenticator } from '../../auth/ports.ts';
import type { RecoveryCodeIssuer } from '../../auth/recovery-code-issuer.ts';
import type {
  IdentitySettings,
  RecoveryCodeStore,
  TotpCredential,
  TotpCredentialStore,
  UserSessionStore,
} from '../ports.ts';
import type {
  ReAuthenticationInput,
  ReAuthenticator,
} from '../re-authenticator.ts';
import type { RequestMeta } from '../request-meta.ts';
import type { IssuedSession, SessionIssuer } from '../session-issuer.ts';
import { NOW, USER_ID } from './credential-change-fakes.ts';

export const TOTP_ISSUER = 'Launch Stadium local';

export const GENERATED_SECRET = ['generated', 'totp', 'secret'].join('-');

export const OTHER_SECRET = ['other', 'totp', 'secret'].join('-');

export const VALID_CODE = ['123', '456'].join('');

export const MATCHED_STEP = 59_000_123;

export const sealedOf = (secret: string, context: string = USER_ID): string =>
  `sealed(${context}):${secret}`;

export const recoveryPlainOf = (index: number): string =>
  `recovery-plain-${String(index)}`;

export const recoveryHashOf = (purpose: HashPurpose, plain: string): string =>
  `hashed(${purpose}):${plain}`;

export const ISSUED_SESSION: IssuedSession = {
  sessionId: '01JSESSION0000000000000009',
  token: 'issued-session-token',
  maxAgeSeconds: 2_592_000,
};

export const ENABLED_CREDENTIAL: TotpCredential = {
  sealedSecret: sealedOf(OTHER_SECRET),
  enabledAt: new Date('2026-10-20T00:00:00.000Z'),
  pendingExpiresAt: null,
  lastUsedStep: 58_000_000,
};

export const pendingCredential = (
  overrides: Partial<TotpCredential> = {},
): TotpCredential => ({
  sealedSecret: sealedOf(GENERATED_SECRET),
  enabledAt: null,
  pendingExpiresAt: new Date(NOW.getTime() + 5 * 60 * 1000),
  lastUsedStep: null,
  ...overrides,
});

export const EXISTING_RECOVERY_HASHES = ['old-recovery-1', 'old-recovery-2'];

export interface TotpManagementFakeOptions {
  readonly credential?: TotpCredential | undefined;
  readonly recoveryHashes?: readonly string[];
  readonly reAuthError?: Error;
  // 照合と有効化の間に、別の要求が設定を始め直したことを再現する
  readonly restartedAfterFindWith?: string;
  // 開始の保存の直前に、別の要求が有効化を終えたことを再現する
  readonly enabledBeforeSave?: boolean;
  readonly deleteSessionsError?: Error;
}

export interface TotpManagementRecorded {
  readonly calls: string[];
  readonly reAuthentications: {
    readonly userId: string;
    readonly input: ReAuthenticationInput;
    readonly meta: RequestMeta;
  }[];
  readonly sealed: { readonly plaintext: string; readonly context: string }[];
  readonly opened: { readonly sealed: string; readonly context: string }[];
  readonly uris: {
    readonly secret: string;
    readonly issuer: string;
    readonly accountLabel: string;
  }[];
  readonly verifications: {
    readonly secret: string;
    readonly code: string;
    readonly now: Date;
  }[];
  readonly pendings: {
    readonly userId: string;
    readonly sealedSecret: string;
    readonly expiresAt: Date;
  }[];
  readonly enables: {
    readonly userId: string;
    readonly sealedSecret: string;
    readonly step: number;
    readonly at: Date;
    readonly recoveryHashes: readonly string[];
  }[];
  readonly recoveryIssues: HashPurpose[];
  readonly sessionDeletions: string[];
  readonly sessionIssues: {
    readonly userId: string;
    readonly meta: RequestMeta;
  }[];
}

export interface TotpManagementState {
  credential: TotpCredential | undefined;
  recoveryHashes: readonly string[];
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

const isValidPending = (
  credential: TotpCredential | undefined,
  at: Date,
): credential is TotpCredential & { readonly pendingExpiresAt: Date } =>
  credential !== undefined &&
  credential.enabledAt === null &&
  credential.pendingExpiresAt !== null &&
  credential.pendingExpiresAt.getTime() > at.getTime();

function createTotpCredentialStore(
  recorded: TotpManagementRecorded,
  state: TotpManagementState,
  options: TotpManagementFakeOptions,
): TotpCredentialStore {
  return partialFake<TotpCredentialStore>({
    find(userId) {
      recorded.calls.push('totpCredentials.find');
      const found = userId === USER_ID ? state.credential : undefined;
      const restarted = options.restartedAfterFindWith;
      if (restarted !== undefined && state.credential !== undefined) {
        state.credential = {
          ...state.credential,
          sealedSecret: sealedOf(restarted),
        };
      }
      return Promise.resolve(found);
    },
    savePending(userId, sealedSecret, expiresAt) {
      recorded.calls.push('totpCredentials.savePending');
      recorded.pendings.push({ userId, sealedSecret, expiresAt });
      if (options.enabledBeforeSave === true) {
        state.credential = ENABLED_CREDENTIAL;
      }
      if (state.credential?.enabledAt != null) {
        return Promise.resolve('already-enabled');
      }
      state.credential = {
        sealedSecret,
        enabledAt: null,
        pendingExpiresAt: expiresAt,
        lastUsedStep: null,
      };
      return Promise.resolve('saved');
    },
    enable(userId, sealedSecret, step, at, recoveryHashes) {
      recorded.calls.push('totpCredentials.enable');
      recorded.enables.push({ userId, sealedSecret, step, at, recoveryHashes });
      const current = state.credential;
      if (
        !isValidPending(current, at) ||
        current.sealedSecret !== sealedSecret
      ) {
        return Promise.resolve('not-pending');
      }
      state.credential = {
        ...current,
        enabledAt: at,
        pendingExpiresAt: null,
        lastUsedStep: step,
      };
      state.recoveryHashes = [...recoveryHashes];
      return Promise.resolve('enabled');
    },
    disable(userId) {
      recorded.calls.push('totpCredentials.disable');
      if (userId === USER_ID) {
        state.credential = undefined;
        state.recoveryHashes = [];
      }
      return Promise.resolve();
    },
  });
}

function createRecoveryCodeStore(
  recorded: TotpManagementRecorded,
  state: TotpManagementState,
): RecoveryCodeStore {
  return partialFake<RecoveryCodeStore>({
    replaceAll(userId, hashes) {
      recorded.calls.push('recoveryCodes.replaceAll');
      if (userId === USER_ID && state.credential?.enabledAt != null) {
        state.recoveryHashes = [...hashes];
      }
      return Promise.resolve();
    },
  });
}

function createCryptoFakes(recorded: TotpManagementRecorded) {
  const secretBox: SecretBox = {
    seal(plaintext, context) {
      recorded.calls.push('secretBox.seal');
      recorded.sealed.push({ plaintext, context });
      return Promise.resolve(sealedOf(plaintext, context));
    },
    open(sealed, context) {
      recorded.calls.push('secretBox.open');
      recorded.opened.push({ sealed, context });
      const prefix = `sealed(${context}):`;
      return sealed.startsWith(prefix)
        ? Promise.resolve(sealed.slice(prefix.length))
        : Promise.reject(new Error('文脈が一致しません'));
    },
  };
  const totp: TotpAuthenticator = {
    generateSecret() {
      recorded.calls.push('totp.generateSecret');
      return GENERATED_SECRET;
    },
    buildUri(secret, issuer, accountLabel) {
      recorded.calls.push('totp.buildUri');
      recorded.uris.push({ secret, issuer, accountLabel });
      return `otpauth://totp/${issuer}:${accountLabel}?secret=${secret}`;
    },
    verify(secret, code, now) {
      recorded.calls.push('totp.verify');
      recorded.verifications.push({ secret, code, now });
      return code === VALID_CODE
        ? { ok: true, step: MATCHED_STEP }
        : { ok: false };
    },
  };
  const recoveryCodeIssuer = partialFake<RecoveryCodeIssuer>({
    issue(purpose) {
      recorded.calls.push('recoveryCodeIssuer.issue');
      recorded.recoveryIssues.push(purpose);
      const plains = Array.from({ length: 10 }, (_, index) =>
        recoveryPlainOf(index + 1),
      );
      return Promise.resolve({
        plains,
        hashes: plains.map((plain) => recoveryHashOf(purpose, plain)),
      });
    },
  });
  return { secretBox, totp, recoveryCodeIssuer };
}

function createSessionFakes(
  recorded: TotpManagementRecorded,
  options: TotpManagementFakeOptions,
) {
  const sessions = partialFake<UserSessionStore>({
    deleteAllOfUser(userId) {
      recorded.calls.push('sessions.deleteAllOfUser');
      recorded.sessionDeletions.push(userId);
      return options.deleteSessionsError === undefined
        ? Promise.resolve()
        : Promise.reject(options.deleteSessionsError);
    },
  });
  const sessionIssuer = partialFake<SessionIssuer>({
    issue(userId, meta) {
      recorded.calls.push('sessionIssuer.issue');
      recorded.sessionIssues.push({ userId, meta });
      return Promise.resolve(ISSUED_SESSION);
    },
  });
  return { sessions, sessionIssuer };
}

export function createTotpManagementFakes(
  options: TotpManagementFakeOptions = {},
) {
  const recorded: TotpManagementRecorded = {
    calls: [],
    reAuthentications: [],
    sealed: [],
    opened: [],
    uris: [],
    verifications: [],
    pendings: [],
    enables: [],
    recoveryIssues: [],
    sessionDeletions: [],
    sessionIssues: [],
  };
  const state: TotpManagementState = {
    credential: options.credential,
    recoveryHashes: options.recoveryHashes ?? [],
  };
  const reAuthenticator: ReAuthenticator = {
    verify(user, input, meta) {
      recorded.calls.push('reAuthenticator.verify');
      recorded.reAuthentications.push({ userId: user.id, input, meta });
      return options.reAuthError === undefined
        ? Promise.resolve()
        : Promise.reject(options.reAuthError);
    },
  };
  const settings: IdentitySettings = {
    clientOrigin: 'http://localhost:48044',
    totpIssuer: TOTP_ISSUER,
  };
  return {
    recorded,
    state,
    reAuthenticator,
    settings,
    totpCredentials: createTotpCredentialStore(recorded, state, options),
    recoveryCodes: createRecoveryCodeStore(recorded, state),
    ...createCryptoFakes(recorded),
    ...createSessionFakes(recorded, options),
  };
}

export const REAUTHENTICATION_FAILED_ON_SECOND_FACTOR = new AppError({
  kind: 'unprocessable',
  code: 'reauthentication_failed',
  message: '認証コードが正しくありません。',
  details: [
    {
      field: 'secondFactor.totpCode',
      code: 'incorrect',
      message: '認証コードが正しくありません。',
    },
  ],
});
