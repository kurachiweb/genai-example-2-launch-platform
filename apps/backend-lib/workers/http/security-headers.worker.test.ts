import {
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, test, vi } from 'vitest';

import {
  applySecurityHeaders,
  DEFAULT_CONTENT_SECURITY_POLICY,
  SECURITY_HEADERS,
  withSecurityHeaders,
} from './security-headers.ts';

interface TestEnv {
  readonly LABEL: string;
}

const TEST_ENV: TestEnv = { LABEL: 'security-headers' };

const EXPECTED_SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy':
    'accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=()',
} as const;

const EXPECTED_DEFAULT_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const ROUTE_CSP = "default-src 'self'; frame-ancestors 'none'";

function expectSecurityHeaders(response: Response, csp: string): void {
  for (const [name, value] of Object.entries(EXPECTED_SECURITY_HEADERS)) {
    expect(response.headers.get(name)).toBe(value);
  }
  expect(response.headers.get('Content-Security-Policy')).toBe(csp);
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

function createRequest(
  path: string,
): Request<unknown, IncomingRequestCfProperties> {
  return new Request(`https://api.example${path}`);
}

describe('SECURITY_HEADERS・DEFAULT_CONTENT_SECURITY_POLICY', () => {
  test('設計の値の表どおりの値を持つ', () => {
    expect(SECURITY_HEADERS).toStrictEqual(EXPECTED_SECURITY_HEADERS);
    expect(DEFAULT_CONTENT_SECURITY_POLICY).toBe(EXPECTED_DEFAULT_CSP);
  });
});

describe('applySecurityHeaders', () => {
  test('CSPを持たない応答に全てのセキュリティヘッダーと既定のCSPを付け、状態・本文・他のヘッダーを保つ', async () => {
    const response = new Response('{"status":"ok"}', {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });

    const applied = applySecurityHeaders(response);

    expectSecurityHeaders(applied, EXPECTED_DEFAULT_CSP);
    expect(applied.status).toBe(201);
    expect(applied.headers.get('Content-Type')).toBe('application/json');
    expect(await applied.text()).toBe('{"status":"ok"}');
  });

  test('応答が既にCSPを持てばそのまま残し、他のセキュリティヘッダーは付ける', () => {
    const response = new Response(null, {
      headers: { 'Content-Security-Policy': ROUTE_CSP },
    });

    const applied = applySecurityHeaders(response);

    expectSecurityHeaders(applied, ROUTE_CSP);
  });

  test('CSP以外のセキュリティヘッダーは応答の既存の値を既定の値で上書きする', () => {
    const response = new Response(null, {
      headers: {
        'Referrer-Policy': 'unsafe-url',
        'X-Content-Type-Options': 'sniff',
      },
    });

    const applied = applySecurityHeaders(response);

    expectSecurityHeaders(applied, EXPECTED_DEFAULT_CSP);
  });

  test('ヘッダーが不変の応答は複製してから付け、状態と他のヘッダーを保つ', () => {
    const response = Response.redirect('https://redirect.example/next', 302);
    expect(() => {
      response.headers.set('X-Probe', '1');
    }).toThrow(TypeError);

    const applied = applySecurityHeaders(response);

    expect(applied).not.toBe(response);
    expectSecurityHeaders(applied, EXPECTED_DEFAULT_CSP);
    expect(applied.status).toBe(302);
    expect(applied.headers.get('Location')).toBe(
      'https://redirect.example/next',
    );
  });

  test('ヘッダーの書き換えでTypeError以外の例外が起きれば、複製せずにそのまま投げる', () => {
    const response = new Response(null);
    const failure = new RangeError('ヘッダーの書き換えに失敗しました');
    vi.spyOn(response.headers, 'set').mockImplementation(() => {
      throw failure;
    });

    expect(() => applySecurityHeaders(response)).toThrow(failure);
  });
});

describe('withSecurityHeaders', () => {
  test('fetchの応答にセキュリティヘッダーを付け、要求と環境と実行文脈をそのまま渡す', async () => {
    const innerFetch = vi.fn<ExportedHandlerFetchHandler<TestEnv>>(
      () => new Response('inner', { status: 429 }),
    );
    const handler = withSecurityHeaders<TestEnv>({ fetch: innerFetch });
    const request = createRequest('/limited');
    const ctx = createExecutionContext();

    const response = await invokeFetch(handler, request, ctx);

    expect(innerFetch).toHaveBeenCalledExactlyOnceWith(request, TEST_ENV, ctx);
    expect(response.status).toBe(429);
    expect(await response.text()).toBe('inner');
    expectSecurityHeaders(response, EXPECTED_DEFAULT_CSP);
  });

  test('非同期のfetchが返す、CSPを持つ不変の応答にも付ける', async () => {
    const inner = Response.redirect('https://redirect.example/csp', 307);
    const handler = withSecurityHeaders<TestEnv>({
      fetch: () => {
        const response = new Response(null, {
          headers: { 'Content-Security-Policy': ROUTE_CSP },
        });
        return Promise.resolve(response);
      },
    });
    const immutableHandler = withSecurityHeaders<TestEnv>({
      fetch: () => Promise.resolve(inner),
    });

    const response = await invokeFetch(handler, createRequest('/docs'));
    const redirected = await invokeFetch(
      immutableHandler,
      createRequest('/old'),
    );

    expectSecurityHeaders(response, ROUTE_CSP);
    expectSecurityHeaders(redirected, EXPECTED_DEFAULT_CSP);
    expect(redirected.status).toBe(307);
  });

  test('scheduled・queueは同じ関数のまま委ねる', async () => {
    const scheduled = vi.fn<ExportedHandlerScheduledHandler<TestEnv>>();
    const queue = vi.fn<ExportedHandlerQueueHandler<TestEnv>>();
    const inner: ExportedHandler<TestEnv> = {
      fetch: () => new Response('ok'),
      scheduled,
      queue,
    };

    const handler = withSecurityHeaders(inner);
    const controller = createScheduledController({
      scheduledTime: new Date('2026-10-26T00:00:00.000Z'),
      cron: '0 0 * * *',
    });
    const batch = createMessageBatch('jobs', [
      {
        id: 'message-1',
        timestamp: new Date('2026-10-26T00:00:00.000Z'),
        attempts: 1,
        body: { kind: 'probe' },
      },
    ]);
    const ctx = createExecutionContext();
    await handler.scheduled?.(controller, TEST_ENV, ctx);
    await handler.queue?.(batch, TEST_ENV, ctx);
    await waitOnExecutionContext(ctx);

    expect(handler.scheduled).toBe(scheduled);
    expect(handler.queue).toBe(queue);
    expect(handler.fetch).not.toBe(inner.fetch);
    expect(scheduled).toHaveBeenCalledExactlyOnceWith(
      controller,
      TEST_ENV,
      ctx,
    );
    expect(queue).toHaveBeenCalledExactlyOnceWith(batch, TEST_ENV, ctx);
  });

  test('fetchを持たないハンドラーにはfetchを加えない', () => {
    const scheduled = vi.fn<ExportedHandlerScheduledHandler<TestEnv>>();

    const handler = withSecurityHeaders<TestEnv>({ scheduled });

    expect(handler).not.toHaveProperty('fetch');
    expect(handler.scheduled).toBe(scheduled);
  });
});
