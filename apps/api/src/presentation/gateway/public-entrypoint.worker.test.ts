import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, test } from 'vitest';

import { GATEWAY_HEADERS } from './gateway-headers.ts';
import {
  type CorsPolicy,
  createPublicEntrypoint,
} from './public-entrypoint.ts';

interface TestEnv {
  readonly LABEL: string;
}

interface ReceivedCall {
  readonly request: Request;
  readonly env: TestEnv;
  readonly ctx: ExecutionContext;
}

const TEST_ENV: TestEnv = { LABEL: 'public-entrypoint' };
const API_ORIGIN = 'https://api.launch.example';
const RELAYED_IP = '203.0.113.7';
const CORS_PATH_PREFIX = '/v1/';

const TEST_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization',
} as const;

const EXPECTED_SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
} as const;

function createTestCorsPolicy(received: URL[] = []): CorsPolicy {
  return {
    headersFor: (url) => {
      received.push(url);
      return url.pathname.startsWith(CORS_PATH_PREFIX)
        ? TEST_CORS_HEADERS
        : undefined;
    },
  };
}

function createRecordingHandler(
  respond: () => Response = () => Response.json({ status: 'ok' }),
): {
  readonly handler: ExportedHandler<TestEnv>;
  readonly calls: ReceivedCall[];
} {
  const calls: ReceivedCall[] = [];
  return {
    calls,
    handler: {
      fetch: (request, env, ctx) => {
        calls.push({ request, env, ctx });
        return respond();
      },
    },
  };
}

async function invokeFetch(
  handler: ExportedHandler<TestEnv>,
  request: Request<unknown, IncomingRequestCfProperties>,
  ctx: ExecutionContext = createExecutionContext(),
): Promise<Response> {
  const response = await handler.fetch?.(request, TEST_ENV, ctx);
  await waitOnExecutionContext(ctx);
  if (response === undefined) {
    throw new Error('fetchハンドラーがありません');
  }
  return response;
}

function expectSecurityHeaders(response: Response): void {
  for (const [name, value] of Object.entries(EXPECTED_SECURITY_HEADERS)) {
    expect(response.headers.get(name)).toBe(value);
  }
  expect(response.headers.get('Permissions-Policy')).toContain('camera=()');
}

function expectNoCorsHeaders(response: Response): void {
  for (const name of Object.keys(TEST_CORS_HEADERS)) {
    expect(response.headers.has(name)).toBe(false);
  }
}

describe('createPublicEntrypoint', () => {
  test('呼び出し元と元のクライアントIPのヘッダーを除いてから内側のハンドラーへ渡す', async () => {
    const { handler, calls } = createRecordingHandler();
    const entrypoint = createPublicEntrypoint(handler, {
      cors: createTestCorsPolicy(),
    });

    await invokeFetch(
      entrypoint,
      new Request(`${API_ORIGIN}/graphql`, {
        headers: {
          'X-Internal-Caller': 'admin',
          'X-Original-Client-IP': RELAYED_IP,
        },
      }),
    );

    const [call] = calls;
    expect(call?.request.headers.has(GATEWAY_HEADERS.caller)).toBe(false);
    expect(call?.request.headers.has(GATEWAY_HEADERS.clientIp)).toBe(false);
  });

  test('メソッド・URL・本文・他のヘッダーを保ち、環境と実行コンテキストをそのまま渡す', async () => {
    const { handler, calls } = createRecordingHandler();
    const entrypoint = createPublicEntrypoint(handler, {
      cors: createTestCorsPolicy(),
    });
    const ctx = createExecutionContext();

    await invokeFetch(
      entrypoint,
      new Request(`${API_ORIGIN}/v1/products`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [GATEWAY_HEADERS.caller]: 'client',
        },
        body: '{"name":"launch"}',
      }),
      ctx,
    );

    const [call] = calls;
    expect(call?.request.method).toBe('POST');
    expect(call?.request.url).toBe(`${API_ORIGIN}/v1/products`);
    expect(call?.request.headers.get('content-type')).toBe('application/json');
    expect(await call?.request.text()).toBe('{"name":"launch"}');
    expect(call?.env).toBe(TEST_ENV);
    expect(call?.ctx).toBe(ctx);
  });

  test('CORSの方針が返すヘッダーとセキュリティヘッダーを付け、状態と本文を保つ', async () => {
    const received: URL[] = [];
    const { handler } = createRecordingHandler(
      () => new Response('{"data":[]}', { status: 201 }),
    );
    const entrypoint = createPublicEntrypoint(handler, {
      cors: createTestCorsPolicy(received),
    });

    const response = await invokeFetch(
      entrypoint,
      new Request(`${API_ORIGIN}/v1/products?page=2`),
    );

    expect(received.map((url) => url.href)).toEqual([
      `${API_ORIGIN}/v1/products?page=2`,
    ]);
    for (const [name, value] of Object.entries(TEST_CORS_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
    expectSecurityHeaders(response);
    expect(response.status).toBe(201);
    expect(await response.text()).toBe('{"data":[]}');
  });

  test('CORSの方針が対象外とした経路には、CORSのヘッダーを付けずにセキュリティヘッダーだけを付ける', async () => {
    const { handler } = createRecordingHandler(() =>
      Response.json({ status: 'ok' }),
    );
    const entrypoint = createPublicEntrypoint(handler, {
      cors: createTestCorsPolicy(),
    });

    const response = await invokeFetch(
      entrypoint,
      new Request(`${API_ORIGIN}/health`),
    );

    expectNoCorsHeaders(response);
    expectSecurityHeaders(response);
  });

  test('内側のハンドラーが返すエラーの応答にもCORSとセキュリティのヘッダーを付ける', async () => {
    const { handler } = createRecordingHandler(() =>
      Response.json({ error: { code: 'rate_limited' } }, { status: 429 }),
    );
    const entrypoint = createPublicEntrypoint(handler, {
      cors: createTestCorsPolicy(),
    });

    const response = await invokeFetch(
      entrypoint,
      new Request(`${API_ORIGIN}/v1/products`),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expectSecurityHeaders(response);
  });

  test('ヘッダーを書き換えられない応答でも、複製してCORSとセキュリティのヘッダーを付ける', async () => {
    const { handler } = createRecordingHandler(() =>
      Response.redirect(`${API_ORIGIN}/v1/openapi.json`, 302),
    );
    const entrypoint = createPublicEntrypoint(handler, {
      cors: createTestCorsPolicy(),
    });

    const response = await invokeFetch(
      entrypoint,
      new Request(`${API_ORIGIN}/v1/`),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      `${API_ORIGIN}/v1/openapi.json`,
    );
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expectSecurityHeaders(response);
  });

  test('経路が指定したCSPを保つ', async () => {
    const routeCsp = "default-src 'self'; frame-ancestors 'none'";
    const { handler } = createRecordingHandler(
      () =>
        new Response('<!doctype html>', {
          headers: { 'Content-Security-Policy': routeCsp },
        }),
    );
    const entrypoint = createPublicEntrypoint(handler, {
      cors: createTestCorsPolicy(),
    });

    const response = await invokeFetch(
      entrypoint,
      new Request(`${API_ORIGIN}/graphql`),
    );

    expect(response.headers.get('Content-Security-Policy')).toBe(routeCsp);
  });

  test('定期実行のハンドラーをそのまま委ねる', async () => {
    const controllers: ScheduledController[] = [];
    const scheduled: ExportedHandlerScheduledHandler<TestEnv> = (
      controller,
    ) => {
      controllers.push(controller);
    };
    const { handler } = createRecordingHandler();
    const entrypoint = createPublicEntrypoint(
      { ...handler, scheduled },
      { cors: createTestCorsPolicy() },
    );
    const controller = createScheduledController({ cron: '0 0 * * *' });

    await entrypoint.scheduled?.(
      controller,
      TEST_ENV,
      createExecutionContext(),
    );

    expect(entrypoint.scheduled).toBe(scheduled);
    expect(controllers).toEqual([controller]);
  });

  test('fetchを持たないハンドラーはそのまま返す', () => {
    const handler: ExportedHandler<TestEnv> = { scheduled: () => undefined };

    const entrypoint = createPublicEntrypoint(handler, {
      cors: createTestCorsPolicy(),
    });

    expect(entrypoint).toBe(handler);
  });
});
