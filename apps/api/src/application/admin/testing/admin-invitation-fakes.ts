import type { AdminRole } from '../../../../common-lib/admin/admin-roles.ts';
import { createAuditActionCatalog } from '../../../../common-lib/admin/audit-action.ts';
import { AUDIT_ACTIONS } from '../../../../common-lib/admin/audit-actions/index.ts';
import type {
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../../lib/core/admin/audit-log.ts';
import type { CurrentAdmin } from '../../../../lib/core/admin/current-admin.ts';
import {
  createKeyedHasher,
  type HashPurpose,
  type KeyedHasher,
} from '../../../../lib/core/crypto/keyed-hasher.ts';
import type { IdGenerator } from '../../../../lib/core/ids/id-generator.ts';
import type { AdminAuthTokenPurpose } from '../../../domain/admin/admin-auth-token-purpose.ts';
import { CheckingPasswordPolicy } from '../../auth/password-policy.ts';
import type {
  AuthIncident,
  PasswordHasher,
  PwnedCheckResult,
  SecretBox,
  SecretGenerator,
  TotpAuthenticator,
} from '../../auth/ports.ts';
import { HashingRecoveryCodeIssuer } from '../../auth/recovery-code-issuer.ts';
import type { SecretIssuer } from '../../auth/secret-issuer.ts';
import {
  type AdminInvitation,
  StoreAdminInvitation,
} from '../admin-invitation.ts';
import { StoreAuditLogRecorder } from '../audit-log-recorder.ts';
import type {
  AdminAccountStore,
  AdminActivation,
  AdminAuthTokenStore,
  AdminMailer,
  AdminRecord,
  AdminRequestMeta,
  AdminTotpCredential,
  AdminTotpCredentialStore,
  AuditLogStore,
  NewAdminInvitationToken,
  NewInvitedAdmin,
} from '../ports.ts';

export const INVITATION_NOW = new Date('2026-11-03T03:04:05.678Z');

export const INVITATION_META: AdminRequestMeta = {
  clientIp: '192.0.2.30',
  userAgent: 'Mozilla/5.0',
  now: INVITATION_NOW,
};

export const OPERATOR_ID = '01JC0OPER00000000000000001';

export const INVITED_ID = '01JC0INVD00000000000000001';

export const INVITED_EMAIL = 'invited1@mail.example';

export const INVITATION_TOKEN = 'invitation-plain-token';

export const NEW_PASSWORD = ['purple', 'monkey', 'dishwasher', 'lamp'].join(
  ' ',
);

export const VALID_CODE = ['654', '321'].join('');

export const VALID_STEP = 59_000_123;

export const GENERATED_TOTP_SECRET = 'GENERATEDTOTPSECRETBASE32';

export const TOTP_ISSUER = 'Launch Stadium Admin local';

const TEST_PEPPER = ['admin', 'invitation', 'unit', 'test'].join('-');

export const storedHashOf = (password: string): string => `stored(${password})`;

export const sealedOf = (secret: string, context: string): string =>
  `sealed(${secret}@${context})`;

export const hashedOf = (purpose: string, plain: string): string =>
  `hashed(${purpose}):${plain}`;

export const currentAdmin = (role: AdminRole): CurrentAdmin => ({
  id: OPERATOR_ID,
  role,
  nickname: '操作者',
  sessionId: '01JC0SESN00000000000000009',
});

export const invitedAdmin = (
  overrides: Partial<AdminRecord> = {},
): AdminRecord => ({
  id: INVITED_ID,
  role: 'viewer',
  status: 'invited',
  invitationExpiresAt: new Date('2026-11-04T00:00:00.000Z'),
  email: INVITED_EMAIL,
  passwordHash: null,
  nickname: null,
  title: null,
  avatarFileId: null,
  createdAt: new Date('2026-11-03T00:00:00.000Z'),
  activatedAt: null,
  ...overrides,
});

export const activeAdmin = (
  overrides: Partial<AdminRecord> = {},
): AdminRecord =>
  invitedAdmin({
    status: 'active',
    invitationExpiresAt: null,
    passwordHash: storedHashOf('existing password'),
    nickname: '既存の管理者',
    activatedAt: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
  });

export interface StoredInvitationToken {
  readonly adminId: string;
  readonly purpose: AdminAuthTokenPurpose;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly consumed: boolean;
}

export interface InvitationFakeOptions {
  readonly admins?: readonly AdminRecord[];
  readonly tokens?: readonly StoredInvitationToken[];
  readonly totp?: AdminTotpCredential;
  readonly pwnedResult?: PwnedCheckResult;
  readonly mailError?: Error;
  readonly reissueResult?: 'not-invited';
  readonly activateResult?: 'not-invited';
  readonly consumeLoses?: boolean;
}

export interface InvitationFakeState {
  readonly calls: string[];
  readonly admins: Map<string, AdminRecord>;
  readonly tokens: StoredInvitationToken[];
  readonly totp: Map<string, AdminTotpCredential>;
  readonly inserted: {
    readonly admin: NewInvitedAdmin;
    readonly token: NewAdminInvitationToken;
    readonly audit: PreparedAuditEntry;
  }[];
  readonly reissued: {
    readonly adminId: string;
    readonly token: NewAdminInvitationToken;
    readonly audit: PreparedAuditEntry;
  }[];
  readonly pendingProfiles: {
    readonly adminId: string;
    readonly nickname: string;
    readonly passwordHash: string;
  }[];
  readonly activations: {
    readonly adminId: string;
    readonly activation: AdminActivation;
  }[];
  readonly mails: {
    readonly to: string;
    readonly token: string;
    readonly expiresAt: Date;
  }[];
  readonly directAuditInserts: PreparedAuditEntry[];
  readonly pwnedChecks: string[];
  readonly incidents: AuthIncident[];
  readonly uriLabels: string[];
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

const sameEmail = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase();

function hasValidPending(
  state: InvitationFakeState,
  adminId: string,
  activation: AdminActivation,
): boolean {
  const credential = state.totp.get(adminId);
  return (
    credential?.pendingSealedSecret === activation.pendingSealedSecret &&
    credential.pendingExpiresAt !== null &&
    credential.pendingExpiresAt.getTime() > activation.at.getTime()
  );
}

function activateInState(
  state: InvitationFakeState,
  adminId: string,
  activation: AdminActivation,
): 'activated' | 'not-invited' {
  const admin = state.admins.get(adminId);
  if (
    admin?.status !== 'invited' ||
    admin.passwordHash === null ||
    !hasValidPending(state, adminId, activation)
  ) {
    return 'not-invited';
  }
  state.admins.set(adminId, {
    ...admin,
    status: 'active',
    invitationExpiresAt: null,
    activatedAt: activation.at,
  });
  state.totp.set(adminId, {
    sealedSecret: activation.pendingSealedSecret,
    enabledAt: activation.at,
    lastUsedStep: activation.step,
    pendingSealedSecret: null,
    pendingExpiresAt: null,
  });
  state.activations.push({ adminId, activation });
  return 'activated';
}

function createAccountStore(
  state: InvitationFakeState,
  options: InvitationFakeOptions,
): AdminAccountStore {
  return partialFake<AdminAccountStore>({
    findById(adminId) {
      state.calls.push('admins.findById');
      return Promise.resolve(state.admins.get(adminId));
    },
    insertInvited(admin, token, audit) {
      state.calls.push('admins.insertInvited');
      if (
        [...state.admins.values()].some((a) => sameEmail(a.email, admin.email))
      ) {
        return Promise.resolve('email-in-use');
      }
      state.inserted.push({ admin, token, audit });
      state.admins.set(
        admin.id,
        invitedAdmin({
          id: admin.id,
          email: admin.email,
          invitationExpiresAt: token.expiresAt,
          createdAt: admin.invitedAt,
        }),
      );
      return Promise.resolve('created');
    },
    reissueInvitation(adminId, token, audit) {
      state.calls.push('admins.reissueInvitation');
      if (options.reissueResult !== undefined) {
        return Promise.resolve(options.reissueResult);
      }
      state.reissued.push({ adminId, token, audit });
      return Promise.resolve('reissued');
    },
    savePendingProfile(adminId, input) {
      state.calls.push('admins.savePendingProfile');
      state.pendingProfiles.push({ adminId, ...input });
      const admin = state.admins.get(adminId);
      if (admin?.status === 'invited') {
        state.admins.set(adminId, { ...admin, ...input });
      }
      return Promise.resolve();
    },
    activate(adminId, activation) {
      state.calls.push('admins.activate');
      if (options.activateResult !== undefined) {
        return Promise.resolve(options.activateResult);
      }
      return Promise.resolve(activateInState(state, adminId, activation));
    },
  });
}

function findToken(
  state: InvitationFakeState,
  purpose: AdminAuthTokenPurpose,
  tokenHash: string,
  now: Date,
): StoredInvitationToken | undefined {
  return state.tokens.find(
    (token) =>
      !token.consumed &&
      token.purpose === purpose &&
      token.tokenHash === tokenHash &&
      token.expiresAt.getTime() > now.getTime(),
  );
}

function createTokenStore(
  state: InvitationFakeState,
  options: InvitationFakeOptions,
): AdminAuthTokenStore {
  return partialFake<AdminAuthTokenStore>({
    findValid(purpose, tokenHash, now) {
      state.calls.push('tokens.findValid');
      const found = findToken(state, purpose, tokenHash, now);
      return Promise.resolve(
        found === undefined
          ? undefined
          : { adminId: found.adminId, newEmail: null },
      );
    },
    consume(purpose, tokenHash, now) {
      state.calls.push('tokens.consume');
      const found = findToken(state, purpose, tokenHash, now);
      if (found === undefined || options.consumeLoses === true) {
        return Promise.resolve(undefined);
      }
      state.tokens[state.tokens.indexOf(found)] = { ...found, consumed: true };
      return Promise.resolve({ adminId: found.adminId, newEmail: null });
    },
  });
}

function createTotpFakes(state: InvitationFakeState) {
  const totpCredentials = partialFake<AdminTotpCredentialStore>({
    find(adminId) {
      state.calls.push('totpCredentials.find');
      return Promise.resolve(state.totp.get(adminId));
    },
    savePending(adminId, sealedSecret, expiresAt) {
      state.calls.push('totpCredentials.savePending');
      state.totp.set(adminId, {
        sealedSecret: null,
        enabledAt: null,
        lastUsedStep: null,
        ...state.totp.get(adminId),
        pendingSealedSecret: sealedSecret,
        pendingExpiresAt: expiresAt,
      });
      return Promise.resolve();
    },
  });
  const secretBox: SecretBox = {
    seal(plaintext, context) {
      state.calls.push('secretBox.seal');
      return Promise.resolve(sealedOf(plaintext, context));
    },
    open(sealed, context) {
      state.calls.push('secretBox.open');
      return sealed === sealedOf(GENERATED_TOTP_SECRET, context)
        ? Promise.resolve(GENERATED_TOTP_SECRET)
        : Promise.reject(new Error('文脈が一致しない'));
    },
  };
  const totp: TotpAuthenticator = {
    generateSecret() {
      state.calls.push('totp.generateSecret');
      return GENERATED_TOTP_SECRET;
    },
    buildUri(secret, issuer, accountLabel) {
      state.uriLabels.push(accountLabel);
      return `otpauth://totp/${issuer}:${accountLabel}?secret=${secret}`;
    },
    verify(secret, code) {
      state.calls.push('totp.verify');
      return secret === GENERATED_TOTP_SECRET && code === VALID_CODE
        ? { ok: true, step: VALID_STEP }
        : { ok: false };
    },
  };
  return { totpCredentials, secretBox, totp };
}

function createPasswordFakes(
  state: InvitationFakeState,
  options: InvitationFakeOptions,
) {
  const passwordHasher = partialFake<PasswordHasher>({
    hash(password) {
      state.calls.push('password.hash');
      return Promise.resolve(storedHashOf(password));
    },
  });
  const passwordPolicy = new CheckingPasswordPolicy(
    {
      check(password) {
        state.pwnedChecks.push(password);
        return Promise.resolve(options.pwnedResult ?? { kind: 'not-pwned' });
      },
    },
    {
      report(incident) {
        state.incidents.push(incident);
      },
    },
  );
  return { passwordHasher, passwordPolicy };
}

function createSecretFakes() {
  let issued = 0;
  const secrets: SecretIssuer = {
    issue(purpose: HashPurpose) {
      issued += 1;
      const plain = `secret-plain-${String(issued)}`;
      return Promise.resolve({ plain, hash: hashedOf(purpose, plain) });
    },
    hashOf(purpose: HashPurpose, plain: string) {
      return Promise.resolve(hashedOf(purpose, plain));
    },
  };
  let sequence = 0;
  const ids: IdGenerator = {
    generate: () => `01JC0GENR${String(sequence++).padStart(17, '0')}`,
  };
  let randomCount = 0;
  const generator = partialFake<SecretGenerator>({
    randomString(length, alphabet) {
      randomCount += 1;
      return `${alphabet.charAt(0).repeat(length - 1)}${alphabet.charAt(randomCount % alphabet.length)}`;
    },
  });
  return { secrets, ids, generator };
}

function createMailer(
  state: InvitationFakeState,
  options: InvitationFakeOptions,
): AdminMailer {
  return partialFake<AdminMailer>({
    sendInvitation(to, token, expiresAt) {
      state.calls.push('mailer.sendInvitation');
      if (options.mailError !== undefined) {
        return Promise.reject(options.mailError);
      }
      state.mails.push({ to, token, expiresAt });
      return Promise.resolve();
    },
  });
}

function createState(options: InvitationFakeOptions): InvitationFakeState {
  return {
    calls: [],
    admins: new Map((options.admins ?? []).map((admin) => [admin.id, admin])),
    tokens: [...(options.tokens ?? [])],
    totp: new Map(
      options.totp === undefined ? [] : [[INVITED_ID, options.totp]],
    ),
    inserted: [],
    reissued: [],
    pendingProfiles: [],
    activations: [],
    mails: [],
    directAuditInserts: [],
    pwnedChecks: [],
    incidents: [],
    uriLabels: [],
  };
}

function createAuditLogRecorder(
  state: InvitationFakeState,
  ids: IdGenerator,
): AuditLogRecorder {
  const store = partialFake<AuditLogStore>({
    insert(entry) {
      state.directAuditInserts.push(entry);
      return Promise.resolve();
    },
  });
  return new StoreAuditLogRecorder(
    createAuditActionCatalog(AUDIT_ACTIONS),
    ids,
    store,
  );
}

export function setupAdminInvitation(options: InvitationFakeOptions = {}) {
  const keyedHasher: KeyedHasher = createKeyedHasher(TEST_PEPPER);
  const state = createState(options);
  const { secrets, ids, generator } = createSecretFakes();
  const { totpCredentials, secretBox, totp } = createTotpFakes(state);
  const { passwordHasher, passwordPolicy } = createPasswordFakes(
    state,
    options,
  );
  const invitation: AdminInvitation = new StoreAdminInvitation(
    createAccountStore(state, options),
    createTokenStore(state, options),
    totpCredentials,
    createAuditLogRecorder(state, ids),
    createMailer(state, options),
    {
      adminOrigin: 'https://admin.launch-stadium.example',
      totpIssuer: TOTP_ISSUER,
    },
    secrets,
    ids,
    passwordPolicy,
    passwordHasher,
    totp,
    secretBox,
    new HashingRecoveryCodeIssuer(generator, keyedHasher),
  );
  return { invitation, state, keyedHasher };
}

export type AdminInvitationFakes = ReturnType<typeof setupAdminInvitation>;

export const validInvitationToken = (
  overrides: Partial<StoredInvitationToken> = {},
): StoredInvitationToken => ({
  adminId: INVITED_ID,
  purpose: 'invitation',
  tokenHash: hashedOf('admin-auth-token-invitation', INVITATION_TOKEN),
  expiresAt: new Date('2026-11-04T00:00:00.000Z'),
  consumed: false,
  ...overrides,
});
