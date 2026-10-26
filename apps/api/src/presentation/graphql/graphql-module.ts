import type { Context, Hono, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import type { AppModule } from '../../../lib/core/di/app-module.ts';
import type { ErrorEnvelope } from '../../../lib/core/errors/error-envelope.ts';
import type { PlatformEnv } from '../../../lib/workers/env/platform-env.ts';
import type { PlatformHonoEnv } from '../../../lib/workers/http/hono-env.ts';
import {
  type AppEnvironment,
  GATEWAY_HEADERS,
} from '../gateway/gateway-headers.ts';
import {
  createNotFoundError,
  warnOnMissingClientIp,
} from '../gateway/internal-only.ts';
import { readInternalCaller } from '../gateway/internal-request.ts';
import {
  applySessionInstructions,
  createSessionAccess,
} from '../gateway/session-access.ts';
import {
  type GatewayRequestScope,
  getGatewayServer,
  type GraphQLAccess,
  isGraphiqlRequest,
} from './gateway-server.ts';
import { readDebugCaller } from './operation-allowlist.ts';
import {
  createOperationObservation,
  logOperation,
} from './operation-observability.ts';
import type { GraphQLSchemaModule } from './schema-module.ts';

export interface GraphQLModuleOptions {
  readonly schemaModules: readonly GraphQLSchemaModule[];
  // allowlist.jsonの内容。最初の要求でOperationAllowlistが検証する
  readonly allowlist: unknown;
}

type GraphQLModuleEnv = PlatformEnv & {
  readonly APP_ENVIRONMENT: AppEnvironment;
};

type GraphQLRouteContext<E extends GraphQLModuleEnv> = Context<
  PlatformHonoEnv<E>
>;

export const GRAPHQL_MAX_BODY_BYTES = 1024 * 1024;

// GraphiQLの画面はunpkgから本体・スタイル・エディタのワーカーを読み込み、インラインのスクリプトで起動する
export const GRAPHIQL_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  "font-src 'self' data: https://unpkg.com",
  "img-src 'self' data:",
  "connect-src 'self' https://unpkg.com",
  'worker-src blob:',
].join('; ');

const GRAPHQL_PATH = '/graphql';

const GRAPHQL_METHODS = ['GET', 'POST'];

const PAYLOAD_TOO_LARGE_STATUS = 413;

const PAYLOAD_TOO_LARGE_BODY: ErrorEnvelope = Object.freeze({
  error: Object.freeze({
    code: 'payload_too_large',
    message: 'リクエストの本文が大きすぎます。',
  }),
});

const CACHE_CONTROL_HEADER = 'Cache-Control';

const CONTENT_SECURITY_POLICY_HEADER = 'Content-Security-Policy';

// 長さのヘッダーがあれば本文を読まずに判定し、無ければ上限を超えた時点で読むのをやめる。HonoのHTTPExceptionは共通エラーではないため、共通のエラー形式の応答を返す
function createBodyLimit<E extends GraphQLModuleEnv>(): MiddlewareHandler<
  PlatformHonoEnv<E>
> {
  return bodyLimit({
    maxSize: GRAPHQL_MAX_BODY_BYTES,
    onError: (c) =>
      c.json(PAYLOAD_TOO_LARGE_BODY, PAYLOAD_TOO_LARGE_STATUS, {
        [CACHE_CONTROL_HEADER]: 'no-store',
      }),
  });
}

function resolveAccess(
  request: Request,
  environment: AppEnvironment,
): GraphQLAccess | undefined {
  const internalCaller = readInternalCaller(request);
  if (internalCaller !== undefined) {
    return { kind: 'internal', caller: internalCaller };
  }
  return isGraphiqlRequest(environment, request)
    ? { kind: 'graphiql', caller: readDebugCaller(request) }
    : undefined;
}

function createRequestScope<E extends GraphQLModuleEnv>(
  c: GraphQLRouteContext<E>,
  access: GraphQLAccess,
): GatewayRequestScope {
  const container = c.get('container');
  return {
    access,
    container,
    correlationId: c.get('correlationId'),
    clientIp: c.get('clientIp'),
    session: createSessionAccess({
      container,
      caller: access.caller,
      token: c.req.header(GATEWAY_HEADERS.sessionToken),
    }),
    botToken: c.req.header(GATEWAY_HEADERS.botToken),
    observation: createOperationObservation(),
  };
}

function isGraphiqlPage(access: GraphQLAccess, headers: Headers): boolean {
  return (
    access.kind === 'graphiql' &&
    (headers.get('content-type') ?? '').includes('text/html')
  );
}

// Yogaの応答のヘッダーが書き換えられない場合に備え、複製したヘッダーで応答を作り直す
function finishResponse(
  response: Response,
  scope: GatewayRequestScope,
): Response {
  const headers = new Headers(response.headers);
  headers.set(CACHE_CONTROL_HEADER, 'no-store');
  applySessionInstructions(scope.session, headers);
  if (isGraphiqlPage(scope.access, headers)) {
    headers.set(
      CONTENT_SECURITY_POLICY_HEADER,
      GRAPHIQL_CONTENT_SECURITY_POLICY,
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// 受付経路の判定と後処理で作った範囲を、同じ要求の実行の段で使う
const requestScopes = new WeakMap<object, GatewayRequestScope>();

function scopeOf(c: object): GatewayRequestScope {
  const scope = requestScopes.get(c);
  if (scope === undefined) {
    throw new Error('GraphQLの要求の範囲が組み立てられていません');
  }
  return scope;
}

function admitRequest<E extends GraphQLModuleEnv>(): MiddlewareHandler<
  PlatformHonoEnv<E>
> {
  return async (c, next) => {
    const startedAt = Date.now();
    const access = resolveAccess(c.req.raw, c.env.APP_ENVIRONMENT);
    if (access === undefined) {
      throw createNotFoundError();
    }
    warnOnMissingClientIp(c.req.raw);
    const scope = createRequestScope(c, access);
    requestScopes.set(c, scope);
    await next();
    const response = finishResponse(c.res, scope);
    // Honoは応答の代入時に前の応答のヘッダーを上書きで写すため、先に外してYogaのCache-Control・CSPが後処理の値を戻さないようにする
    c.res = undefined;
    c.res = response;
    logOperation({
      caller: access.caller,
      observation: scope.observation,
      durationMs: Date.now() - startedAt,
      status: c.res.status,
    });
  };
}

// 長さのヘッダーが無い本文は上限の検査で読み切られ、c.req.rawが読み直せる要求へ差し替わるため、Yogaへは検査後の要求を渡す
function executeRequest<E extends GraphQLModuleEnv>(
  options: GraphQLModuleOptions,
): (c: GraphQLRouteContext<E>) => Response | Promise<Response> {
  return (c) =>
    getGatewayServer({
      environment: c.env.APP_ENVIRONMENT,
      schemaModules: options.schemaModules,
      allowlist: options.allowlist,
    }).fetch(c.req.raw, { scope: scopeOf(c) });
}

export function createGraphQLModule<E extends GraphQLModuleEnv>(
  options: GraphQLModuleOptions,
): AppModule<Hono<PlatformHonoEnv<E>>> {
  return {
    name: 'graphql',
    routes: (app) => {
      app.on(
        GRAPHQL_METHODS,
        GRAPHQL_PATH,
        admitRequest<E>(),
        createBodyLimit<E>(),
        executeRequest<E>(options),
      );
    },
  };
}
