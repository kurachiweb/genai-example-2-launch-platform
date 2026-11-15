import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import { createGatewayEntrypointClass } from './gateway-entrypoint.ts';
import { type CallerKind, GATEWAY_HEADERS } from './gateway-headers.ts';

interface TestEnv {
  readonly LABEL: string;
}

interface ReceivedCall {
  readonly request: Request;
  readonly env: TestEnv;
  readonly ctx: ExecutionContext;
}

const TEST_ENV: TestEnv = { LABEL: 'gateway-entrypoint' };
const GRAPHQL_URL = 'https://api.launch.example/graphql';
const RELAYED_IP = '203.0.113.7';

const EXPECTED_SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
} as const;

function createRecordingHandler(
  respond: () => Response = () => Response.json({ data: null }),
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

async function invokeEntrypoint(
  caller: CallerKind,
  handler: ExportedHandler<TestEnv>,
  request: Request,
  ctx: ExecutionContext = createExecutionContext(),
): Promise<Response> {
  const Entrypoint = createGatewayEntrypointClass(caller, handler);
  const entrypoint = new Entrypoint(ctx, TEST_ENV);
  if (entrypoint.fetch === undefined) {
    throw new Error('エントリポイントにfetchがありません');
  }
  const response = await entrypoint.fetch(request);
  await waitOnExecutionContext(ctx);
  return response;
}

function expectSecurityHeaders(response: Response): void {
  for (const [name, value] of Object.entries(EXPECTED_SECURITY_HEADERS)) {
    expect(response.headers.get(name)).toBe(value);
  }
  expect(response.headers.get('Permissions-Policy')).toContain('camera=()');
}

describe('createGatewayEntrypointClass', () => {
  test.each(['client', 'admin'] as const satisfies readonly CallerKind[])(
    '呼び出し元の%sを付けて内側のハンドラーへ渡す',
    async (caller) => {
      const { handler, calls } = createRecordingHandler();

      await invokeEntrypoint(caller, handler, new Request(GRAPHQL_URL));

      expect(calls[0]?.request.headers.get(GATEWAY_HEADERS.caller)).toBe(
        caller,
      );
    },
  );

  test('要求が名乗る呼び出し元を、エントリポイントの呼び出し元で上書きする', async () => {
    const { handler, calls } = createRecordingHandler();

    await invokeEntrypoint(
      'client',
      handler,
      new Request(GRAPHQL_URL, { headers: { 'X-Internal-Caller': 'admin' } }),
    );

    expect(calls[0]?.request.headers.get(GATEWAY_HEADERS.caller)).toBe(
      'client',
    );
  });

  test('フロントエンドが引き継いだクライアントIP・メソッド・本文を保ち、環境と実行コンテキストを渡す', async () => {
    const { handler, calls } = createRecordingHandler();
    const ctx = createExecutionContext();

    await invokeEntrypoint(
      'admin',
      handler,
      new Request(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [GATEWAY_HEADERS.clientIp]: RELAYED_IP,
        },
        body: '{"documentId":"sha256:abc"}',
      }),
      ctx,
    );

    const [call] = calls;
    expect(call?.request.method).toBe('POST');
    expect(call?.request.url).toBe(GRAPHQL_URL);
    expect(call?.request.headers.get(GATEWAY_HEADERS.clientIp)).toBe(
      RELAYED_IP,
    );
    expect(await call?.request.text()).toBe('{"documentId":"sha256:abc"}');
    expect(call?.env).toBe(TEST_ENV);
    expect(call?.ctx).toBe(ctx);
  });

  test('内側のハンドラーの応答にセキュリティヘッダーを付け、状態と本文を保つ', async () => {
    const { handler } = createRecordingHandler(
      () =>
        new Response('{"errors":[]}', {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    const response = await invokeEntrypoint(
      'client',
      handler,
      new Request(GRAPHQL_URL),
    );

    expectSecurityHeaders(response);
    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(await response.text()).toBe('{"errors":[]}');
  });

  test('ヘッダーを書き換えられない応答でも、複製してセキュリティヘッダーを付ける', async () => {
    const { handler } = createRecordingHandler(() =>
      Response.redirect(`${GRAPHQL_URL}?moved=1`, 307),
    );

    const response = await invokeEntrypoint(
      'admin',
      handler,
      new Request(GRAPHQL_URL),
    );

    expect(response.status).toBe(307);
    expectSecurityHeaders(response);
  });

  test('WorkerEntrypointを継承し、fetch以外の公開メソッド(RPC)を持たない', () => {
    const { handler } = createRecordingHandler();

    const Entrypoint = createGatewayEntrypointClass('client', handler);

    expect(Object.getPrototypeOf(Entrypoint.prototype)).toBe(
      WorkerEntrypoint.prototype,
    );
    expect(Object.getOwnPropertyNames(Entrypoint.prototype).toSorted()).toEqual(
      ['constructor', 'fetch'],
    );
  });

  test('呼び出し元ごとに別のクラスを作る', () => {
    const { handler } = createRecordingHandler();

    const ClientEntrypoint = createGatewayEntrypointClass('client', handler);
    const AdminEntrypoint = createGatewayEntrypointClass('admin', handler);

    expect(ClientEntrypoint).not.toBe(AdminEntrypoint);
  });

  test('fetchを持たないハンドラーからはエントリポイントを作らない', () => {
    const handler: ExportedHandler<TestEnv> = { scheduled: () => undefined };

    expect(() => createGatewayEntrypointClass('client', handler)).toThrow(
      'fetch',
    );
  });
});
