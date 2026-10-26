import { describe, expect, test } from 'vitest';

import {
  ADMIN_SYSTEM_STATUS_OPERATION,
  CLIENT_SYSTEM_STATUS_OPERATION,
  SYSTEM_ALLOWLIST,
} from '../test/fixtures/graphql/system-allowlist.ts';
import {
  callEntrypoint,
  type EnvOverrides,
  type GatewayEntrypointClass,
} from '../test/support/gateway-test-harness.ts';
import { graphqlRequest } from '../test/support/graphql-request.ts';
import { createWorkerHandler } from '../lib/workers/handler/create-worker-handler.ts';
import { createWorkerApp } from '../lib/workers/http/create-worker-app.ts';
import {
  DEFAULT_CONTENT_SECURITY_POLICY,
  SECURITY_HEADERS,
} from '../lib/workers/http/security-headers.ts';
import {
  buildSentryOptions,
  readSentryRuntimeOptions,
} from '../lib/workers/observability/sentry.ts';
import { apiEnvSchema } from './composition/env-schema.ts';
import { GRAPHQL_SCHEMA_MODULES } from './composition/graphql-modules.ts';
import { MODULES } from './composition/modules.ts';
import { RATE_LIMIT_EXCLUSIONS } from './composition/rate-limit-exclusions.ts';
import { createGatewayEntrypointClass } from './presentation/gateway/gateway-entrypoint.ts';
import { GATEWAY_HEADERS } from './presentation/gateway/gateway-headers.ts';
import { resolveGatewayClientIp } from './presentation/gateway/internal-request.ts';
import { createGraphQLModule } from './presentation/graphql/graphql-module.ts';

interface SystemStatusBody {
  readonly data?: {
    readonly systemStatus?: {
      readonly serverTime?: string;
      readonly databaseReachable?: boolean;
    };
  } | null;
  readonly errors?: readonly {
    readonly extensions?: { readonly code?: string };
  }[];
}

const RELAYED_IP = '203.0.113.17';

const sentry = (bindings: Env) =>
  buildSentryOptions(readSentryRuntimeOptions(bindings));

// GraphQLのサーバーはisolate内で環境ごとに使い回されるため、このファイルではテスト用の許可リストで組み立てたアプリだけを呼ぶ
const testAllowlistHandler = createWorkerHandler<Env>({
  appName: 'api',
  app: createWorkerApp<Env>({
    appName: 'api',
    envSchema: apiEnvSchema,
    modules: [
      ...MODULES.filter(({ name }) => name !== 'graphql'),
      createGraphQLModule<Env>({
        schemaModules: GRAPHQL_SCHEMA_MODULES,
        allowlist: SYSTEM_ALLOWLIST,
      }),
    ],
    rateLimitExclusions: RATE_LIMIT_EXCLUSIONS,
    resolveClientIp: resolveGatewayClientIp,
    sentry,
  }),
  envSchema: apiEnvSchema,
  sentry,
});

class TestClientGateway extends createGatewayEntrypointClass(
  'client',
  testAllowlistHandler,
) {}

class TestAdminGateway extends createGatewayEntrypointClass(
  'admin',
  testAllowlistHandler,
) {}

const ENVIRONMENTS: readonly [string, EnvOverrides][] = [
  ['ローカル環境', {}],
  ['staging', { APP_ENVIRONMENT: 'staging' }],
  ['prod', { APP_ENVIRONMENT: 'prod' }],
];

function operationRequest(documentId: string): Request {
  return graphqlRequest(documentId, undefined, {
    headers: { [GATEWAY_HEADERS.clientIp]: RELAYED_IP },
  });
}

async function call(
  Entrypoint: GatewayEntrypointClass,
  documentId: string,
  overrides: EnvOverrides,
): Promise<Response> {
  return callEntrypoint(Entrypoint, operationRequest(documentId), overrides);
}

function expectSecurityHeaders(response: Response): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(response.headers.get(name)).toBe(value);
  }
  expect(response.headers.get('Content-Security-Policy')).toBe(
    DEFAULT_CONTENT_SECURITY_POLICY,
  );
}

describe('テスト用の許可リストで組み立てたアプリの名前付きエントリポイント', () => {
  test.each(ENVIRONMENTS)(
    '%sでは、利用者側の名前付きエントリポイント経由で登録済みのsystemStatusを実行する',
    async (_label, overrides) => {
      const response = await call(
        TestClientGateway,
        CLIENT_SYSTEM_STATUS_OPERATION.documentId,
        overrides,
      );
      const body = await response.json<SystemStatusBody>();

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expectSecurityHeaders(response);
      expect(body.errors).toBeUndefined();
      expect(body.data?.systemStatus?.databaseReachable).toBe(true);
      expect(
        Number.isNaN(Date.parse(body.data?.systemStatus?.serverTime ?? '')),
      ).toBe(false);
    },
  );

  test('管理者側の名前付きエントリポイント経由で、管理者側に登録済みの操作を実行する', async () => {
    const response = await call(
      TestAdminGateway,
      ADMIN_SYSTEM_STATUS_OPERATION.documentId,
      {},
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({
      data: { systemStatus: { databaseReachable: true } },
    });
  });

  test('利用者側の名前付きエントリポイントへの要求が管理者側を名乗っても、利用者側の許可リストで照会して管理者側の操作を拒否する', async () => {
    const response = await callEntrypoint(
      TestClientGateway,
      graphqlRequest(ADMIN_SYSTEM_STATUS_OPERATION.documentId, undefined, {
        headers: {
          [GATEWAY_HEADERS.caller]: 'admin',
          [GATEWAY_HEADERS.clientIp]: RELAYED_IP,
        },
      }),
    );
    const body = await response.json<SystemStatusBody>();

    expect(response.status).toBe(400);
    expectSecurityHeaders(response);
    expect(body.data).toBeUndefined();
    expect(body.errors?.map((error) => error.extensions?.code)).toEqual([
      'persisted_operation_not_found',
    ]);
  });

  test.each(ENVIRONMENTS)(
    '%sでは、利用者側から管理者側の操作を、管理者側から利用者側の操作を未登録として拒否する',
    async (_label, overrides) => {
      const responses = [
        await call(
          TestClientGateway,
          ADMIN_SYSTEM_STATUS_OPERATION.documentId,
          overrides,
        ),
        await call(
          TestAdminGateway,
          CLIENT_SYSTEM_STATUS_OPERATION.documentId,
          overrides,
        ),
      ];

      for (const response of responses) {
        const body = await response.json<SystemStatusBody>();
        expect(response.status).toBe(400);
        expectSecurityHeaders(response);
        expect(body.data).toBeUndefined();
        expect(body.errors?.map((error) => error.extensions?.code)).toEqual([
          'persisted_operation_not_found',
        ]);
      }
    },
  );
});
