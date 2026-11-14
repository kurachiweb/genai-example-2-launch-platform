import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { ContainerModule, type Container } from 'inversify';

import type { AdminRole } from '../../common-lib/admin/admin-roles.ts';
import { adminAuthTokens } from '../../db/schema/admin/admin-auth-tokens.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { prepareAdminAuthToken } from '../../src/application/admin/admin-auth-token-issuance.ts';
import { adminTotpSecretContext } from '../../src/application/admin/admin-second-factor-check.ts';
import type { AdminSessionIssuer } from '../../src/application/admin/admin-session-issuer.ts';
import { ADMIN_TYPES } from '../../src/application/admin/admin-types.ts';
import type {
  AdminAuthTokenStore,
  AdminMailer,
  IssuedAdminSession,
} from '../../src/application/admin/ports.ts';
import { AUTH_TYPES } from '../../src/application/auth/auth-types.ts';
import type {
  PasswordHasher,
  SecretBox,
  TotpAuthenticator,
} from '../../src/application/auth/ports.ts';
import type { RecoveryCodeIssuer } from '../../src/application/auth/recovery-code-issuer.ts';
import type { SecretIssuer } from '../../src/application/auth/secret-issuer.ts';
import { MODULES } from '../../src/composition/modules.ts';
import { ADMIN_HASH_PURPOSES } from '../../src/domain/admin/admin-auth-token-purpose.ts';
import {
  adminEmailOf,
  adminIdOf,
  db,
  insertAdmin,
  insertAdminRecoveryHashes,
  insertAdminTotpCredential,
  insertInvitedAdmin,
} from '../../src/infrastructure/admin/testing/admin-store-fixtures.ts';
import {
  createGraphQLGateway,
  type GatewayApp,
  type GraphQLGateway,
  type GraphQLGatewayOptions,
} from './graphql-gateway.ts';

export type AdminGatewayOptions = GraphQLGatewayOptions;

// 管理者の操作は管理者側の呼び出し元から受け付けるため、呼び出し元の既定を管理者側にする
export function createAdminGateway(
  options: AdminGatewayOptions,
): GraphQLGateway {
  const gateway = createGraphQLGateway(options);
  return {
    call: (document, variables, callOptions = {}) =>
      gateway.call(document, variables, { caller: 'admin', ...callOptions }),
  };
}

export function createAdminTestContainer(
  envOverrides: Partial<typeof env> = {},
): Container {
  return createInvocationContainer(
    {
      env: { ...env, ...envOverrides },
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

// 本物の発行の部品で保存済みの管理者のセッションを作る。発行日時を過去にすると、期限切れや延長の境界を再現できる
export function issueAdminSession(
  adminId: string,
  options: { readonly now?: Date; readonly userAgent?: string } = {},
): Promise<IssuedAdminSession> {
  return createAdminTestContainer()
    .get<AdminSessionIssuer>(ADMIN_TYPES.AdminSessionIssuer)
    .issue(adminId, {
      clientIp: undefined,
      userAgent: options.userAgent,
      now: options.now ?? new Date(),
    });
}

export type SentAdminMailKind =
  | 'invitation'
  | 'email-change-confirmation'
  | 'email-changed'
  | 'password-reset'
  | 'password-reset-completed'
  | 'password-changed';

export interface SentAdminMail {
  readonly kind: SentAdminMailKind;
  readonly to: string;
  readonly token: string | undefined;
}

export const sentAdminMails: SentAdminMail[] = [];

function record(
  kind: SentAdminMailKind,
  to: string,
  token?: string,
): Promise<void> {
  sentAdminMails.push({ kind, to, token });
  return Promise.resolve();
}

const recordingAdminMailer: AdminMailer = {
  sendInvitation: (to, token) => record('invitation', to, token),
  sendEmailChangeConfirmation: (_admin, newEmail, token) =>
    record('email-change-confirmation', newEmail, token),
  sendEmailChanged: (previousEmail) => record('email-changed', previousEmail),
  sendPasswordReset: (admin, token) =>
    record('password-reset', admin.email, token),
  sendPasswordResetCompleted: (admin) =>
    record('password-reset-completed', admin.email),
  sendPasswordChanged: (admin) => record('password-changed', admin.email),
};

// メール送信の部品を、送った種類・宛先・トークンを記録する偽物へ差し替える
export const RECORDING_ADMIN_MAILER_MODULE: AppModule<GatewayApp> = {
  name: 'admin-graphql-test-mailer',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<AdminMailer>(ADMIN_TYPES.AdminMailer).toConstantValue(
      recordingAdminMailer,
    );
  }),
};

export function lastAdminMailOf(kind: SentAdminMailKind): SentAdminMail {
  const mail = sentAdminMails.findLast((sent) => sent.kind === kind);
  if (mail === undefined) {
    throw new Error(`${kind}のメールが送られていません`);
  }
  return mail;
}

export interface PreparedAdmin {
  readonly adminId: string;
  readonly email: string;
  readonly totpSecret: string;
  readonly recoveryCodes: readonly string[];
}

// 本物のハッシュ化・暗号化の部品で、パスワードと有効なTOTPとリカバリコードを持つ有効な管理者を保存する。秘密鍵は認証コードを作れるよう平文も返す
export async function prepareActiveAdmin(
  index: number,
  options: { readonly password: string; readonly role?: AdminRole },
): Promise<PreparedAdmin> {
  const container = createAdminTestContainer();
  const adminId = adminIdOf(index);
  const now = new Date();
  await insertAdmin(index, {
    role: options.role ?? 'viewer',
    passwordHash: await container
      .get<PasswordHasher>(AUTH_TYPES.PasswordHasher)
      .hash(options.password),
  });
  const totpSecret = container
    .get<TotpAuthenticator>(AUTH_TYPES.TotpAuthenticator)
    .generateSecret();
  await insertAdminTotpCredential(index, {
    sealedSecret: await container
      .get<SecretBox>(AUTH_TYPES.SecretBox)
      .seal(totpSecret, adminTotpSecretContext(adminId)),
    enabledAt: now,
  });
  const recoveryCodes = await container
    .get<RecoveryCodeIssuer>(AUTH_TYPES.RecoveryCodeIssuer)
    .issue(ADMIN_HASH_PURPOSES.recoveryCode);
  await insertAdminRecoveryHashes(index, recoveryCodes.hashes);
  return {
    adminId,
    email: adminEmailOf(index),
    totpSecret,
    recoveryCodes: recoveryCodes.plains,
  };
}

const MS_PER_HOUR = 60 * 60 * 1000;

// 招待の発行は管理の操作か招待の発行コマンドが行うため、招待中の管理者と期限内の招待のトークンを直接保存し、リンクの平文を返す
export async function insertInvitation(index: number): Promise<string> {
  const expiresAt = new Date(Date.now() + MS_PER_HOUR);
  await insertInvitedAdmin(index, { invitationExpiresAt: expiresAt });
  const secret = await createAdminTestContainer()
    .get<SecretIssuer>(AUTH_TYPES.SecretIssuer)
    .issue(ADMIN_HASH_PURPOSES.authToken('invitation'));
  const now = new Date();
  await db.insert(adminAuthTokens).values({
    adminId: adminIdOf(index),
    purpose: 'invitation',
    tokenHash: secret.hash,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  return secret.plain;
}

// メールアドレス変更の要求は本人確認を伴う本人の操作のため、確認のリンクのトークンを本物の組み立てとストアで直接保存し、平文を返す
export async function insertEmailChangeToken(
  adminId: string,
  newEmail: string,
): Promise<string> {
  const container = createAdminTestContainer();
  const { token, plain } = await prepareAdminAuthToken(
    container.get<SecretIssuer>(AUTH_TYPES.SecretIssuer),
    adminId,
    'email_change',
    new Date(),
  );
  await container
    .get<AdminAuthTokenStore>(ADMIN_TYPES.AdminAuthTokenStore)
    .replace({ ...token, newEmail });
  return plain;
}
