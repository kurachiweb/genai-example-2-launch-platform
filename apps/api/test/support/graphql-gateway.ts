import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import { vi } from 'vitest';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { SITEVERIFY_URL } from '../../lib/workers/bot-protection/turnstile-verifier.ts';
import { createWorkerApp } from '../../lib/workers/http/create-worker-app.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { applySecurityHeaders } from '../../lib/workers/http/security-headers.ts';
import {
  buildSentryOptions,
  readSentryRuntimeOptions,
} from '../../lib/workers/observability/sentry.ts';
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
import type { GraphQLSchemaModule } from '../../src/presentation/graphql/schema-module.ts';

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

export interface GatewayResponse<TData = Record<string, unknown>> {
  readonly status: number;
  readonly headers: Headers;
  readonly data: TData | null | undefined;
  readonly errors: readonly GraphQLErrorBody[] | undefined;
  // 応答が指示したセッションの発行。指示が無ければundefined
  readonly issuedToken: string | undefined;
  readonly cleared: boolean;
}

export interface GatewayCallOptions {
  readonly caller?: CallerKind;
  readonly sessionToken?: string;
  readonly botToken?: string;
  readonly clientIp?: string;
  readonly userAgent?: string;
}

export interface GraphQLGateway {
  call<TData = Record<string, unknown>>(
    document: string,
    variables?: Record<string, unknown>,
    options?: GatewayCallOptions,
  ): Promise<GatewayResponse<TData>>;
}

export type GatewayApp = Hono<PlatformHonoEnv<Env>>;

export interface GraphQLGatewayOptions {
  readonly documents: readonly string[];
  readonly schemaModules: readonly GraphQLSchemaModule[];
  // 本物の束縛の後に読み込み、外部への送信などを偽物へ差し替える
  readonly overrides?: readonly AppModule<GatewayApp>[];
}

const GRAPHQL_URL = 'https://api.launch.example/graphql';

function documentIdOf(index: number): string {
  return `sha256:${index.toString(16).padStart(64, '0')}`;
}

// 送信回数とログイン試行の記録は要求元のIPアドレスでも数えるため、要求ごとに別のアドレスにして他のテストの記録と混ぜない
export function randomClientIp(): string {
  const groups = Array.from(
    crypto.getRandomValues(new Uint16Array(4)),
    (value) => value.toString(16),
  );
  return `2001:db8::${groups.join(':')}`;
}

// 本物のモジュールの束縛で、指定したスキーマモジュールだけを載せたGraphQLへ内部経路から要求する。
// 利用者側・管理者側の両方の許可リストに同じ操作を載せ、呼び出し元の拒否をリゾルバの判定で確かめる
export function createGraphQLGateway(
  options: GraphQLGatewayOptions,
): GraphQLGateway {
  const ids = new Map(
    options.documents.map((body, index) => [body, documentIdOf(index + 1)]),
  );
  const operations = Object.fromEntries(
    [...ids].map(([body, documentId]) => [documentId, body]),
  );
  const app = createWorkerApp<Env>({
    appName: 'api',
    envSchema: apiEnvSchema,
    modules: [
      ...MODULES.filter(({ name }) => name !== 'graphql'),
      ...(options.overrides ?? []),
      createGraphQLModule<Env>({
        schemaModules: options.schemaModules,
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
    async call(document, variables, callOptions = {}) {
      const documentId = ids.get(document);
      if (documentId === undefined) {
        throw new Error('許可リストに載せていない操作です');
      }
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        [GATEWAY_HEADERS.clientIp]: callOptions.clientIp ?? randomClientIp(),
        ...(callOptions.sessionToken !== undefined && {
          [GATEWAY_HEADERS.sessionToken]: callOptions.sessionToken,
        }),
        ...(callOptions.botToken !== undefined && {
          [GATEWAY_HEADERS.botToken]: callOptions.botToken,
        }),
        ...(callOptions.userAgent !== undefined && {
          'user-agent': callOptions.userAgent,
        }),
      };
      const request = markInternalRequest(
        new Request(GRAPHQL_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify({ documentId, variables }),
        }),
        callOptions.caller ?? 'client',
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
