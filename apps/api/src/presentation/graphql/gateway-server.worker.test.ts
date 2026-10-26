import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  ADMIN_OPERATION,
  ALLOWLIST_TYPE_DEFS,
  CLIENT_OPERATION,
} from '../../../test/fixtures/graphql/allowlist-operations.ts';
import allowlistFixture from '../../../test/fixtures/graphql/allowlist.json';
import {
  configureRecordingLogs,
  createRecordingFetch,
  type LoggedObject,
  type RecordingFetch,
  recordingSentryOptions,
} from '../../../test/support/observability-recording.ts';
import { depthQuery } from '../../../test/support/query-limit-harness.ts';
import { createInvocationContainer } from '../../../lib/workers/di/invocation-container.ts';
import {
  createSentryMiddleware,
  type SentryEnv,
} from '../../../lib/workers/observability/sentry.ts';
import {
  type AppEnvironment,
  type CallerKind,
  GATEWAY_HEADERS,
} from '../gateway/gateway-headers.ts';
import { createSessionAccess } from '../gateway/session-access.ts';
import {
  createGatewayServer,
  type GatewayRequestScope,
  type GatewayServer,
  type GatewayServerOptions,
  getGatewayServer,
  type GraphQLAccess,
} from './gateway-server.ts';
import type { GraphQLContext } from './graphql-context.ts';
import {
  createOperationObservation,
  type OperationObservation,
} from './operation-observability.ts';
import {
  defineSchemaModule,
  type GraphQLSchemaModule,
} from './schema-module.ts';

interface ResponseBody {
  readonly data?: Record<string, unknown> | null;
  readonly errors?: readonly {
    readonly message: string;
    readonly extensions?: { readonly code?: string };
  }[];
}

interface GatewayResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly observation: OperationObservation;
}

interface SendOptions {
  readonly method?: 'GET' | 'POST';
  readonly headers?: Record<string, string>;
  readonly body?: BodyInit;
}

interface Counter {
  count: number;
}

const ENDPOINT = 'http://localhost/graphql';
const CORRELATION_ID = 'correlation-gateway-server';
const CLIENT_IP = '198.51.100.55';

const UNEXPECTED_ERROR_CATEGORY = 'api.graphql.error';

const SENTRY_TEST_ENV: SentryEnv = { SENTRY_ENVIRONMENT: 'test' };

const SECRET_DETAIL = 'internal-detail-must-not-leak';

const HIDDEN_LIMIT_MESSAGE = 'Syntax Error: Query validation error.';

const EXPOSED_DEPTH_MESSAGE =
  'Syntax Error: Query depth limit of 8 exceeded, found 9.';

const INTROSPECTION_QUERY = 'query Schema { __schema { description } }';

const DEPLOYED_ENVIRONMENTS: readonly AppEnvironment[] = ['staging', 'prod'];

let resolverCalls = 0;

function documentIdOf(digit: string): string {
  return `sha256:${digit.repeat(64)}`;
}

const OPERATIONS = Object.freeze({
  introspection: { documentId: documentIdOf('1'), body: INTROSPECTION_QUERY },
  deep: { documentId: documentIdOf('2'), body: depthQuery(9) },
  typo: { documentId: documentIdOf('3'), body: 'query Typo { valeu }' },
  broken: { documentId: documentIdOf('4'), body: 'query Broken { broken }' },
  caller: { documentId: documentIdOf('5'), body: 'query Caller { caller }' },
});

const SHARED_OPERATIONS = Object.fromEntries(
  Object.values(OPERATIONS).map(({ documentId, body }) => [documentId, body]),
);

const ALLOWLIST = {
  version: 1,
  operations: {
    client: { ...allowlistFixture.operations.client, ...SHARED_OPERATIONS },
    admin: { ...allowlistFixture.operations.admin, ...SHARED_OPERATIONS },
  },
};

function counted<T>(value: T): () => T {
  return () => {
    resolverCalls += 1;
    return value;
  };
}

const ALLOWLIST_MODULE = defineSchemaModule({
  name: 'allowlist-fixture',
  typeDefs: ALLOWLIST_TYPE_DEFS,
  resolvers: {
    Query: { clientValue: counted('client'), adminValue: counted('admin') },
  },
});

const GATEWAY_MODULE = defineSchemaModule({
  name: 'gateway-fixture',
  typeDefs: /* GraphQL */ `
    type Query {
      node: Node
      value: Int
      caller: String
      broken: Int
    }

    type Node {
      child: Node
      value: Int
    }
  `,
  resolvers: {
    Query: {
      node: counted({}),
      value: counted(1),
      caller: (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        resolverCalls += 1;
        return context.caller;
      },
      broken: () => {
        resolverCalls += 1;
        throw new TypeError(`設定を読み込めませんでした: ${SECRET_DETAIL}`);
      },
    },
    Node: { child: counted({}), value: counted(1) },
  },
});

function serverOptions(environment: AppEnvironment): GatewayServerOptions {
  return {
    environment,
    schemaModules: [ALLOWLIST_MODULE, GATEWAY_MODULE],
    allowlist: ALLOWLIST,
  };
}

function internal(caller: CallerKind): GraphQLAccess {
  return { kind: 'internal', caller };
}

function graphiql(caller: CallerKind = 'client'): GraphQLAccess {
  return { kind: 'graphiql', caller };
}

function createScope(
  access: GraphQLAccess,
  observation: OperationObservation,
): GatewayRequestScope {
  const container = createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: CORRELATION_ID,
        clientIp: CLIENT_IP,
      },
    },
    [],
  );
  return {
    access,
    container,
    correlationId: CORRELATION_ID,
    clientIp: CLIENT_IP,
    session: createSessionAccess({
      container,
      caller: access.caller,
      token: undefined,
    }),
    botToken: undefined,
    observation,
  };
}

// GraphiQLの要求は内部経路のヘッダーを持たず、呼び出し元を手入力のヘッダーで指定する
function createRequest(access: GraphQLAccess, options: SendOptions): Request {
  const accessHeader: Record<string, string> =
    access.kind === 'internal'
      ? { [GATEWAY_HEADERS.caller]: access.caller }
      : { [GATEWAY_HEADERS.debugCaller]: access.caller };
  return new Request(ENDPOINT, {
    method: options.method ?? 'POST',
    headers: { ...accessHeader, ...options.headers },
    ...(options.body !== undefined && { body: options.body }),
  });
}

async function send(
  server: GatewayServer,
  access: GraphQLAccess,
  options: SendOptions,
): Promise<GatewayResponse> {
  const observation = createOperationObservation();
  const response = await server.fetch(createRequest(access, options), {
    scope: createScope(access, observation),
  });
  return {
    status: response.status,
    headers: response.headers,
    text: await response.text(),
    observation,
  };
}

function postJson(
  payload: unknown,
  headers: Record<string, string> = {},
): SendOptions {
  return {
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  };
}

function sendDocument(
  server: GatewayServer,
  access: GraphQLAccess,
  documentId: string,
): Promise<GatewayResponse> {
  return send(server, access, postJson({ documentId }));
}

function sendQuery(
  server: GatewayServer,
  access: GraphQLAccess,
  query: string,
): Promise<GatewayResponse> {
  return send(server, access, postJson({ query }));
}

function requestPage(
  server: GatewayServer,
  access: GraphQLAccess,
): Promise<GatewayResponse> {
  return send(server, access, {
    method: 'GET',
    headers: { accept: 'text/html' },
  });
}

function bodyOf(response: GatewayResponse): ResponseBody {
  return JSON.parse(response.text) as ResponseBody;
}

function errorCodesOf(response: GatewayResponse): (string | undefined)[] {
  return (bodyOf(response).errors ?? []).map((error) => error.extensions?.code);
}

function firstMessageOf(response: GatewayResponse): string | undefined {
  return bodyOf(response).errors?.[0]?.message;
}

function isHtml(response: GatewayResponse): boolean {
  return (response.headers.get('content-type') ?? '').includes('text/html');
}

// 想定外の例外の送信は要求を計装したSentryのクライアントを通して届くため、backend-platformの計装の中で呼ぶ
async function sendInstrumented(
  server: GatewayServer,
  documentId: string,
  recording: RecordingFetch,
): Promise<Response> {
  const access = internal('client');
  const app = new Hono<{ Bindings: SentryEnv }>();
  app.use(
    createSentryMiddleware(
      app,
      recordingSentryOptions(recording, { tracesSampleRate: 0 }),
    ),
  );
  app.post('/graphql', (c) =>
    server.fetch(c.req.raw, {
      scope: createScope(access, createOperationObservation()),
    }),
  );
  const ctx = createExecutionContext();
  const response = await app.fetch(
    createRequest(access, postJson({ documentId })),
    SENTRY_TEST_ENV,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

function countingSchemaModule(counter: Counter): GraphQLSchemaModule {
  return {
    name: GATEWAY_MODULE.name,
    get typeDefs() {
      counter.count += 1;
      return GATEWAY_MODULE.typeDefs;
    },
    ...(GATEWAY_MODULE.resolvers !== undefined && {
      resolvers: GATEWAY_MODULE.resolvers,
    }),
  };
}

function countingAllowlist(counter: Counter): unknown {
  return {
    get version() {
      counter.count += 1;
      return ALLOWLIST.version;
    },
    operations: ALLOWLIST.operations,
  };
}

let logs: LoggedObject[] = [];

beforeAll(() => {
  logs = configureRecordingLogs();
});

afterAll(() => {
  resetSync();
});

describe.each(DEPLOYED_ENVIRONMENTS)(
  'createGatewayServer(デプロイ先の%s)',
  (environment) => {
    const server = createGatewayServer(serverOptions(environment));

    test('内部経路の登録済みの操作を、呼び出し元の文脈で実行する', async () => {
      const response = await sendDocument(
        server,
        internal('admin'),
        OPERATIONS.caller.documentId,
      );

      expect(response.status).toBe(200);
      expect(bodyOf(response)).toStrictEqual({ data: { caller: 'admin' } });
    });

    test('許可リストに登録されたintrospectionも検証で拒否する', async () => {
      const before = resolverCalls;

      const response = await sendDocument(
        server,
        internal('client'),
        OPERATIONS.introspection.documentId,
      );

      expect(response.status).toBe(400);
      expect(errorCodesOf(response)).toStrictEqual([
        'graphql_validation_failed',
      ]);
      expect(bodyOf(response).data).toBeUndefined();
      expect(resolverCalls).toBe(before);
    });

    test('GraphiQLの画面を提供しない', async () => {
      const response = await requestPage(server, graphiql());

      expect(isHtml(response)).toBe(false);
      expect(response.text).not.toContain('GraphiQL');
    });

    test('内部経路でない要求にも、操作の本文の実行を許さない', async () => {
      const before = resolverCalls;

      const response = await sendQuery(server, graphiql(), '{ value }');

      expect(response.status).toBe(400);
      expect(errorCodesOf(response)).toStrictEqual([
        'persisted_operation_required',
      ]);
      expect(resolverCalls).toBe(before);
    });

    test('上限を超える操作は、上限値と実測値を伏せて拒否する', async () => {
      const before = resolverCalls;

      const response = await sendDocument(
        server,
        internal('client'),
        OPERATIONS.deep.documentId,
      );

      expect(response.status).toBe(400);
      expect(errorCodesOf(response)).toStrictEqual(['query_depth_exceeded']);
      expect(firstMessageOf(response)).toBe(HIDDEN_LIMIT_MESSAGE);
      expect(resolverCalls).toBe(before);
    });

    test('存在しない項目の拒否に、似た名前の項目の候補を含めない', async () => {
      const response = await sendDocument(
        server,
        internal('client'),
        OPERATIONS.typo.documentId,
      );

      expect(response.status).toBe(400);
      expect(errorCodesOf(response)).toStrictEqual([
        'graphql_validation_failed',
      ]);
      expect(response.text).not.toContain('Did you mean');
    });
  },
);

describe('createGatewayServer(ローカル)', () => {
  const server = createGatewayServer(serverOptions('local'));

  test('GraphiQLの要求にだけGraphiQLの画面を返す', async () => {
    const page = await requestPage(server, graphiql());
    const internalPage = await requestPage(server, internal('client'));

    expect(page.status).toBe(200);
    expect(isHtml(page)).toBe(true);
    expect(page.text).toContain('GraphiQL');
    expect(isHtml(internalPage)).toBe(false);
  });

  test('GraphiQLの要求は、許可リストに無い操作とintrospectionを実行できる', async () => {
    const arbitrary = await sendQuery(server, graphiql(), '{ value }');
    const introspection = await sendQuery(
      server,
      graphiql(),
      INTROSPECTION_QUERY,
    );

    expect(arbitrary.status).toBe(200);
    expect(bodyOf(arbitrary)).toStrictEqual({ data: { value: 1 } });
    expect(introspection.status).toBe(200);
    expect(bodyOf(introspection)).toStrictEqual({
      data: { __schema: { description: null } },
    });
  });

  test('GraphiQLの要求は、手入力の呼び出し元の許可リストの操作を実行できる', async () => {
    const response = await sendDocument(
      server,
      graphiql('admin'),
      ADMIN_OPERATION.documentId,
    );

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toStrictEqual({ data: { adminValue: 'admin' } });
  });

  test('内部経路の要求には、操作の本文の実行を許さない', async () => {
    const before = resolverCalls;

    const response = await sendQuery(server, internal('client'), '{ value }');

    expect(response.status).toBe(400);
    expect(errorCodesOf(response)).toStrictEqual([
      'persisted_operation_required',
    ]);
    expect(resolverCalls).toBe(before);
  });

  test('内部経路の要求は、同じ文書をGraphiQLで検証した後でもintrospectionを拒否する', async () => {
    const allowed = await sendQuery(server, graphiql(), INTROSPECTION_QUERY);

    const response = await sendDocument(
      server,
      internal('client'),
      OPERATIONS.introspection.documentId,
    );

    expect(allowed.status).toBe(200);
    expect(response.status).toBe(400);
    expect(errorCodesOf(response)).toStrictEqual(['graphql_validation_failed']);
  });

  test('内部経路の登録済みの操作を実行する', async () => {
    const response = await sendDocument(
      server,
      internal('client'),
      CLIENT_OPERATION.documentId,
    );

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toStrictEqual({ data: { clientValue: 'client' } });
  });

  test.each([
    {
      name: 'GraphiQLの要求',
      send: () => sendQuery(server, graphiql(), depthQuery(9)),
    },
    {
      name: '内部経路の要求',
      send: () =>
        sendDocument(server, internal('client'), OPERATIONS.deep.documentId),
    },
  ])(
    '$nameにも上限を適用し、上限値と実測値を示して拒否する',
    async ({ send }) => {
      const before = resolverCalls;

      const response = await send();

      expect(response.status).toBe(400);
      expect(errorCodesOf(response)).toStrictEqual(['query_depth_exceeded']);
      expect(firstMessageOf(response)).toBe(EXPOSED_DEPTH_MESSAGE);
      expect(resolverCalls).toBe(before);
    },
  );

  test('存在しない項目の拒否に、似た名前の項目の候補を含める', async () => {
    const response = await sendQuery(server, graphiql(), '{ valeu }');

    expect(response.status).toBe(400);
    expect(firstMessageOf(response)).toContain('Did you mean "value"');
  });
});

describe.each<AppEnvironment>(['local', 'staging'])(
  'createGatewayServer(%sで共通の設定)',
  (environment) => {
    const server = createGatewayServer(serverOptions(environment));

    test('2つ以上の操作をまとめた要求は、いずれも実行せずに拒否する', async () => {
      const before = resolverCalls;
      const operation = { documentId: CLIENT_OPERATION.documentId };

      const response = await send(
        server,
        internal('client'),
        postJson([operation, operation]),
      );

      expect(response.status).toBe(400);
      expect(errorCodesOf(response)).toStrictEqual(['graphql_request_invalid']);
      expect(resolverCalls).toBe(before);
    });

    test('マルチパートの要求を受け付けない', async () => {
      const before = resolverCalls;
      const form = new FormData();
      form.append(
        'operations',
        JSON.stringify({ documentId: CLIENT_OPERATION.documentId }),
      );
      form.append('map', '{}');

      const response = await send(server, internal('client'), { body: form });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.text).not.toContain('clientValue');
      expect(resolverCalls).toBe(before);
    });

    test('ブラウザのOriginを許可するCORSのヘッダーを付けない', async () => {
      const response = await send(
        server,
        internal('client'),
        postJson(
          { documentId: CLIENT_OPERATION.documentId },
          { origin: 'https://attacker.example' },
        ),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(
        response.headers.get('access-control-allow-credentials'),
      ).toBeNull();
    });

    test('同じインスタンスへの2回目の要求でも、解析と検証のキャッシュを経て操作名と種類を記録する', async () => {
      const responses = [
        await sendDocument(
          server,
          internal('client'),
          CLIENT_OPERATION.documentId,
        ),
        await sendDocument(
          server,
          internal('client'),
          CLIENT_OPERATION.documentId,
        ),
      ];

      for (const { observation } of responses) {
        expect(observation).toStrictEqual({
          operationName: 'ClientValue',
          operationType: 'query',
          errorCodes: [],
        });
      }
    });

    test('拒否した操作のエラーコードを観測の記録に残す', async () => {
      const response = await sendDocument(
        server,
        internal('client'),
        ADMIN_OPERATION.documentId,
      );

      expect(response.observation.errorCodes).toStrictEqual([
        'persisted_operation_not_found',
      ]);
    });

    test('想定外の例外は内部の詳細を伏せ、errorのログとエラートラッキングへ1回ずつ送る', async () => {
      const recording = createRecordingFetch();
      const logCount = logs.length;

      const response = await sendInstrumented(
        server,
        OPERATIONS.broken.documentId,
        recording,
      );
      const text = await response.text();
      const errorLogs = logs
        .slice(logCount)
        .filter((log) => log.category === UNEXPECTED_ERROR_CATEGORY);
      const events = recording.items.filter((item) => item.type === 'event');

      expect(text).not.toContain(SECRET_DETAIL);
      expect(JSON.parse(text)).toMatchObject({
        errors: [{ extensions: { code: 'internal_error' } }],
      });
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0]?.level).toBe('error');
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toMatchObject({
        exception: { values: [{ type: 'TypeError' }] },
      });
    });
  },
);

describe('getGatewayServer', () => {
  test('取得するまで組み立てず、環境ごとに最初の1回だけ組み立てて使い回し、許可リストは最初の要求で1回だけ検証する', async () => {
    const compositions: Counter = { count: 0 };
    const validations: Counter = { count: 0 };
    const options: GatewayServerOptions = {
      environment: 'prod',
      schemaModules: [ALLOWLIST_MODULE, countingSchemaModule(compositions)],
      allowlist: countingAllowlist(validations),
    };

    expect(compositions.count).toBe(0);

    const first = getGatewayServer(options);
    const composedCount = compositions.count;
    const second = getGatewayServer(options);

    expect(composedCount).toBeGreaterThan(0);
    expect(second).toBe(first);
    expect(validations.count).toBe(0);

    const firstResponse = await sendDocument(
      first,
      internal('client'),
      CLIENT_OPERATION.documentId,
    );
    const validatedCount = validations.count;
    const secondResponse = await sendDocument(
      second,
      internal('client'),
      CLIENT_OPERATION.documentId,
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(validatedCount).toBeGreaterThan(0);
    expect(validations.count).toBe(validatedCount);
    expect(compositions.count).toBe(composedCount);
  });

  test('環境が異なれば別のインスタンスを組み立て、それぞれの環境の設定で動く', async () => {
    const deployed = getGatewayServer(serverOptions('staging'));
    const local = getGatewayServer(serverOptions('local'));

    const deployedResponse = await sendQuery(deployed, graphiql(), '{ value }');
    const localResponse = await sendQuery(local, graphiql(), '{ value }');

    expect(local).not.toBe(deployed);
    expect(getGatewayServer(serverOptions('local'))).toBe(local);
    expect(deployedResponse.status).toBe(400);
    expect(localResponse.status).toBe(200);
  });
});
