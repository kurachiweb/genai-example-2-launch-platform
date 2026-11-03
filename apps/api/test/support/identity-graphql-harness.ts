import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { ContainerModule } from 'inversify';
import { vi } from 'vitest';

import { userRecoveryCodes } from '../../db/schema/identity/user-recovery-codes.ts';
import { userTotpCredentials } from '../../db/schema/identity/user-totp-credentials.ts';
import { users } from '../../db/schema/identity/users.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { db } from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { SITEVERIFY_URL } from '../../lib/workers/bot-protection/turnstile-verifier.ts';
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

export { type GraphQLErrorBody, randomClientIp } from './graphql-gateway.ts';

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

const SITEVERIFY_HOSTNAME = 'client.launch.example';

const HIBP_RANGE_PREFIX = 'https://api.pwnedpasswords.com/range/';

const DISIFY_URL = 'https://disify.com/api/email';

// 出現回数0のパディングの行だけを返し、どのパスワードも漏洩していない応答にする
const HIBP_PADDING_LINE = `${'0'.repeat(35)}:0`;

const BOT_TOKEN_PREFIX = 'bot-ok:';

export const BOT_REJECTED_TOKEN = 'bot-rejected';

export const BOT_UNREACHABLE_TOKEN = 'bot-unreachable';

// 判定サービスの偽物は、トークンに埋めた操作名を判定の結果の操作名として返す
export function botTokenFor(action: string): string {
  return `${BOT_TOKEN_PREFIX}${action}`;
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

function siteverifyResponse(token: string | undefined): Promise<Response> {
  if (token === BOT_UNREACHABLE_TOKEN) {
    return Promise.reject(new TypeError('判定サービスに接続できません'));
  }
  if (token?.startsWith(BOT_TOKEN_PREFIX) !== true) {
    return Promise.resolve(
      Response.json({
        success: false,
        'error-codes': ['invalid-input-response'],
      }),
    );
  }
  return Promise.resolve(
    Response.json({
      success: true,
      hostname: SITEVERIFY_HOSTNAME,
      challenge_ts: new Date().toISOString(),
      action: token.slice(BOT_TOKEN_PREFIX.length),
      'error-codes': [],
    }),
  );
}

function readToken(init: RequestInit | undefined): string | undefined {
  if (typeof init?.body !== 'string') {
    return undefined;
  }
  const { response } = JSON.parse(init.body) as { readonly response?: string };
  return response;
}

export interface ExternalCalls {
  readonly siteverifyTokens: string[];
}

// bot判定・漏洩パスワードの照合・使い捨てメールアドレスの判定の外部サービスを偽物に差し替え、判定サービスへ送ったトークンを記録する
export function stubExternalServices(): ExternalCalls {
  const calls: ExternalCalls = { siteverifyTokens: [] };
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === SITEVERIFY_URL) {
      const token = readToken(init);
      calls.siteverifyTokens.push(token ?? '');
      return siteverifyResponse(token);
    }
    if (url.startsWith(HIBP_RANGE_PREFIX)) {
      return Promise.resolve(new Response(HIBP_PADDING_LINE));
    }
    if (url === DISIFY_URL) {
      return Promise.resolve(
        Response.json({ format: true, disposable: false, dns: true }),
      );
    }
    return Promise.reject(new Error(`想定外の外部への要求です: ${url}`));
  });
  return calls;
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
