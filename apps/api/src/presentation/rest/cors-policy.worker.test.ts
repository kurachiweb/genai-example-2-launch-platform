import { createRoute, z } from '@hono/zod-openapi';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  createErrorHandler,
  handleNotFound,
} from '../../../lib/workers/http/error-handler.ts';
import type { PlatformHonoEnv } from '../../../lib/workers/http/hono-env.ts';
import { createPublicEntrypoint } from '../gateway/public-entrypoint.ts';
import { createPublicApiCorsPolicy } from './cors-policy.ts';
import {
  createPublicApiApp,
  PUBLIC_API_BASE_PATH,
  type PublicApiApp,
} from './public-api-app.ts';
import { createRouteTable, type PublicRouteTable } from './route-table.ts';

type TestEnv = typeof env;

const API_ORIGIN = 'https://api.launch.example';
const RATE_LIMITED_QUERY = 'rate-limited';

const CORS_HEADER_NAMES = [
  'Access-Control-Allow-Origin',
  'Access-Control-Allow-Methods',
  'Access-Control-Allow-Headers',
  'Access-Control-Max-Age',
  'Access-Control-Allow-Credentials',
  'Access-Control-Expose-Headers',
] as const;

const noContent = { 204: { description: '内容なし' } } as const;

function registerTestRoutes(api: PublicApiApp<TestEnv>): void {
  api.openapi(
    createRoute({ method: 'get', path: '/items', responses: noContent }),
    (c) => c.body(null, 204),
  );
  api.openapi(
    createRoute({
      method: 'post',
      path: '/items',
      request: {
        body: {
          required: true,
          content: {
            'application/json': { schema: z.object({ title: z.string() }) },
          },
        },
      },
      responses: noContent,
    }),
    (c) => c.body(null, 204),
  );
  api.openapi(
    createRoute({
      method: 'get',
      path: '/items/{itemId}',
      responses: noContent,
    }),
    (c) => c.body(null, 204),
  );
  api.openapi(
    createRoute({
      method: 'delete',
      path: '/items/{itemId}',
      responses: noContent,
    }),
    (c) => c.body(null, 204),
  );
  api.openapi(
    createRoute({
      method: 'put',
      path: '/items/{itemId}/tags/{tag}',
      responses: noContent,
    }),
    (c) => c.body(null, 204),
  );
  api.openapi(
    createRoute({
      method: 'patch',
      path: '/items/{itemId}/title',
      responses: noContent,
    }),
    (c) => c.body(null, 204),
  );
}

// 公開RESTのモジュールの組み立て(プリフライトの経路・IP制限)を、テストの範囲で模した外部経路の入口を作る
function createTestEntrypoint(): {
  readonly entrypoint: ExportedHandler<TestEnv>;
  readonly table: PublicRouteTable;
} {
  const api = createPublicApiApp<TestEnv>();
  registerTestRoutes(api);
  api.get('/openapi.json', (c) => c.json({ openapi: '3.1.0' }));
  api.options('/*', (c) => c.body(null, 204));
  const table = createRouteTable(api);

  const app = new Hono<PlatformHonoEnv<TestEnv>>();
  app.use(async (c, next) => {
    if (c.req.query(RATE_LIMITED_QUERY) !== undefined) {
      throw new AppError({
        kind: 'rate_limited',
        code: 'rate_limited',
        message: 'リクエストが多すぎます。',
        retryAfterSeconds: 30,
      });
    }
    await next();
  });
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.get('/v10/items', (c) => c.body(null, 204));
  app.route(PUBLIC_API_BASE_PATH, api);
  app.notFound(handleNotFound);
  app.onError(createErrorHandler('api'));

  const entrypoint = createPublicEntrypoint<TestEnv>(
    { fetch: (request, testEnv) => app.fetch(request, testEnv) },
    { cors: createPublicApiCorsPolicy(table) },
  );
  return { entrypoint, table };
}

async function send(
  path: string,
  init?: RequestInit<IncomingRequestCfProperties>,
): Promise<Response> {
  const { entrypoint } = createTestEntrypoint();
  const ctx = createExecutionContext();
  const response = await entrypoint.fetch?.(
    new Request<unknown, IncomingRequestCfProperties>(
      `${API_ORIGIN}${path}`,
      init,
    ),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  if (response === undefined) {
    throw new Error('fetchハンドラーがありません');
  }
  return response;
}

function readCorsHeaders(response: Response): Record<string, string> {
  return Object.fromEntries(
    CORS_HEADER_NAMES.flatMap((name) => {
      const value = response.headers.get(name);
      return value === null ? [] : [[name, value]];
    }),
  );
}

function expectedCors(
  methods: string,
  allowHeaders: string,
): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': allowHeaders,
    'Access-Control-Max-Age': '600',
  };
}

describe('公開APIのCORSの方針(外部経路の入口の応答)', () => {
  test('登録済みの経路の成功の応答に、受け付けるメソッドと更新系のContent-Typeを付ける', async () => {
    const response = await send('/v1/items');

    expect(response.status).toBe(204);
    expect(readCorsHeaders(response)).toStrictEqual(
      expectedCors('GET, POST, OPTIONS', 'Authorization, Content-Type'),
    );
  });

  test('パスの変数を含む経路では、そのパスが受け付けるメソッドだけを列挙する', async () => {
    const response = await send('/v1/items/item-1');

    expect(response.status).toBe(204);
    expect(readCorsHeaders(response)).toStrictEqual(
      expectedCors('GET, DELETE, OPTIONS', 'Authorization'),
    );
  });

  test.each([
    ['PUT', '/v1/items/item-1/tags/new', 'PUT, OPTIONS'],
    ['PATCH', '/v1/items/item-1/title', 'PATCH, OPTIONS'],
  ])(
    '%sを受け付ける経路ではContent-Typeを許可する',
    async (_method, path, methods) => {
      const response = await send(path, { method: 'OPTIONS' });

      expect(readCorsHeaders(response)).toStrictEqual(
        expectedCors(methods, 'Authorization, Content-Type'),
      );
    },
  );

  test('プリフライトの204の応答にCORSのヘッダーを付ける', async () => {
    const response = await send('/v1/items', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://partner.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type',
      },
    });

    expect(response.status).toBe(204);
    expect(readCorsHeaders(response)).toStrictEqual(
      expectedCors('GET, POST, OPTIONS', 'Authorization, Content-Type'),
    );
  });

  test('検証の失敗の400の応答にもCORSのヘッダーを付ける', async () => {
    const response = await send('/v1/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 1 }),
    });

    expect(response.status).toBe(400);
    expect(readCorsHeaders(response)).toStrictEqual(
      expectedCors('GET, POST, OPTIONS', 'Authorization, Content-Type'),
    );
  });

  test('レート制限の超過の429の応答にもCORSのヘッダーを付ける', async () => {
    const response = await send(`/v1/items?${RATE_LIMITED_QUERY}=1`);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
    expect(readCorsHeaders(response)).toStrictEqual(
      expectedCors('GET, POST, OPTIONS', 'Authorization, Content-Type'),
    );
  });

  test('仕様の配信の経路にはGETだけを許可する', async () => {
    const response = await send('/v1/openapi.json');

    expect(response.status).toBe(200);
    expect(readCorsHeaders(response)).toStrictEqual(
      expectedCors('GET, OPTIONS', 'Authorization'),
    );
  });

  test.each([['/v1/unknown'], ['/v1/items/item-1/extra'], ['/v1']])(
    '基準パスの下の未登録のパス(%s)の404の応答には、メソッドとしてOPTIONSだけを許可する',
    async (path) => {
      const response = await send(path);

      expect(response.status).toBe(404);
      expect(readCorsHeaders(response)).toStrictEqual(
        expectedCors('OPTIONS', 'Authorization'),
      );
    },
  );

  test('基準パスの下の未登録のパスへのプリフライトにもOPTIONSだけを許可する', async () => {
    const response = await send('/v1/unknown', { method: 'OPTIONS' });

    expect(response.status).toBe(204);
    expect(readCorsHeaders(response)).toStrictEqual(
      expectedCors('OPTIONS', 'Authorization'),
    );
  });

  test.each([
    ['/health', 200],
    ['/graphql', 404],
    ['/v10/items', 204],
    ['/v1x', 404],
    ['/', 404],
  ])(
    '基準パスの外の経路(%s)の応答にはCORSのヘッダーを付けない',
    async (path, status) => {
      const response = await send(path);

      expect(response.status).toBe(status);
      expect(readCorsHeaders(response)).toStrictEqual({});
    },
  );

  test('基準パスの外への要求のレート制限の超過の応答にもCORSのヘッダーを付けない', async () => {
    const response = await send(`/health?${RATE_LIMITED_QUERY}=1`);

    expect(response.status).toBe(429);
    expect(readCorsHeaders(response)).toStrictEqual({});
  });
});

describe('createPublicApiCorsPolicy', () => {
  test('資格情報の許可と公開するヘッダーを含めない', () => {
    const { table } = createTestEntrypoint();
    const policy = createPublicApiCorsPolicy(table);

    const headers = policy.headersFor(new URL(`${API_ORIGIN}/v1/items`));

    expect(headers).toBeDefined();
    expect(Object.keys(headers ?? {})).not.toContain(
      'Access-Control-Allow-Credentials',
    );
    expect(Object.keys(headers ?? {})).not.toContain(
      'Access-Control-Expose-Headers',
    );
  });

  test('クエリと断片を見ずにパスだけで決める', () => {
    const { table } = createTestEntrypoint();
    const policy = createPublicApiCorsPolicy(table);

    const headers = policy.headersFor(
      new URL(`${API_ORIGIN}/v1/items/item-1?page=2#top`),
    );

    expect(headers?.['Access-Control-Allow-Methods']).toBe(
      'GET, DELETE, OPTIONS',
    );
  });

  test('基準パスの外ではundefinedを返す', () => {
    const { table } = createTestEntrypoint();
    const policy = createPublicApiCorsPolicy(table);

    expect(policy.headersFor(new URL(`${API_ORIGIN}/health`))).toBeUndefined();
    expect(
      policy.headersFor(new URL(`${API_ORIGIN}/v1x/items`)),
    ).toBeUndefined();
  });

  test('返すヘッダーの組は変更できない', () => {
    const { table } = createTestEntrypoint();
    const policy = createPublicApiCorsPolicy(table);

    expect(
      Object.isFrozen(policy.headersFor(new URL(`${API_ORIGIN}/v1/items`))),
    ).toBe(true);
  });
});
