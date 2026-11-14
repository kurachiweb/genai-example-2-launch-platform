import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { ContainerModule } from 'inversify';

import { userRecoveryCodes } from '../../db/schema/identity/user-recovery-codes.ts';
import { userTotpCredentials } from '../../db/schema/identity/user-totp-credentials.ts';
import { users } from '../../db/schema/identity/users.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { db } from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { AUTH_TYPES } from '../../src/application/auth/auth-types.ts';
import type {
  SecretBox,
  TotpAuthenticator,
} from '../../src/application/auth/ports.ts';
import type { RecoveryCodeIssuer } from '../../src/application/auth/recovery-code-issuer.ts';
import { IDENTITY_TYPES } from '../../src/application/identity/identity-types.ts';
import type { IdentityMailer } from '../../src/application/identity/ports.ts';
import { USER_RECOVERY_CODE_HASH_PURPOSE } from '../../src/application/identity/second-factor-check.ts';
import { MODULES } from '../../src/composition/modules.ts';
import { identitySchemaModule } from '../../src/presentation/graphql/modules/identity/index.ts';
import {
  createGraphQLGateway,
  type GatewayApp,
  type GatewayCallOptions,
  type GatewayResponse,
  type GraphQLGateway,
} from './graphql-gateway.ts';

export {
  BOT_REJECTED_TOKEN,
  BOT_UNREACHABLE_TOKEN,
  botTokenFor,
  type ExternalCalls,
  type GraphQLErrorBody,
  randomClientIp,
  stubExternalServices,
} from './graphql-gateway.ts';

export type IdentityResponse<TData = Record<string, unknown>> =
  GatewayResponse<TData>;

export type CallOptions = GatewayCallOptions;

export type IdentityGateway = GraphQLGateway;

export type SentMailKind =
  | 'email-verification'
  | 'email-change-confirmation'
  | 'email-changed'
  | 'password-reset'
  | 'password-reset-completed'
  | 'password-change-confirmation'
  | 'password-changed';

export interface SentMail {
  readonly kind: SentMailKind;
  readonly userId: string;
  readonly token: string | undefined;
}

export const sentMails: SentMail[] = [];

const recordingMailer: IdentityMailer = {
  sendEmailVerification: (to, token) =>
    record('email-verification', to.id, token),
  sendEmailChangeConfirmation: (user, _newEmail, token) =>
    record('email-change-confirmation', user.id, token),
  sendEmailChanged: (_previousEmail, user) =>
    record('email-changed', user.id, undefined),
  sendPasswordReset: (user, token) => record('password-reset', user.id, token),
  sendPasswordResetCompleted: (user) =>
    record('password-reset-completed', user.id, undefined),
  sendPasswordChangeConfirmation: (user, token) =>
    record('password-change-confirmation', user.id, token),
  sendPasswordChanged: (user) => record('password-changed', user.id, undefined),
};

function record(
  kind: SentMailKind,
  userId: string,
  token: string | undefined,
): Promise<void> {
  sentMails.push({ kind, userId, token });
  return Promise.resolve();
}

export function lastMailOf(kind: SentMailKind): SentMail {
  const mail = sentMails.findLast((sent) => sent.kind === kind);
  if (mail === undefined) {
    throw new Error(`${kind}のメールが送られていません`);
  }
  return mail;
}

const overridesModule: AppModule<GatewayApp> = {
  name: 'identity-graphql-test-overrides',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<IdentityMailer>(IDENTITY_TYPES.IdentityMailer).toConstantValue(
      recordingMailer,
    );
  }),
};

export function createIdentityGateway(
  documents: readonly string[],
): IdentityGateway {
  return createGraphQLGateway({
    documents,
    schemaModules: [identitySchemaModule],
    overrides: [overridesModule],
  });
}

export function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@mail.example`;
}

export async function suspendUser(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ status: 'suspended' })
    .where(eq(users.id, userId));
}

export async function markVerified(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(users.id, userId));
}

function createTestContainer() {
  return createInvocationContainer(
    {
      env,
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

// 有効化済みのTOTPの秘密鍵と、指定したリカバリコードを保存する。秘密鍵は認証コードを作れるよう平文も返す
export async function enableTotpWithRecoveryCodes(
  userId: string,
  recoveryCodes: readonly string[],
): Promise<string> {
  const container = createTestContainer();
  const secret = container
    .get<TotpAuthenticator>(AUTH_TYPES.TotpAuthenticator)
    .generateSecret();
  const now = new Date();
  await db.insert(userTotpCredentials).values({
    userId,
    sealedSecret: await container
      .get<SecretBox>(AUTH_TYPES.SecretBox)
      .seal(secret, userId),
    enabledAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const issuer = container.get<RecoveryCodeIssuer>(
    AUTH_TYPES.RecoveryCodeIssuer,
  );
  const hashes = await Promise.all(
    recoveryCodes.map(async (code) => {
      const hash = await issuer.hashInput(
        USER_RECOVERY_CODE_HASH_PURPOSE,
        code,
      );
      if (hash === undefined) {
        throw new Error('リカバリコードの形式ではありません');
      }
      return hash;
    }),
  );
  await db.insert(userRecoveryCodes).values(
    hashes.map((codeHash) => ({
      userId,
      codeHash,
      createdAt: now,
      updatedAt: now,
    })),
  );
  return secret;
}
