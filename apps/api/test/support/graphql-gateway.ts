import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';

import type { AppModule } from '../../lib/core/di/app-module.ts';
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
