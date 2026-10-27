import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { z } from 'zod';

import { ALLOWLIST_TYPE_DEFS } from '../fixtures/graphql/allowlist-operations.ts';
import allowlistFixture from '../fixtures/graphql/allowlist.json';
import {
  configureRecordingLogs,
  type LoggedObject,
} from './observability-recording.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { platformEnvShape } from '../../lib/workers/env/platform-env.ts';
import { createWorkerApp } from '../../lib/workers/http/create-worker-app.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { applySecurityHeaders } from '../../lib/workers/http/security-headers.ts';
import {
  buildSentryOptions,
  readSentryRuntimeOptions,
} from '../../lib/workers/observability/sentry.ts';
import {
  type AuthenticatedPrincipal,
  SESSION_TYPES,
  type SessionSubjectKind,
  type SessionVerifier,
} from '../../src/application/session/session-verifier.ts';
import {
  type AppEnvironment,
  type CallerKind,
  GATEWAY_HEADERS,
} from '../../src/presentation/gateway/gateway-headers.ts';
import {
  markInternalRequest,
  resolveGatewayClientIp,
} from '../../src/presentation/gateway/internal-request.ts';
import { createPublicEntrypoint } from '../../src/presentation/gateway/public-entrypoint.ts';
import type { GraphQLContext } from '../../src/presentation/graphql/graphql-context.ts';
import { createGraphQLModule } from '../../src/presentation/graphql/graphql-module.ts';
import { defineSchemaModule } from '../../src/presentation/graphql/schema-module.ts';

export type TestEnv = typeof env;
export type TestApp = Hono<PlatformHonoEnv<TestEnv>>;
export type IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

export interface ResponseBody {
  readonly data?: Record<string, unknown> | null;
  readonly errors?: readonly {
    readonly message: string;
    readonly extensions?: { readonly code?: string };
  }[];
}

export interface CallOptions {
  readonly method?: 'GET' | 'POST';
  readonly headers?: Record<string, string>;
  readonly body?: BodyInit;
  readonly environment?: AppEnvironment;
}

export interface VerifyCall {
  readonly subjectKind: SessionSubjectKind;
}

export const GRAPHQL_URL = 'https://api.launch.example/graphql';
export const CONNECTING_IP = '198.51.100.20';
export const RELAYED_IP = '203.0.113.7';
export const OPERATION_CATEGORY = 'api.graphql.operation';
export const CLIENT_IP_CATEGORY = 'api.gateway.client-ip';

export const VALID_TOKEN = `valid${'0123456789'.repeat(3)}abcdefgh`;
export const INVALID_TOKEN = `invalid${'0123456789'.repeat(3)}abcdef`;
export const RENEWED_TOKEN = `renewed${'0123456789'.repeat(3)}abcdef`;
export const RENEWED_MAX_AGE_SECONDS = 3600;

export const DEPLOYED_ENVIRONMENTS: readonly AppEnvironment[] = [
  'staging',
  'prod',
];

export let resolverCalls = 0;
export const verifyCalls: VerifyCall[] = [];
export const observedErrors: unknown[] = [];
export let logs: LoggedObject[] = [];

export function documentIdOf(digit: string): string {
  return `sha256:${digit.repeat(64)}`;
}

export const OPERATIONS = Object.freeze({
  caller: { documentId: documentIdOf('1'), body: 'query Caller { caller }' },
  clientIp: {
    documentId: documentIdOf('2'),
    body: 'query ClientIp { clientIp }',
  },
  viewer: { documentId: documentIdOf('3'), body: 'query Viewer { viewer }' },
});

export const SHARED_OPERATIONS = Object.fromEntries(
  Object.values(OPERATIONS).map(({ documentId, body }) => [documentId, body]),
);

export const ALLOWLIST = {
  version: 1,
  operations: {
    client: { ...allowlistFixture.operations.client, ...SHARED_OPERATIONS },
    admin: { ...allowlistFixture.operations.admin, ...SHARED_OPERATIONS },
  },
};

export function counted<T>(value: T): () => T {
  return () => {
    resolverCalls += 1;
    return value;
  };
}

export const ALLOWLIST_MODULE = defineSchemaModule({
  name: 'allowlist-fixture',
  typeDefs: ALLOWLIST_TYPE_DEFS,
  resolvers: {
    Query: { clientValue: counted('client'), adminValue: counted('admin') },
  },
});

export const ROUTE_MODULE = defineSchemaModule({
  name: 'graphql-module-fixture',
  typeDefs: /* GraphQL */ `
    type Query {
      caller: String
      clientIp: String
      viewer: String
    }
  `,
  resolvers: {
    Query: {
      caller: (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        resolverCalls += 1;
        return context.caller;
      },
      clientIp: (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        resolverCalls += 1;
        return context.clientIp;
      },
      viewer: async (
        _parent: unknown,
        _args: unknown,
        context: GraphQLContext,
      ) => {
        resolverCalls += 1;
        return (await context.session.principal()).kind;
      },
    },
  },
});

export const PRINCIPAL: AuthenticatedPrincipal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'user',
  subjectId: '01JBUSER000000000000000000',
  sessionId: '01JBSESSION000000000000000',
});

export const recordingSessionVerifier: SessionVerifier = {
  verify: ({ subjectKind, token }) => {
    verifyCalls.push({ subjectKind });
    if (token === INVALID_TOKEN) {
      return Promise.resolve({ status: 'invalid' });
    }
    return Promise.resolve({
      status: 'valid',
      principal: { ...PRINCIPAL, subjectKind },
      renewal: {
        token: RENEWED_TOKEN,
        maxAgeSeconds: RENEWED_MAX_AGE_SECONDS,
      },
    });
  },
};

export const sessionModule: AppModule<TestApp> = {
  name: 'session-test',
  bindings: new ContainerModule(({ bind }) => {
    bind<SessionVerifier>(SESSION_TYPES.SessionVerifier).toConstantValue(
      recordingSessionVerifier,
    );
  }),
};

// 外側の中間処理(エラートラッキング)と同じく、経路の処理を終えた後に残った例外を記録する
export const errorObserverModule: AppModule<TestApp> = {
  name: 'error-observer-test',
  routes: (app) => {
    app.use('/graphql', async (c, next) => {
      await next();
      if (c.error !== undefined) {
        observedErrors.push(c.error);
      }
    });
  },
};

export function createTestApp(): TestApp {
  return createWorkerApp<TestEnv>({
    appName: 'api',
    envSchema: z.object(platformEnvShape),
    modules: [
      sessionModule,
      errorObserverModule,
      createGraphQLModule<TestEnv>({
        schemaModules: [ALLOWLIST_MODULE, ROUTE_MODULE],
        allowlist: ALLOWLIST,
      }),
    ],
    rateLimitExclusions: [],
    resolveClientIp: resolveGatewayClientIp,
    sentry: (bindings) =>
      buildSentryOptions({
        ...readSentryRuntimeOptions(bindings),
        dsn: undefined,
      }),
  });
}

export const app = createTestApp();

export const publicEntrypoint = createPublicEntrypoint<TestEnv>(
  { fetch: (request, bindings, ctx) => app.fetch(request, bindings, ctx) },
  { cors: { headersFor: () => undefined } },
);

export function envFor(environment: AppEnvironment): TestEnv {
  return { ...env, APP_ENVIRONMENT: environment };
}

export function createRequest(options: CallOptions): Request {
  return new Request(GRAPHQL_URL, {
    method: options.method ?? 'POST',
    headers: { 'CF-Connecting-IP': CONNECTING_IP, ...options.headers },
    ...(options.body !== undefined && { body: options.body }),
  });
}

// 名前付きエントリポイントと同じく、呼び出し元を付けてからアプリへ渡し、応答にセキュリティヘッダーを付ける
export async function callInternal(
  caller: CallerKind,
  options: CallOptions,
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await app.fetch(
    markInternalRequest(createRequest(options), caller),
    envFor(options.environment ?? 'local'),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return applySecurityHeaders(response);
}

export async function callPublic(options: CallOptions): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await publicEntrypoint.fetch?.(
    createRequest(options) as IncomingRequest,
    envFor(options.environment ?? 'local'),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  if (response === undefined) {
    throw new Error('fetchハンドラーがありません');
  }
  return response;
}

export function postJson(
  payload: unknown,
  headers: Record<string, string> = {},
): CallOptions {
  return {
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  };
}

export function relayed(
  options: CallOptions,
  clientIp: string = RELAYED_IP,
): CallOptions {
  return {
    ...options,
    headers: { [GATEWAY_HEADERS.clientIp]: clientIp, ...options.headers },
  };
}

export function graphiqlPage(
  environment: AppEnvironment = 'local',
): CallOptions {
  return { method: 'GET', headers: { accept: 'text/html' }, environment };
}

// JSONの末尾の空白は値を変えないため、本文の大きさだけを指定の値にそろえられる
export function paddedDocument(documentId: string, size: number): string {
  const json = JSON.stringify({ documentId });
  return json + ' '.repeat(size - new TextEncoder().encode(json).length);
}

export function streamOf(size: number): ReadableStream<Uint8Array> {
  const chunkSize = 64 * 1024;
  let remaining = size;
  return new ReadableStream({
    pull(controller) {
      if (remaining <= 0) {
        controller.close();
        return;
      }
      const length = Math.min(chunkSize, remaining);
      remaining -= length;
      controller.enqueue(new Uint8Array(length).fill(0x20));
    },
  });
}

export async function bodyOf(response: Response): Promise<ResponseBody> {
  return response.json<ResponseBody>();
}

export async function errorCodesOf(
  response: Response,
): Promise<(string | undefined)[]> {
  return ((await bodyOf(response)).errors ?? []).map(
    (error) => error.extensions?.code,
  );
}

export function logsOf(category: string): LoggedObject[] {
  return logs.filter((log) => log.category === category);
}

// 各テストの前に記録を空にし、ファイルの終わりにログの設定を戻す
export function installGraphQLModuleHooks(): void {
  beforeAll(() => {
    logs = configureRecordingLogs();
  });

  beforeEach(() => {
    logs.splice(0);
    verifyCalls.splice(0);
    observedErrors.splice(0);
  });

  afterAll(() => {
    resetSync();
  });
}
