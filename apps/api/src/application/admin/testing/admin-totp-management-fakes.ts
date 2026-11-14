import type { HashPurpose } from '../../../../lib/core/crypto/keyed-hasher.ts';
import type { SecretBox, TotpAuthenticator } from '../../auth/ports.ts';
import type { RecoveryCodeIssuer } from '../../auth/recovery-code-issuer.ts';
import type {
  AdminReAuthenticationInput,
  AdminReAuthenticator,
} from '../admin-re-authenticator.ts';
import type { AdminSessionIssuer } from '../admin-session-issuer.ts';
import type {
  AdminAccountStore,
  AdminRecord,
  AdminRecoveryCodeStore,
  AdminRequestMeta,
  AdminSettings,
  AdminTotpCredential,
  AdminTotpCredentialStore,
  AdminTotpPendingCommit,
} from '../ports.ts';
import {
  ADMIN_ID,
  adminOf,
  ISSUED_SESSION,
  MINUTE_MS,
  NOW,
} from './admin-credential-change-fakes.ts';

export const TOTP_ISSUER = 'Launch Stadium Admin local';

export const ADMIN_SECRET_CONTEXT = `admin:${ADMIN_ID}`;

export const CURRENT_SECRET = ['current', 'admin', 'secret'].join('-');

export const GENERATED_SECRET = ['generated', 'admin', 'secret'].join('-');

export const RESTARTED_SECRET = ['restarted', 'admin', 'secret'].join('-');

export const VALID_CODE = ['135', '790'].join('');

export const MATCHED_STEP = 59_000_321;

export const sealedOf = (
  secret: string,
  context: string = ADMIN_SECRET_CONTEXT,
): string => `sealed(${context}):${secret}`;

export const recoveryPlainOf = (index: number): string =>
  `admin-recovery-plain-${String(index)}`;

export const recoveryHashOf = (purpose: HashPurpose, plain: string): string =>
  `hashed(${purpose}):${plain}`;

export const ENABLED_CREDENTIAL: AdminTotpCredential = {
  sealedSecret: sealedOf(CURRENT_SECRET),
  enabledAt: new Date('2026-10-01T01:00:00.000Z'),
  lastUsedStep: 58_000_000,
  pendingSealedSecret: null,
  pendingExpiresAt: null,
};

export const resettingCredential = (
  overrides: Partial<AdminTotpCredential> = {},
): AdminTotpCredential => ({
  ...ENABLED_CREDENTIAL,
  pendingSealedSecret: sealedOf(GENERATED_SECRET),
  pendingExpiresAt: new Date(NOW.getTime() + 5 * MINUTE_MS),
  ...overrides,
});

export const EXISTING_RECOVERY_HASHES = [
  'old-admin-recovery-1',
  'old-admin-recovery-2',
];

export interface AdminTotpManagementFakeOptions {
  readonly admins?: readonly AdminRecord[];
  readonly credential?: AdminTotpCredential | undefined;
  readonly recoveryHashes?: readonly string[];
  readonly reAuthError?: Error;
  // 照合と入れ替えの間に、別の要求が再設定を始め直したことを再現する
  readonly restartedAfterFindWith?: string;
  // 本人確認の後、書き込みの前に、管理者が削除されて資格情報が消えたことを再現する
  readonly removedAfterReAuth?: boolean;
  readonly writeError?: Error;
}

export interface AdminTotpManagementRecorded {
  readonly calls: string[];
  readonly reAuthentications: {
    readonly admin: AdminRecord;
    readonly input: AdminReAuthenticationInput;
    readonly meta: AdminRequestMeta;
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
    readonly adminId: string;
    readonly sealedSecret: string;
    readonly expiresAt: Date;
  }[];
  readonly commits: {
    readonly adminId: string;
    readonly commit: AdminTotpPendingCommit;
  }[];
  readonly replacements: {
    readonly adminId: string;
    readonly hashes: readonly string[];
  }[];
  readonly recoveryIssues: HashPurpose[];
  readonly sessionDeletions: string[];
  readonly sessionIssues: {
    readonly adminId: string;
    readonly meta: AdminRequestMeta;
  }[];
}

export interface AdminTotpManagementState {
  credential: AdminTotpCredential | undefined;
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

// D1のストアと同じく、有効な設定に照合した秘密鍵の保留が期限内で残っているときだけ入れ替える
const isCommittable = (
  credential: AdminTotpCredential | undefined,
  commit: AdminTotpPendingCommit,
): credential is AdminTotpCredential =>
  credential !== undefined &&
  credential.enabledAt !== null &&
  credential.pendingSealedSecret === commit.pendingSealedSecret &&
  credential.pendingExpiresAt !== null &&
  credential.pendingExpiresAt.getTime() > commit.at.getTime();

function createTotpCredentialStore(
  recorded: AdminTotpManagementRecorded,
  state: AdminTotpManagementState,
  options: AdminTotpManagementFakeOptions,
): AdminTotpCredentialStore {
  return partialFake<AdminTotpCredentialStore>({
    find(adminId) {
      recorded.calls.push('totpCredentials.find');
      const found = adminId === ADMIN_ID ? state.credential : undefined;
      const restarted = options.restartedAfterFindWith;
      if (restarted !== undefined && state.credential !== undefined) {
        state.credential = {
          ...state.credential,
          pendingSealedSecret: sealedOf(restarted),
        };
      }
      return Promise.resolve(found);
    },
    savePending(adminId, sealedSecret, expiresAt) {
      recorded.calls.push('totpCredentials.savePending');
      recorded.pendings.push({ adminId, sealedSecret, expiresAt });
      if (options.writeError !== undefined) {
        return Promise.reject(options.writeError);
      }
      if (state.credential !== undefined) {
        state.credential = {
          ...state.credential,
          pendingSealedSecret: sealedSecret,
          pendingExpiresAt: expiresAt,
        };
      }
      return Promise.resolve();
    },
    commitPendingRevokingSessions(adminId, commit) {
      recorded.calls.push('totpCredentials.commitPendingRevokingSessions');
      recorded.commits.push({ adminId, commit });
      if (options.writeError !== undefined) {
        return Promise.reject(options.writeError);
      }
      const current = state.credential;
      if (adminId !== ADMIN_ID || !isCommittable(current, commit)) {
        return Promise.resolve('not-pending');
      }
      state.credential = {
        ...current,
        sealedSecret: commit.pendingSealedSecret,
        lastUsedStep: commit.step,
        pendingSealedSecret: null,
        pendingExpiresAt: null,
      };
      state.recoveryHashes = [...commit.recoveryHashes];
      recorded.sessionDeletions.push(adminId);
      return Promise.resolve('committed');
    },
  });
}

function createRecoveryCodeStore(
  recorded: AdminTotpManagementRecorded,
  state: AdminTotpManagementState,
  options: AdminTotpManagementFakeOptions,
): AdminRecoveryCodeStore {
  return partialFake<AdminRecoveryCodeStore>({
    replaceAllRevokingSessions(adminId, hashes) {
      recorded.calls.push('recoveryCodes.replaceAllRevokingSessions');
      recorded.replacements.push({ adminId, hashes });
      if (options.writeError !== undefined) {
        return Promise.reject(options.writeError);
      }
      if (adminId !== ADMIN_ID || state.credential?.enabledAt == null) {
        return Promise.resolve('not-enabled');
      }
      state.recoveryHashes = [...hashes];
      recorded.sessionDeletions.push(adminId);
      return Promise.resolve('replaced');
    },
  });
}

function createCryptoFakes(recorded: AdminTotpManagementRecorded) {
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
    // 認証アプリへ登録し終えた新しい秘密鍵でだけ一致させ、現在の秘密鍵での照合を一致させない
    verify(secret, code, now) {
      recorded.calls.push('totp.verify');
      recorded.verifications.push({ secret, code, now });
      return secret === GENERATED_SECRET && code === VALID_CODE
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

function createAccountStore(
  recorded: AdminTotpManagementRecorded,
  options: AdminTotpManagementFakeOptions,
): AdminAccountStore {
  const admins = options.admins ?? [adminOf()];
  return partialFake<AdminAccountStore>({
    findById(adminId) {
      recorded.calls.push('admins.findById');
      return Promise.resolve(admins.find((admin) => admin.id === adminId));
    },
  });
}

function createSessionIssuer(
  recorded: AdminTotpManagementRecorded,
): AdminSessionIssuer {
  return partialFake<AdminSessionIssuer>({
    issue(adminId, meta) {
      recorded.calls.push('sessions.issue');
      recorded.sessionIssues.push({ adminId, meta });
      return Promise.resolve(ISSUED_SESSION);
    },
  });
}

export function createAdminTotpManagementFakes(
  options: AdminTotpManagementFakeOptions = {},
) {
  const recorded: AdminTotpManagementRecorded = {
    calls: [],
    reAuthentications: [],
    sealed: [],
    opened: [],
    uris: [],
    verifications: [],
    pendings: [],
    commits: [],
    replacements: [],
    recoveryIssues: [],
    sessionDeletions: [],
    sessionIssues: [],
  };
  const state: AdminTotpManagementState = {
    credential:
      'credential' in options ? options.credential : ENABLED_CREDENTIAL,
    recoveryHashes: options.recoveryHashes ?? EXISTING_RECOVERY_HASHES,
  };
  const reAuthenticator: AdminReAuthenticator = {
    verify(admin, input, meta) {
      recorded.calls.push('reAuthenticator.verify');
      recorded.reAuthentications.push({ admin, input, meta });
      if (options.reAuthError !== undefined) {
        return Promise.reject(options.reAuthError);
      }
      if (options.removedAfterReAuth === true) {
        state.credential = undefined;
        state.recoveryHashes = [];
      }
      return Promise.resolve();
    },
  };
  const settings: AdminSettings = {
    adminOrigin: 'https://admin.launch-stadium.example',
    totpIssuer: TOTP_ISSUER,
  };
  return {
    recorded,
    state,
    reAuthenticator,
    settings,
    admins: createAccountStore(recorded, options),
    totpCredentials: createTotpCredentialStore(recorded, state, options),
    recoveryCodes: createRecoveryCodeStore(recorded, state, options),
    sessionIssuer: createSessionIssuer(recorded),
    ...createCryptoFakes(recorded),
  };
}
