import { useDisableIntrospection } from '@graphql-yoga/plugin-disable-introspection';
import { captureException } from '@sentry/cloudflare';
import { createYoga, type YogaServerInstance } from 'graphql-yoga';
import type { Container } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import {
  type AppEnvironment,
  type CallerKind,
  isDeployedEnvironment,
} from '../gateway/gateway-headers.ts';
import { readInternalCaller } from '../gateway/internal-request.ts';
import type { SessionAccess } from '../gateway/session-access.ts';
import { createErrorPolicy } from './error-policy.ts';
import {
  createGraphQLContext,
  type GraphQLContext,
} from './graphql-context.ts';
import {
  createOperationAllowlist,
  createPersistedOperationsPlugin,
} from './operation-allowlist.ts';
import {
  createOperationObservabilityPlugin,
  type OperationObservation,
} from './operation-observability.ts';
import { createQueryLimitPlugins } from './query-limits.ts';
import { composeGatewaySchema } from './schema-composer.ts';
import type { GraphQLSchemaModule } from './schema-module.ts';

export type GraphQLAccess =
  | { readonly kind: 'internal'; readonly caller: CallerKind }
  | { readonly kind: 'graphiql'; readonly caller: CallerKind };

export interface GatewayRequestScope {
  readonly access: GraphQLAccess;
  readonly container: Container;
  readonly correlationId: string;
  readonly clientIp: string | undefined;
  readonly session: SessionAccess;
  readonly botToken: string | undefined;
  readonly observation: OperationObservation;
}

export interface GatewayServerContext {
  readonly scope: GatewayRequestScope;
}

export interface GatewayServerOptions {
  readonly environment: AppEnvironment;
  readonly schemaModules: readonly GraphQLSchemaModule[];
  readonly allowlist: unknown;
}

export type GatewayServer = YogaServerInstance<
  GatewayServerContext,
  GraphQLContext
>;

const GRAPHQL_ENDPOINT = '/graphql';

const unexpectedErrorLogger = getAppLogger(['api', 'graphql', 'error']);

function reportUnexpected(error: unknown): void {
  unexpectedErrorLogger.error('想定外の例外が発生しました', { error });
  captureException(error);
}

// GraphiQLの要求は、ローカル環境で内部経路の呼び出し元を持たない要求とする。任意の操作・introspection・GraphiQLの画面を同じ判定で許す
function graphiqlRequestMatcher(
  environment: AppEnvironment,
): (request: Request) => boolean {
  if (isDeployedEnvironment(environment)) {
    return () => false;
  }
  return (request) => readInternalCaller(request) === undefined;
}

export function createGatewayServer(
  options: GatewayServerOptions,
): GatewayServer {
  const deployed = isDeployedEnvironment(options.environment);
  const isGraphiqlRequest = graphiqlRequestMatcher(options.environment);
  const errorPolicy = createErrorPolicy({ reportUnexpected });
  return createYoga<GatewayServerContext, GraphQLContext>({
    schema: composeGatewaySchema(options.schemaModules),
    graphqlEndpoint: GRAPHQL_ENDPOINT,
    batching: false,
    multipart: false,
    landingPage: false,
    // CORSは外部経路の後処理が経路ごとに決めるため、Yogaの既定(任意のOriginと資格情報を許す)を使わない
    cors: false,
    // Yogaのloggerは伏せる前の例外を出力するため使わず、想定外の例外はErrorPolicyから伏せ字を通るログへ出す
    logging: false,
    extraParamNames: ['documentId'],
    graphiql: !deployed && isGraphiqlRequest,
    maskedErrors: { maskError: errorPolicy.maskError },
    context: ({ scope }) => createGraphQLContext(scope),
    plugins: [
      ...createQueryLimitPlugins({
        exposeLimits: !deployed,
        blockFieldSuggestion: deployed,
      }),
      useDisableIntrospection({
        isDisabled: (request) => !isGraphiqlRequest(request),
      }),
      createPersistedOperationsPlugin(
        createOperationAllowlist(options.allowlist),
        { allowArbitrary: isGraphiqlRequest },
      ),
      errorPolicy.plugin,
      createOperationObservabilityPlugin(),
    ],
  });
}

const servers = new Map<AppEnvironment, GatewayServer>();

// スキーマの合成はWorkerの起動時の処理時間の制約を受けないよう、最初の要求で環境ごとに1回だけ行う
export function getGatewayServer(options: GatewayServerOptions): GatewayServer {
  const cached = servers.get(options.environment);
  if (cached !== undefined) {
    return cached;
  }
  const server = createGatewayServer(options);
  servers.set(options.environment, server);
  return server;
}
