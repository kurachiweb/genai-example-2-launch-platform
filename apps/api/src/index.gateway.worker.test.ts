import { afterEach, describe, expect, test, vi } from 'vitest';

import { CLIENT_SYSTEM_STATUS_OPERATION } from '../test/fixtures/graphql/system-allowlist.ts';
import {
  callInternal,
  callPublic,
  type EnvOverrides,
  failingRateLimiter,
  recordingRateLimiter,
  type TestEnv,
} from '../test/support/gateway-test-harness.ts';
import {
  API_ORIGIN,
  GRAPHQL_URL,
  graphqlRequest,
} from '../test/support/graphql-request.ts';
import type { LoggedObject } from '../test/support/observability-recording.ts';
import {
  INTERNAL_ERROR_RESPONSE,
  NOT_FOUND_RESPONSE,
} from '../lib/core/errors/error-envelope.ts';
import {
  DEFAULT_CONTENT_SECURITY_POLICY,
  SECURITY_HEADERS,
} from '../lib/workers/http/security-headers.ts';
import {
  type AppEnvironment,
  type CallerKind,
  GATEWAY_HEADERS,
} from './presentation/gateway/gateway-headers.ts';
import { GRAPHIQL_CONTENT_SECURITY_POLICY } from './presentation/graphql/graphql-module.ts';

interface GraphQLResponseBody {
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

interface ExternalRequestInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

const CALLERS = ['client', 'admin'] as const satisfies readonly CallerKind[];
const DEPLOYED_ENVIRONMENTS = [
  'staging',
  'prod',
] as const satisfies readonly AppEnvironment[];

const CONNECTING_IP = '198.51.100.20';
const RELAYED_IP = '203.0.113.7';
const FORGED_IP = '192.0.2.99';
const OPENAPI_URL = `${API_ORIGIN}/v1/openapi.json`;
const CLIENT_IP_CATEGORY = 'api.gateway.client-ip';
const SYSTEM_STATUS_QUERY =
  'query GraphiqlStatus { systemStatus { databaseReachable } }';

const CORS_HEADER_NAMES = [
  'Access-Control-Allow-Origin',
  'Access-Control-Allow-Methods',
  'Access-Control-Allow-Headers',
  'Access-Control-Max-Age',
  'Access-Control-Allow-Credentials',
];

function deployed(environment: AppEnvironment): EnvOverrides {
  return { APP_ENVIRONMENT: environment };
}

function externalRequest(url: string, init: ExternalRequestInit = {}): Request {
  return new Request(url, {
    method: init.method ?? 'GET',
    headers: { 'CF-Connecting-IP': CONNECTING_IP, ...init.headers },
    ...(init.body !== undefined && { body: init.body }),
  });
}

function graphiqlQuery(headers: Record<string, string> = {}): Request {
  return externalRequest(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ query: SYSTEM_STATUS_QUERY }),
  });
}

function relayedOperation(clientIp?: string): Request {
  return graphqlRequest(CLIENT_SYSTEM_STATUS_OPERATION.documentId, undefined, {
    headers:
      clientIp === undefined ? {} : { [GATEWAY_HEADERS.clientIp]: clientIp },
  });
}

function expectSecurityHeaders(
  response: Response,
  contentSecurityPolicy: string = DEFAULT_CONTENT_SECURITY_POLICY,
): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(response.headers.get(name)).toBe(value);
  }
  expect(response.headers.get('Content-Security-Policy')).toBe(
    contentSecurityPolicy,
  );
}

function expectPublicApiCors(response: Response): void {
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
    'GET, OPTIONS',
  );
  expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
    'Authorization',
  );
  expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
}

function expectNoCors(response: Response): void {
  for (const name of CORS_HEADER_NAMES) {
    expect(response.headers.get(name)).toBeNull();
  }
}

async function errorCodesOf(response: Response): Promise<unknown[]> {
  const body = await response.json<GraphQLResponseBody>();
  return (body.errors ?? []).map((error) => error.extensions?.code);
}

// 実際の結線はWorkerの処理の開始時にログの出力先を大域のconsoleへ設定し直すため、consoleの警告を記録する
function recordWarnings(): LoggedObject[] {
  const warnings: LoggedObject[] = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args[0] as LoggedObject);
  });
  return warnings;
}

function clientIpLogs(warnings: readonly LoggedObject[]): LoggedObject[] {
  return warnings.filter((log) => log.category === CLIENT_IP_CATEGORY);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('内部経路(名前付きエントリポイント)の実際の結線', () => {
  test.each(CALLERS)(
    '%sの名前付きエントリポイントは、コミットした許可リストに無い操作を未登録として拒否する',
    async (caller) => {
      const response = await callInternal(caller, relayedOperation(RELAYED_IP));

      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expectSecurityHeaders(response);
      expectNoCors(response);
      expect(await errorCodesOf(response)).toStrictEqual([
        'persisted_operation_not_found',
      ]);
    },
  );

  test('名前付きエントリポイントは、操作の識別子を持たない本文だけの要求を拒否する', async () => {
    const response = await callInternal(
      'client',
      new Request(GRAPHQL_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: SYSTEM_STATUS_QUERY }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await errorCodesOf(response)).toStrictEqual([
      'persisted_operation_required',
    ]);
  });

  test.each(DEPLOYED_ENVIRONMENTS)(
    'デプロイ先環境(%s)でも、未登録の操作を拒否する',
    async (environment) => {
      const response = await callInternal(
        'admin',
        relayedOperation(RELAYED_IP),
        deployed(environment),
      );

      expect(response.status).toBe(400);
      expectSecurityHeaders(response);
      expect(await errorCodesOf(response)).toStrictEqual([
        'persisted_operation_not_found',
      ]);
    },
  );

  test('引き継いだクライアントIPでIP制限を数える', async () => {
    const warnings = recordWarnings();
    const limiter = recordingRateLimiter();

    await callInternal('client', relayedOperation(RELAYED_IP), {
      IP_RATE_LIMITER: limiter.binding,
    });

    expect(limiter.keys).toStrictEqual([`ip:${RELAYED_IP}`]);
    expect(clientIpLogs(warnings)).toStrictEqual([]);
  });

  test('クライアントIPが引き継がれなければ、接続元ではなく不明として数え、値を含めずに警告する', async () => {
    const warnings = recordWarnings();
    const limiter = recordingRateLimiter();

    await callInternal(
      'client',
      graphqlRequest(CLIENT_SYSTEM_STATUS_OPERATION.documentId, undefined, {
        headers: { 'CF-Connecting-IP': CONNECTING_IP },
      }),
      { IP_RATE_LIMITER: limiter.binding },
    );

    expect(limiter.keys).toStrictEqual(['ip:unknown']);
    expect(clientIpLogs(warnings)).toMatchObject([{ reason: 'missing' }]);
    expect(JSON.stringify(clientIpLogs(warnings))).not.toContain(CONNECTING_IP);
  });

  test('IP制限の超過は、CORSのヘッダーを付けずにセキュリティヘッダー付きの429で応答する', async () => {
    const limiter = recordingRateLimiter(false);

    const response = await callInternal(
      'client',
      relayedOperation(RELAYED_IP),
      { IP_RATE_LIMITER: limiter.binding },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('10');
    expectSecurityHeaders(response);
    expectNoCors(response);
    expect(await response.json()).toMatchObject({
      error: { code: 'rate_limit_exceeded' },
    });
  });

  test('アプリの中で想定外の例外が起きても、共通のエラー形式の500にセキュリティヘッダーを付けて応答する', async () => {
    const response = await callInternal('admin', relayedOperation(RELAYED_IP), {
      IP_RATE_LIMITER: failingRateLimiter,
    });

    expect(response.status).toBe(INTERNAL_ERROR_RESPONSE.status);
    expect(await response.json()).toStrictEqual(INTERNAL_ERROR_RESPONSE.body);
    expectSecurityHeaders(response);
  });
});

describe('外部経路(既定のエクスポート)の実際の結線', () => {
  test('ローカル環境のGraphiQLの経路で、登録箇所のsystemStatusを実行できる', async () => {
    const response = await callPublic(graphiqlQuery());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expectSecurityHeaders(response);
    expectNoCors(response);
    expect(await response.json()).toStrictEqual({
      data: { systemStatus: { databaseReachable: true } },
    });
  });

  test('ローカル環境のGraphiQLの画面は、画面用のCSPとセキュリティヘッダーを付けて返す', async () => {
    const response = await callPublic(
      externalRequest(GRAPHQL_URL, { headers: { accept: 'text/html' } }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expectSecurityHeaders(response, GRAPHIQL_CONTENT_SECURITY_POLICY);
  });

  test('外部経路が名乗る呼び出し元と元のクライアントIPを信頼せず、GraphiQLの要求として接続元のIPで数える', async () => {
    const limiter = recordingRateLimiter();

    const response = await callPublic(
      graphiqlQuery({
        [GATEWAY_HEADERS.caller]: 'admin',
        [GATEWAY_HEADERS.clientIp]: FORGED_IP,
      }),
      { IP_RATE_LIMITER: limiter.binding },
    );

    expect(response.status).toBe(200);
    expect(limiter.keys).toStrictEqual([`ip:${CONNECTING_IP}`]);
  });

  test.each(DEPLOYED_ENVIRONMENTS)(
    'デプロイ先環境(%s)では、GraphQLの操作・GraphiQLの画面・呼び出し元を名乗る要求がいずれも404になる',
    async (environment) => {
      const responses = [
        await callPublic(graphiqlQuery(), deployed(environment)),
        await callPublic(
          externalRequest(GRAPHQL_URL, { headers: { accept: 'text/html' } }),
          deployed(environment),
        ),
        await callPublic(
          graphiqlQuery({ [GATEWAY_HEADERS.caller]: 'client' }),
          deployed(environment),
        ),
      ];

      for (const response of responses) {
        expect(response.status).toBe(NOT_FOUND_RESPONSE.status);
        expectSecurityHeaders(response);
        expectNoCors(response);
        expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
      }
    },
  );

  test.each<[string, EnvOverrides | undefined]>([
    ['ローカル環境', undefined],
    ['staging', deployed('staging')],
    ['prod', deployed('prod')],
  ])(
    '%sの内部RESTは、呼び出し元を名乗っても外部経路では404になる',
    async (_label, overrides) => {
      const response = await callPublic(
        externalRequest(`${API_ORIGIN}/internal/files`, {
          headers: {
            [GATEWAY_HEADERS.caller]: 'client',
            [GATEWAY_HEADERS.clientIp]: FORGED_IP,
          },
        }),
        overrides,
      );

      expect(response.status).toBe(NOT_FOUND_RESPONSE.status);
      expectSecurityHeaders(response);
      expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
    },
  );

  test('公開APIの経路でも、呼び出し元と元のクライアントIPを名乗るヘッダーを無視し、接続元のIPでIP制限を数える', async () => {
    const limiter = recordingRateLimiter();

    const response = await callPublic(
      externalRequest(OPENAPI_URL, {
        headers: {
          [GATEWAY_HEADERS.caller]: 'admin',
          [GATEWAY_HEADERS.clientIp]: FORGED_IP,
        },
      }),
      { IP_RATE_LIMITER: limiter.binding },
    );

    expect(response.status).toBe(200);
    expect(limiter.keys).toStrictEqual([`ip:${CONNECTING_IP}`]);
  });

  test('公開APIの仕様を、CORSとセキュリティのヘッダーを付けて配信する', async () => {
    const response = await callPublic(externalRequest(OPENAPI_URL));

    expect(response.status).toBe(200);
    expectPublicApiCors(response);
    expectSecurityHeaders(response);
    expect(await response.json()).toMatchObject({
      openapi: '3.1.0',
      info: { title: 'Launch Stadium Public API', version: '1.0.0' },
      servers: [{ url: '/v1' }],
    });
  });

  test('公開APIのプリフライトに、CORSとセキュリティのヘッダーを付けて204で応答する', async () => {
    const response = await callPublic(
      externalRequest(OPENAPI_URL, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://tools.example',
          'Access-Control-Request-Method': 'GET',
        },
      }),
    );

    expect(response.status).toBe(204);
    expectPublicApiCors(response);
    expectSecurityHeaders(response);
  });

  test.each(DEPLOYED_ENVIRONMENTS)(
    'デプロイ先環境(%s)の公開APIでのIP制限の超過は、CORSとセキュリティのヘッダー付きの429になる',
    async (environment) => {
      const limiter = recordingRateLimiter(false);

      const response = await callPublic(externalRequest(OPENAPI_URL), {
        ...deployed(environment),
        IP_RATE_LIMITER: limiter.binding,
      });

      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('10');
      expectPublicApiCors(response);
      expectSecurityHeaders(response);
    },
  );

  test('公開APIの未登録の経路は、CORSのヘッダー付きの共通のエラー形式の404になる', async () => {
    const response = await callPublic(
      externalRequest(`${API_ORIGIN}/v1/unregistered`),
    );

    expect(response.status).toBe(NOT_FOUND_RESPONSE.status);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expectSecurityHeaders(response);
    expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
  });

  test('ヘルスチェックにはCORSのヘッダーを付けずにセキュリティヘッダーを付ける', async () => {
    const response = await callPublic(
      externalRequest(`${API_ORIGIN}/health`),
      deployed('prod'),
    );

    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
    expectNoCors(response);
  });

  test('環境の検証の失敗も、公開APIの経路ではCORSとセキュリティのヘッダー付きの500になる', async () => {
    const response = await callPublic(externalRequest(OPENAPI_URL), {
      APP_ENVIRONMENT: 'unknown' as TestEnv['APP_ENVIRONMENT'],
    });

    expect(response.status).toBe(INTERNAL_ERROR_RESPONSE.status);
    expectPublicApiCors(response);
    expectSecurityHeaders(response);
  });

  test('アプリの中で想定外の例外が起きても、公開APIの経路ではCORSとセキュリティのヘッダー付きの500になる', async () => {
    const response = await callPublic(externalRequest(OPENAPI_URL), {
      IP_RATE_LIMITER: failingRateLimiter,
    });

    expect(response.status).toBe(INTERNAL_ERROR_RESPONSE.status);
    expect(await response.json()).toStrictEqual(INTERNAL_ERROR_RESPONSE.body);
    expectPublicApiCors(response);
    expectSecurityHeaders(response);
  });
});
