import { describe, expect, test } from 'bun:test';

import {
  BAGGAGE,
  BOT_TOKEN,
  CLIENT_COOKIE,
  CLIENT_IP,
  CLIENT_TOKEN,
  depsOf,
  fetcherOf,
  firstCall,
  GRAPHQL_BODY,
  graphqlRequest,
  ignoringAbort,
  ISSUED_TOKEN,
  neverResponding,
  okResponse,
  type RecordingFetcher,
  rejecting,
  respondingWith,
  SENTRY_TRACE,
} from '../../test/relay-route-fixtures.ts';
import { parseGraphQLResponse } from '../../utilities/graphql/graphql-result.ts';
import {
  defineRelayRoute,
  GRAPHQL_RELAY_ROUTE,
  relayToApi,
  UPSTREAM_RETRY_AFTER_SECONDS,
} from './relay-route.ts';

const COOKIE_ATTRIBUTES = 'Path=/; Secure; HttpOnly; SameSite=Lax';

const errorBodyOf = (code: string): unknown => ({
  error: { code, message: expect.any(String) as unknown as string },
});

describe('relayToApi(GraphQL)', () => {
  test('上流の/graphqlへ同じメソッドと本文で、契約の項目と許可した項目だけを付けて中継する', async () => {
    const api = respondingWith(okResponse);

    await relayToApi(
      GRAPHQL_RELAY_ROUTE,
      graphqlRequest({}, '/_bff/graphql?ignored=1'),
      depsOf(api).deps,
    );

    expect(api.calls).toHaveLength(1);
    const call = firstCall(api);
    expect(call.url).toBe('https://api.internal/graphql');
    expect(call.method).toBe('POST');
    expect(call.body).toBe(GRAPHQL_BODY);
    expect(call.headers).toEqual({
      'x-original-client-ip': CLIENT_IP,
      'x-session-token': CLIENT_TOKEN,
      'cf-turnstile-response': BOT_TOKEN,
      'content-type': 'application/json',
      accept: 'application/graphql-response+json',
      'sentry-trace': SENTRY_TRACE,
      baggage: BAGGAGE,
    });
  });

  test('上流の応答の状態コード・本文・Retry-Afterを変えずに返す', async () => {
    const body = '{"errors":[{"extensions":{"code":"rate_limit_exceeded"}}]}';
    const api = respondingWith(
      () =>
        new Response(body, {
          status: 429,
          headers: {
            'Content-Type': 'application/graphql-response+json',
            'Retry-After': '30',
          },
        }),
    );

    const response = await relayToApi(
      GRAPHQL_RELAY_ROUTE,
      graphqlRequest(),
      depsOf(api).deps,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
    expect(response.headers.get('Content-Type')).toBe(
      'application/graphql-response+json',
    );
    expect(await response.text()).toBe(body);
  });

  test('上流が発行を指示したら自分のCookieを発行し、指示の項目と上流のSet-Cookieを除く', async () => {
    const api = respondingWith(() => {
      const headers = new Headers({
        'x-session-issue': ISSUED_TOKEN,
        'x-session-max-age': '7776000',
      });
      headers.append('Set-Cookie', 'upstream=1; Path=/');
      return new Response('{"data":{}}', { status: 200, headers });
    });

    const response = await relayToApi(
      GRAPHQL_RELAY_ROUTE,
      graphqlRequest(),
      depsOf(api).deps,
    );

    expect(response.headers.getSetCookie()).toEqual([
      `${CLIENT_COOKIE}=${ISSUED_TOKEN}; Max-Age=7776000; ${COOKIE_ATTRIBUTES}`,
    ]);
    expect(response.headers.has('x-session-issue')).toBe(false);
    expect(response.headers.has('x-session-max-age')).toBe(false);
  });

  test('上流が削除を指示したら自分のCookieを削除する', async () => {
    const api = respondingWith(
      () =>
        new Response('{"data":{}}', { headers: { 'x-session-clear': '1' } }),
    );

    const response = await relayToApi(
      GRAPHQL_RELAY_ROUTE,
      graphqlRequest(),
      depsOf(api).deps,
    );

    expect(response.headers.getSetCookie()).toEqual([
      `${CLIENT_COOKIE}=; Max-Age=0; ${COOKIE_ATTRIBUTES}`,
    ]);
    expect(response.headers.has('x-session-clear')).toBe(false);
  });

  test('形式不正の指示は無視してCookieの処理のロガーへ警告する', async () => {
    const api = respondingWith(
      () =>
        new Response('{"data":{}}', {
          headers: { 'x-session-issue': 'short', 'x-session-max-age': '60' },
        }),
    );
    const { deps, recorder } = depsOf(api);

    const response = await relayToApi(
      GRAPHQL_RELAY_ROUTE,
      graphqlRequest(),
      deps,
    );

    expect(response.headers.getSetCookie()).toEqual([]);
    expect(
      recorder.sessionWarnings.map(({ properties }) => properties),
    ).toEqual([{ reason: 'invalid_token' }]);
  });

  test.each([['GET'], ['PUT'], ['DELETE'], ['OPTIONS'], ['PATCH']])(
    'メソッド%sは中継せずに405とAllowで応答する',
    async (method) => {
      const api = respondingWith(okResponse);
      const { deps, recorder } = depsOf(api);

      const response = await relayToApi(
        GRAPHQL_RELAY_ROUTE,
        graphqlRequest({
          method,
          headers: { 'Content-Type': 'application/json' },
        }),
        deps,
      );

      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('POST');
      expect(await response.json()).toEqual(errorBodyOf('method_not_allowed'));
      expect(api.calls).toHaveLength(0);
      expect(recorder.reported).toHaveLength(0);
    },
  );

  test.each([
    ['text/plain'],
    ['application/graphql'],
    ['multipart/form-data; boundary=x'],
    ['application/jsonx'],
  ])('本文の形式%sは中継せずに415で応答する', async (contentType) => {
    const api = respondingWith(okResponse);
    const { deps, recorder } = depsOf(api);

    const response = await relayToApi(
      GRAPHQL_RELAY_ROUTE,
      graphqlRequest({ headers: { 'Content-Type': contentType } }),
      deps,
    );

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual(
      errorBodyOf('unsupported_media_type'),
    );
    expect(api.calls).toHaveLength(0);
    expect(recorder.reported).toHaveLength(0);
  });

  test('本文の形式が無い場合は中継せずに415で応答する', async () => {
    const api = respondingWith(okResponse);
    const request = new Request('https://app.example/_bff/graphql', {
      method: 'POST',
      body: new Uint8Array([123, 125]),
    });

    const response = await relayToApi(
      GRAPHQL_RELAY_ROUTE,
      request,
      depsOf(api).deps,
    );

    expect(response.status).toBe(415);
    expect(api.calls).toHaveLength(0);
  });

  test.each([['application/json; charset=utf-8'], ['Application/JSON']])(
    '本文の形式%sは引数と大文字小文字を無視して受け付ける',
    async (contentType) => {
      const api = respondingWith(okResponse);

      const response = await relayToApi(
        GRAPHQL_RELAY_ROUTE,
        graphqlRequest({ headers: { 'Content-Type': contentType } }),
        depsOf(api).deps,
      );

      expect(response.status).toBe(200);
      expect(firstCall(api).headers['content-type']).toBe(contentType);
    },
  );

  test('上流の例外は503のupstream_unavailableとRetry-Afterで応答し、内部の詳細を含めず、警告して送信する', async () => {
    const failure = new Error('internal binding detail');
    const { deps, recorder } = depsOf(rejecting(failure));

    const response = await relayToApi(
      GRAPHQL_RELAY_ROUTE,
      graphqlRequest(),
      deps,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
    const text = await response.text();
    expect(text).not.toContain('internal binding detail');
    expect(JSON.parse(text)).toEqual(errorBodyOf('upstream_unavailable'));
    expect(recorder.reported).toEqual([failure]);
    expect(recorder.warnings.map(({ properties }) => properties)).toEqual([
      { code: 'upstream_unavailable', route: '/_bff/graphql' },
    ]);
  });

  test.each([
    [503, 'text/plain', 'Worker "api" not found'],
    [502, 'text/html; charset=utf-8', '<html>Bad Gateway</html>'],
    [500, '', 'Error 1102: Worker exceeded resource limits'],
  ] as const)(
    '上流が状態%iで形式「%s」の本文を返したら、503のupstream_unavailableとRetry-Afterで応答し、上流の本文を含めず、警告して送信する',
    async (status, contentType, upstreamBody) => {
      let canceled = false;
      const api = respondingWith(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start: (controller) => {
                controller.enqueue(new TextEncoder().encode(upstreamBody));
              },
              cancel: () => {
                canceled = true;
              },
            }),
            {
              status,
              headers:
                contentType === '' ? {} : { 'Content-Type': contentType },
            },
          ),
      );
      const { deps, recorder } = depsOf(api);

      const response = await relayToApi(
        GRAPHQL_RELAY_ROUTE,
        graphqlRequest(),
        deps,
      );

      expect(response.status).toBe(503);
      expect(response.headers.get('Retry-After')).toBe('5');
      const text = await response.text();
      expect(text).not.toContain(upstreamBody);
      expect(JSON.parse(text)).toEqual(errorBodyOf('upstream_unavailable'));
      expect(canceled).toBe(true);
      expect(recorder.warnings.map(({ properties }) => properties)).toEqual([
        { code: 'upstream_unavailable', route: '/_bff/graphql' },
      ]);
      expect(recorder.reported).toHaveLength(1);
      expect(recorder.reported[0]).toBeInstanceOf(Error);
      expect(String(recorder.reported[0])).not.toContain(upstreamBody);
    },
  );

  test('上流の非JSONの5xxの本文のストリームが失敗していても、503のupstream_unavailableで応答する', async () => {
    const api = respondingWith(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start: (controller) => {
              controller.error(new Error('本文の受信に失敗'));
            },
          }),
          { status: 503, headers: { 'Content-Type': 'text/plain' } },
        ),
    );
    const { deps } = depsOf(api);

    const response = await relayToApi(
      GRAPHQL_RELAY_ROUTE,
      graphqlRequest(),
      deps,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(errorBodyOf('upstream_unavailable'));
  });

  test.each([
    [
      500,
      'application/json',
      '{"error":{"code":"internal_error","message":"x"}}',
    ],
    [
      500,
      'application/graphql-response+json; charset=utf-8',
      '{"errors":[{"message":"x","extensions":{"code":"internal_error"}}]}',
    ],
    [
      503,
      'Application/JSON',
      '{"error":{"code":"internal_error","message":"x"}}',
    ],
  ] as const)(
    '上流が状態%iで%sの本文を返したら、状態コードと本文を変えずに返し、送信しない',
    async (status, contentType, upstreamBody) => {
      const { deps, recorder } = depsOf(
        respondingWith(
          () =>
            new Response(upstreamBody, {
              status,
              headers: { 'Content-Type': contentType },
            }),
        ),
      );

      const response = await relayToApi(
        GRAPHQL_RELAY_ROUTE,
        graphqlRequest(),
        deps,
      );

      expect(response.status).toBe(status);
      expect(response.headers.get('Content-Type')).toBe(contentType);
      expect(await response.text()).toBe(upstreamBody);
      expect(recorder.reported).toHaveLength(0);
      expect(recorder.warnings).toHaveLength(0);
    },
  );

  test('上流の5xx未満の応答は本文の形式に関わらず変えずに返す', async () => {
    const { deps, recorder } = depsOf(
      respondingWith(
        () =>
          new Response('Not Found', {
            status: 404,
            headers: { 'Content-Type': 'text/plain' },
          }),
      ),
    );

    const response = await relayToApi(
      GRAPHQL_RELAY_ROUTE,
      graphqlRequest(),
      deps,
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not Found');
    expect(recorder.reported).toHaveLength(0);
  });

  test('中継の失敗のログに接続元のIP・セッション識別子・bot判定のトークンの値を含めない', async () => {
    const { deps, recorder } = depsOf(rejecting(new Error('unreachable')));

    await relayToApi(GRAPHQL_RELAY_ROUTE, graphqlRequest(), deps);

    const logged = JSON.stringify(recorder.warnings);
    for (const secret of [CLIENT_IP, CLIENT_TOKEN, BOT_TOKEN]) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe('relayToApi(時間切れ)', () => {
  const SHORT_ROUTE = defineRelayRoute({
    ...GRAPHQL_RELAY_ROUTE,
    timeoutMs: 20,
  });

  test('経路の待ち時間を過ぎたら上流への要求を中止し、503のupstream_timeoutとRetry-Afterで応答して送信する', async () => {
    const api = neverResponding();
    const { deps, recorder } = depsOf(api);

    const response = await relayToApi(SHORT_ROUTE, graphqlRequest(), deps);

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(await response.json()).toEqual(errorBodyOf('upstream_timeout'));
    expect(firstCall(api).signal.aborted).toBe(true);
    expect(recorder.reported).toHaveLength(1);
    expect(recorder.warnings.map(({ properties }) => properties)).toEqual([
      { code: 'upstream_timeout', route: '/_bff/graphql' },
    ]);
  });

  test('上流が中止の合図に従わなくても待ち時間で503のupstream_timeoutを返す', async () => {
    const response = await relayToApi(
      SHORT_ROUTE,
      graphqlRequest(),
      depsOf(ignoringAbort()).deps,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(errorBodyOf('upstream_timeout'));
  });

  test('待ち時間より前の応答はそのまま返す', async () => {
    const api = fetcherOf(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(okResponse());
          }, 5);
        }),
    );

    const response = await relayToApi(
      defineRelayRoute({ ...GRAPHQL_RELAY_ROUTE, timeoutMs: 1000 }),
      graphqlRequest(),
      depsOf(api).deps,
    );

    expect(response.status).toBe(200);
    expect(firstCall(api).signal.aborted).toBe(false);
  });

  test.each([
    ['upstream_unavailable', () => rejecting(new Error('x'))],
    [
      'upstream_unavailable',
      () =>
        respondingWith(
          () =>
            new Response('Worker "api" not found', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' },
            }),
        ),
    ],
    ['upstream_timeout', neverResponding],
  ] as const)(
    '503の%sはGraphQLの応答の解析で同じコード・再試行までの秒数の想定外の失敗になる',
    async (code, apiOf: () => RecordingFetcher) => {
      const response = await relayToApi(
        SHORT_ROUTE,
        graphqlRequest(),
        depsOf(apiOf()).deps,
      );

      const result = parseGraphQLResponse({
        status: response.status,
        headers: response.headers,
        body: await response.text(),
      });

      expect(UPSTREAM_RETRY_AFTER_SECONDS).toBe(5);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(code);
        expect(result.error.status).toBe(503);
        expect(result.error.retryAfterSeconds).toBe(5);
        expect(result.error.expected).toBe(false);
      }
    },
  );
});

describe('relayToApi(後続のspecが追加する経路)', () => {
  const MEDIA_ROUTE = defineRelayRoute({
    path: '/_bff/media/*',
    methods: ['PUT'],
    upstreamPath: (url) =>
      `/internal/media/${url.pathname.slice('/_bff/media/'.length)}`,
    acceptContentTypes: ['image/png', 'image/webp'],
    extraForwardedHeaders: ['content-length'],
    timeoutMs: 60_000,
  });

  test('追加した経路もGraphQLと同じ契約の項目・Cookieの扱いで中継し、追加の項目を引き継ぐ', async () => {
    const image = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const api = respondingWith(
      () =>
        new Response('{"id":"m1"}', {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
            'x-session-issue': ISSUED_TOKEN,
            'x-session-max-age': '3600',
          },
        }),
    );
    const request = new Request('https://app.example/_bff/media/a/b.png', {
      method: 'PUT',
      headers: {
        'CF-Connecting-IP': CLIENT_IP,
        Cookie: `${CLIENT_COOKIE}=${CLIENT_TOKEN}`,
        'Content-Type': 'image/png',
        'Content-Length': String(image.byteLength),
        'cf-turnstile-response': BOT_TOKEN,
        'x-session-token': 'spoofed',
      },
      body: image,
    });

    const response = await relayToApi(MEDIA_ROUTE, request, depsOf(api).deps);

    const call = firstCall(api);
    expect(call.url).toBe('https://api.internal/internal/media/a/b.png');
    expect(call.method).toBe('PUT');
    expect(call.headers).toEqual({
      'x-original-client-ip': CLIENT_IP,
      'x-session-token': CLIENT_TOKEN,
      'cf-turnstile-response': BOT_TOKEN,
      'content-type': 'image/png',
      'content-length': String(image.byteLength),
      'sentry-trace': SENTRY_TRACE,
      baggage: BAGGAGE,
    });
    expect(response.status).toBe(201);
    expect(response.headers.getSetCookie()).toEqual([
      `${CLIENT_COOKIE}=${ISSUED_TOKEN}; Max-Age=3600; ${COOKIE_ATTRIBUTES}`,
    ]);
    expect(await response.text()).toBe('{"id":"m1"}');
  });

  test('追加した経路の失敗のログには登録した経路の形を出す', async () => {
    const { deps, recorder } = depsOf(rejecting(new Error('x')));

    await relayToApi(
      MEDIA_ROUTE,
      new Request('https://app.example/_bff/media/secret-id.png', {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: new Uint8Array([1]),
      }),
      deps,
    );

    expect(recorder.warnings.map(({ properties }) => properties)).toEqual([
      { code: 'upstream_unavailable', route: '/_bff/media/*' },
    ]);
  });

  test('本文を受け取らないメソッドは形式を検査せず、本文を渡さない', async () => {
    const api = respondingWith(okResponse);
    const route = defineRelayRoute({
      path: '/_bff/status',
      methods: ['GET', 'DELETE'],
      upstreamPath: () => '/internal/status',
      timeoutMs: 5000,
    });

    const response = await relayToApi(
      route,
      new Request('https://app.example/_bff/status', {
        method: 'DELETE',
        headers: {
          'CF-Connecting-IP': CLIENT_IP,
          'Content-Type': 'text/plain',
        },
        body: 'ignored',
      }),
      depsOf(api).deps,
    );

    expect(response.status).toBe(200);
    const call = firstCall(api);
    expect(call.url).toBe('https://api.internal/internal/status');
    expect(call.method).toBe('DELETE');
    expect(call.body).toBe('');
  });

  test.each([['//evil.example/x'], ['https://evil.example/x'], ['relative']])(
    '上流のパス%sがAPIサーバーの外か絶対パスでない経路は、上流を呼ばずに例外になる',
    async (upstreamPath) => {
      const route = defineRelayRoute({
        path: '/_bff/escape',
        methods: ['GET'],
        upstreamPath: () => upstreamPath,
        timeoutMs: 1000,
      });
      const api = respondingWith(okResponse);

      let caught: unknown;
      try {
        await relayToApi(
          route,
          new Request('https://app.example/_bff/escape'),
          depsOf(api).deps,
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(TypeError);
      expect(api.calls).toHaveLength(0);
    },
  );
});
