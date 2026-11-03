import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';
import { vi } from 'vitest';

import { userRecoveryCodes } from '../../db/schema/identity/user-recovery-codes.ts';
import { userTotpCredentials } from '../../db/schema/identity/user-totp-credentials.ts';
import { users } from '../../db/schema/identity/users.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { createWorkerApp } from '../../lib/workers/http/create-worker-app.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { applySecurityHeaders } from '../../lib/workers/http/security-headers.ts';
import { db } from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { SITEVERIFY_URL } from '../../lib/workers/bot-protection/turnstile-verifier.ts';
import {
  buildSentryOptions,
  readSentryRuntimeOptions,
} from '../../lib/workers/observability/sentry.ts';
import { AUTH_TYPES } from '../../src/application/auth/auth-types.ts';
import type {
  SecretBox,
  TotpAuthenticator,
} from '../../src/application/auth/ports.ts';
import type { RecoveryCodeIssuer } from '../../src/application/auth/recovery-code-issuer.ts';
import { IDENTITY_TYPES } from '../../src/application/identity/identity-types.ts';
import type { IdentityMailer } from '../../src/application/identity/ports.ts';
import { USER_RECOVERY_CODE_HASH_PURPOSE } from '../../src/application/identity/second-factor-check.ts';
import { apiEnvSchema } from '../../src/composition/env-schema.ts';
import { MODULES } from '../../src/composition/modules.ts';
import { RATE_LIMIT_EXCLUSIONS } from '../../src/composition/rate-limit-exclusions.ts';
import {
  type CallerKind,
  GATEWAY_HEADERS,
  SESSION_RESPONSE_HEADERS,
} from '../../src/presentation/gateway/gateway-headers.ts';
import {
  markInternalRequest,
  resolveGatewayClientIp,
} from '../../src/presentation/gateway/internal-request.ts';
import { createGraphQLModule } from '../../src/presentation/graphql/graphql-module.ts';
import { identitySchemaModule } from '../../src/presentation/graphql/modules/identity/index.ts';

export interface GraphQLErrorBody {
  readonly message: string;
  readonly extensions?: {
    readonly code?: string;
    readonly details?: readonly {
      readonly field: string;
      readonly code: string;
      readonly message: string;
    }[];
  };
}

export interface IdentityResponse<TData = Record<string, unknown>> {
  readonly status: number;
  readonly headers: Headers;
  readonly data: TData | null | undefined;
  readonly errors: readonly GraphQLErrorBody[] | undefined;
  // 応答が指示したセッションの発行。指示が無ければundefined
  readonly issuedToken: string | undefined;
  readonly cleared: boolean;
}

export interface CallOptions {
  readonly caller?: CallerKind;
  readonly sessionToken?: string;
  readonly botToken?: string;
  readonly clientIp?: string;
  readonly userAgent?: string;
}

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

type HarnessApp = Hono<PlatformHonoEnv<Env>>;

const GRAPHQL_URL = 'https://api.launch.example/graphql';

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

const overridesModule: AppModule<HarnessApp> = {
  name: 'identity-graphql-test-overrides',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<IdentityMailer>(IDENTITY_TYPES.IdentityMailer).toConstantValue(
      recordingMailer,
    );
  }),
};

function documentIdOf(index: number): string {
  return `sha256:${index.toString(16).padStart(64, '0')}`;
}

export interface IdentityGateway {
  call<TData = Record<string, unknown>>(
    document: string,
    variables?: Record<string, unknown>,
    options?: CallOptions,
  ): Promise<IdentityResponse<TData>>;
}

// 利用者側・管理者側の両方の許可リストに同じ操作を載せ、呼び出し元の拒否をリゾルバの判定で確かめる
export function createIdentityGateway(
  documents: readonly string[],
): IdentityGateway {
  const ids = new Map(
    documents.map((body, index) => [body, documentIdOf(index + 1)]),
  );
  const operations = Object.fromEntries(
    [...ids].map(([body, documentId]) => [documentId, body]),
  );
  const app = createWorkerApp<Env>({
    appName: 'api',
    envSchema: apiEnvSchema,
    modules: [
      ...MODULES.filter(({ name }) => name !== 'graphql'),
      overridesModule,
      createGraphQLModule<Env>({
        schemaModules: [identitySchemaModule],
        allowlist: {
          version: 1,
          operations: { client: operations, admin: operations },
        },
      }),
    ],
    rateLimitExclusions: RATE_LIMIT_EXCLUSIONS,
    resolveClientIp: resolveGatewayClientIp,
    sentry: (bindings) =>
      buildSentryOptions({
        ...readSentryRuntimeOptions(bindings),
        dsn: undefined,
      }),
  });
  return {
    async call(document, variables, options = {}) {
      const documentId = ids.get(document);
      if (documentId === undefined) {
        throw new Error('許可リストに載せていない操作です');
      }
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        [GATEWAY_HEADERS.clientIp]: options.clientIp ?? randomClientIp(),
        ...(options.sessionToken !== undefined && {
          [GATEWAY_HEADERS.sessionToken]: options.sessionToken,
        }),
        ...(options.botToken !== undefined && {
          [GATEWAY_HEADERS.botToken]: options.botToken,
        }),
        ...(options.userAgent !== undefined && {
          'user-agent': options.userAgent,
        }),
      };
      const request = markInternalRequest(
        new Request(GRAPHQL_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify({ documentId, variables }),
        }),
        options.caller ?? 'client',
      );
      const ctx = createExecutionContext();
      const response = applySecurityHeaders(await app.fetch(request, env, ctx));
      await waitOnExecutionContext(ctx);
      const body = await response.json<{
        readonly data?: unknown;
        readonly errors?: readonly GraphQLErrorBody[];
      }>();
      return {
        status: response.status,
        headers: response.headers,
        data: body.data as never,
        errors: body.errors,
        issuedToken:
          response.headers.get(SESSION_RESPONSE_HEADERS.issue) ?? undefined,
        cleared: response.headers.get(SESSION_RESPONSE_HEADERS.clear) === '1',
      };
    },
  };
}

// 送信回数とログイン試行の記録は要求元のIPアドレスでも数えるため、要求ごとに別のアドレスにして他のテストの記録と混ぜない
export function randomClientIp(): string {
  const groups = Array.from(
    crypto.getRandomValues(new Uint16Array(4)),
    (value) => value.toString(16),
  );
  return `2001:db8::${groups.join(':')}`;
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
