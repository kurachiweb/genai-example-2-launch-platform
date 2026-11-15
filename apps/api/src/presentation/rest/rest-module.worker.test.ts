import { createRoute, z } from '@hono/zod-openapi';
import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';

import {
  configureRecordingLogs,
  createRecordingFetch,
  type RecordingFetch,
  recordingSentryOptions,
} from '../../../test/support/observability-recording.ts';
import { NOT_FOUND_RESPONSE } from '../../../lib/core/errors/error-envelope.ts';
import { platformEnvShape } from '../../../lib/workers/env/platform-env.ts';
import { createWorkerApp } from '../../../lib/workers/http/create-worker-app.ts';
import type { PlatformHonoEnv } from '../../../lib/workers/http/hono-env.ts';
import {
  API_KEY_SECURITY,
  PUBLIC_API_BASE_PATH,
  type PublicRestRoutes,
} from './public-api-app.ts';
import { dataEnvelope, errorResponses } from './responses.ts';
import {
  createRestModule,
  type RestModule,
  type RestModuleOptions,
} from './rest-module.ts';

type TestEnv = typeof env;
type TestApp = Hono<PlatformHonoEnv<TestEnv>>;

interface OpenApiDocument {
  readonly openapi: string;
  readonly info: Record<string, unknown>;
  readonly servers: readonly Record<string, unknown>[];
  readonly paths: Record<string, Record<string, unknown>>;
  readonly components?: {
    readonly securitySchemes?: Record<string, unknown>;
  };
}

interface InvokeOptions {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

interface TestServer {
  readonly app: TestApp;
  readonly rest: RestModule<TestEnv>;
  readonly sentry: RecordingFetch;
}

const BASE_URL = 'https://api.launch.example';
const CLIENT_IP = '198.51.100.23';
const OPENAPI_URL_PATH = `${PUBLIC_API_BASE_PATH}/openapi.json`;
const DEFAULT_INFO = { title: 'Launch Stadium Public API', version: '1.0.0' };

const itemSchema = z.object({ title: z.string().min(1) });

const createItemRoute = createRoute({
  method: 'post',
  path: '/items',
  security: [...API_KEY_SECURITY],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: itemSchema } },
    },
  },
  responses: {
    201: {
      description: '作成した項目',
      content: { 'application/json': { schema: dataEnvelope(itemSchema) } },
    },
    ...errorResponses([400]),
  },
});

const getItemRoute = createRoute({
  method: 'get',
  path: '/items/{itemId}',
  request: { params: z.object({ itemId: z.string() }) },
  responses: {
    200: {
      description: '項目',
      content: { 'application/json': { schema: dataEnvelope(itemSchema) } },
    },
  },
});

const failingRoute = createRoute({
  method: 'get',
  path: '/failing',
  responses: { 204: { description: '内容なし' } },
});

const itemRoutes: PublicRestRoutes<TestEnv> = (api) => {
  api.openapi(createItemRoute, (c) =>
    c.json({ data: c.req.valid('json') }, 201),
  );
  api.openapi(getItemRoute, (c) =>
    c.json({ data: { title: c.req.valid('param').itemId } }, 200),
  );
};

const failingRoutes: PublicRestRoutes<TestEnv> = (api) => {
  api.openapi(failingRoute, () => {
    throw new Error('想定外の失敗');
  });
};

function createTestServer(
  routes: readonly PublicRestRoutes<TestEnv>[],
  options?: RestModuleOptions,
): TestServer {
  const sentry = createRecordingFetch();
  const rest = createRestModule<TestEnv>(routes, options);
  const app = createWorkerApp<TestEnv>({
    appName: 'api',
    envSchema: z.object(platformEnvShape),
    modules: [rest.module],
    rateLimitExclusions: [],
    sentry: recordingSentryOptions(sentry, { tracesSampleRate: 0 }),
  });
  return { app, rest, sentry };
}

async function invoke(
  app: TestApp,
  path: string,
  options: InvokeOptions = {},
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: { 'CF-Connecting-IP': CLIENT_IP, ...options.headers },
      ...(options.body !== undefined && { body: options.body }),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

async function fetchDocument(app: TestApp): Promise<OpenApiDocument> {
  const response = await invoke(app, OPENAPI_URL_PATH);
  expect(response.status).toBe(200);
  return response.json<OpenApiDocument>();
}

function errorEvents(sentry: RecordingFetch): unknown[] {
  return sentry.items.filter((item) => item.type === 'event');
}

afterAll(() => {
  resetSync();
});

describe('createRestModuleの仕様の配信', () => {
  test('認証なしの要求にOpenAPI 3.1の仕様を返し、相対のサーバーで基準パスを示す', async () => {
    const { app } = createTestServer([itemRoutes]);

    const response = await invoke(app, OPENAPI_URL_PATH);
    const document = await response.json<OpenApiDocument>();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(document.openapi).toBe('3.1.0');
    expect(document.servers).toStrictEqual([{ url: '/v1' }]);
    expect(document.servers[0]?.url).toBe(PUBLIC_API_BASE_PATH);
  });

  test('登録した経路と認証方式を、基準パスを含まないパスで仕様に含める', async () => {
    const { app } = createTestServer([itemRoutes]);

    const document = await fetchDocument(app);

    expect(Object.keys(document.paths).sort()).toStrictEqual([
      '/items',
      '/items/{itemId}',
    ]);
    expect(Object.keys(document.paths['/items'] ?? {})).toStrictEqual(['post']);
    expect(document.paths['/items']?.post).toMatchObject({
      security: [{ ApiKeyAuth: [] }],
    });
    expect(Object.keys(document.paths['/items/{itemId}'] ?? {})).toStrictEqual([
      'get',
    ]);
    expect(document.components?.securitySchemes).toStrictEqual({
      ApiKeyAuth: { type: 'http', scheme: 'bearer' },
    });
  });

  test('複数の登録箇所の経路をすべて仕様に含める', async () => {
    const { app } = createTestServer([itemRoutes, failingRoutes]);

    const document = await fetchDocument(app);

    expect(Object.keys(document.paths).sort()).toStrictEqual([
      '/failing',
      '/items',
      '/items/{itemId}',
    ]);
  });

  test('仕様書の情報を渡さなければ既定の題名と版で、説明を持たない', async () => {
    const { app } = createTestServer([]);

    const document = await fetchDocument(app);

    expect(document.info).toStrictEqual(DEFAULT_INFO);
  });

  test('仕様書の情報を渡せば、題名・版・説明をその値にする', async () => {
    const info = {
      title: '指定の公開API',
      version: '2.3.4',
      description: '指定の説明',
    };
    const { app } = createTestServer([], { info });

    const document = await fetchDocument(app);

    expect(document.info).toStrictEqual(info);
  });

  test('説明の無い仕様書の情報を渡せば、既定の値と合成せず渡した値だけにする', async () => {
    const info = { title: '指定の公開API', version: '2.3.4' };
    const { app } = createTestServer([], { info });

    const document = await fetchDocument(app);

    expect(document.info).toStrictEqual(info);
  });
});

describe('createRestModuleの経路', () => {
  test('登録した経路を基準パスの下で公開する', async () => {
    const { app } = createTestServer([itemRoutes]);

    const created = await invoke(app, `${PUBLIC_API_BASE_PATH}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'abc' }),
    });
    const found = await invoke(app, `${PUBLIC_API_BASE_PATH}/items/xyz`);

    expect(created.status).toBe(201);
    expect(await created.json()).toStrictEqual({ data: { title: 'abc' } });
    expect(found.status).toBe(200);
    expect(await found.json()).toStrictEqual({ data: { title: 'xyz' } });
  });

  test.each([
    ['登録した経路', `${PUBLIC_API_BASE_PATH}/items`],
    ['パスの変数を含む登録した経路', `${PUBLIC_API_BASE_PATH}/items/xyz`],
    ['仕様の経路', OPENAPI_URL_PATH],
    ['基準パスの下の未登録の経路', `${PUBLIC_API_BASE_PATH}/missing`],
    ['基準パスそのもの', PUBLIC_API_BASE_PATH],
  ])(
    '%sへのプリフライトは認証なしで本文の無い204になる',
    async (_label, path) => {
      const { app } = createTestServer([itemRoutes]);

      const response = await invoke(app, path, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.example',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, content-type',
        },
      });

      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
    },
  );

  test.each([
    ['未登録の経路', 'GET', `${PUBLIC_API_BASE_PATH}/missing`],
    ['登録していないメソッド', 'DELETE', `${PUBLIC_API_BASE_PATH}/items`],
    ['仕様の経路への更新系のメソッド', 'POST', OPENAPI_URL_PATH],
    ['基準パスそのもの', 'GET', PUBLIC_API_BASE_PATH],
  ])(
    '基準パスの下の%sは404と未登録の経路と同じ共通のエラー形式になる',
    async (_label, method, path) => {
      const { app } = createTestServer([itemRoutes]);

      const response = await invoke(app, path, { method });

      expect(response.status).toBe(NOT_FOUND_RESPONSE.status);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
    },
  );

  test('登録が空なら仕様の配信だけを公開し、仕様に経路を含めない', async () => {
    const { app, rest } = createTestServer([]);

    const document = await fetchDocument(app);
    const items = await invoke(app, `${PUBLIC_API_BASE_PATH}/items`);

    expect(document.paths).toStrictEqual({});
    expect(document.components?.securitySchemes).toStrictEqual({
      ApiKeyAuth: { type: 'http', scheme: 'bearer' },
    });
    expect(items.status).toBe(404);
    expect(rest.routeTable.methodsFor(OPENAPI_URL_PATH)).toStrictEqual(['GET']);
    expect(
      rest.routeTable.methodsFor(`${PUBLIC_API_BASE_PATH}/items`),
    ).toStrictEqual([]);
  });

  test('経路の表は登録したすべての経路と仕様の経路を受け付けるメソッドに含める', () => {
    const { rest } = createTestServer([itemRoutes, failingRoutes]);

    expect(
      rest.routeTable.methodsFor(`${PUBLIC_API_BASE_PATH}/items`),
    ).toStrictEqual(['POST']);
    expect(
      rest.routeTable.methodsFor(`${PUBLIC_API_BASE_PATH}/items/xyz`),
    ).toStrictEqual(['GET']);
    expect(
      rest.routeTable.methodsFor(`${PUBLIC_API_BASE_PATH}/failing`),
    ).toStrictEqual(['GET']);
    expect(rest.routeTable.methodsFor(OPENAPI_URL_PATH)).toStrictEqual(['GET']);
  });
});

describe('createRestModuleのエラー', () => {
  test('検証の失敗は400、本文の形式の不一致は415の共通のエラー形式になり、エラートラッキングへ送らない', async () => {
    configureRecordingLogs();
    const { app, sentry } = createTestServer([itemRoutes]);

    const invalid = await invoke(app, `${PUBLIC_API_BASE_PATH}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    });
    const malformed = await invoke(app, `${PUBLIC_API_BASE_PATH}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad',
    });
    const unsupported = await invoke(app, `${PUBLIC_API_BASE_PATH}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ title: 'abc' }),
    });

    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: { code: 'validation_error', details: [{ field: 'title' }] },
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      error: {
        code: 'validation_error',
        details: [{ field: '', code: 'invalid_json' }],
      },
    });
    expect(unsupported.status).toBe(415);
    expect(await unsupported.json()).toMatchObject({
      error: { code: 'unsupported_media_type' },
    });
    expect(errorEvents(sentry)).toStrictEqual([]);
  });

  test('経路の想定外の例外は500になり、エラートラッキングへ1回送る', async () => {
    configureRecordingLogs();
    const { app, sentry } = createTestServer([failingRoutes]);

    const response = await invoke(app, `${PUBLIC_API_BASE_PATH}/failing`);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: { code: 'internal_error' },
    });
    expect(errorEvents(sentry)).toHaveLength(1);
  });
});
