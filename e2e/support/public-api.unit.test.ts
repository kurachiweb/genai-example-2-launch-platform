import { afterEach, describe, expect, test } from 'bun:test';

import {
  createPublicApiClient,
  publicApiOrigin,
  publicApiUrl,
} from './public-api.ts';

type TestServer = ReturnType<typeof Bun.serve>;

interface ReceivedRequest {
  readonly method: string;
  readonly pathname: string;
  readonly authorization: string | null;
  readonly connectingIp: string | null;
  readonly contentType: string | null;
  readonly accept: string | null;
  readonly body: string;
}

interface RecordingServer {
  readonly origin: string;
  readonly received: readonly ReceivedRequest[];
}

const API_KEY = `lsk_${'A'.repeat(43)}`;

const CLIENT_IP = '2001:db8::1';

const DOCUMENTATION_IPV6_PATTERN = /^2001:db8:(?:[0-9a-f]{4}:){5}[0-9a-f]{4}$/u;

const startedServers: TestServer[] = [];

// 受け取った要求を記録し、決めた応答を返す
const startRecordingServer = (
  respond: (request: Request) => Response,
): RecordingServer => {
  const received: ReceivedRequest[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      received.push({
        method: request.method,
        pathname: new URL(request.url).pathname,
        authorization: request.headers.get('Authorization'),
        connectingIp: request.headers.get('CF-Connecting-IP'),
        contentType: request.headers.get('Content-Type'),
        accept: request.headers.get('Accept'),
        body: await request.text(),
      });
      return respond(request);
    },
  });
  startedServers.push(server);
  return { origin: `http://127.0.0.1:${String(server.port)}`, received };
};

const jsonResponse = (status: number, body: unknown): Response =>
  Response.json(body, { status });

afterEach(async () => {
  await Promise.all(startedServers.splice(0).map((server) => server.stop()));
});

describe('publicApiOrigin・publicApiUrl', () => {
  test.each([
    ['無い時', {}],
    ['空文字の時', { E2E_API_URL: '' }],
  ])(
    'APIサーバーのURLの環境変数が%sは、ローカルの既定のオリジンを使う',
    (_, env) => {
      expect(publicApiOrigin(env)).toBe('http://localhost:48042');
      expect(publicApiUrl('/products/rocket', env).href).toBe(
        'http://localhost:48042/v1/products/rocket',
      );
    },
  );

  test('APIサーバーのURLの環境変数にパスが付いていても、オリジンの直下の基準パスの下を指す', () => {
    const env = { E2E_API_URL: 'https://api.launch.example/health' };

    expect(publicApiOrigin(env)).toBe('https://api.launch.example');
    expect(publicApiUrl('/openapi.json', env).href).toBe(
      'https://api.launch.example/v1/openapi.json',
    );
  });

  test('スラッシュで始まらない経路は、基準パスとつながらないため拒否する', () => {
    expect(() => publicApiUrl('products', {})).toThrow(
      new RangeError('公開APIの経路はスラッシュで始めてください: products'),
    );
  });
});

describe('createPublicApiClient', () => {
  test('GETは基準パスの下の経路へ、Bearerの形のAPIキーと名乗る接続元のIPアドレスを付けて送り、状態コードとJSONの本文を返す', async () => {
    const server = startRecordingServer(() =>
      jsonResponse(200, { data: { handle: 'rocket' } }),
    );
    const client = createPublicApiClient({
      env: { E2E_API_URL: server.origin },
      clientIp: CLIENT_IP,
    });

    const response = await client.request({
      apiKey: API_KEY,
      path: '/products/rocket',
    });

    expect(response).toStrictEqual({
      status: 200,
      body: { data: { handle: 'rocket' } },
    });
    expect(server.received).toStrictEqual([
      {
        method: 'GET',
        pathname: '/v1/products/rocket',
        authorization: `Bearer ${API_KEY}`,
        connectingIp: CLIENT_IP,
        contentType: null,
        accept: 'application/json',
        body: '',
      },
    ]);
  });

  test('本文のある要求は、JSONに直した本文をContent-Typeとともに指定の方式で送る', async () => {
    const server = startRecordingServer(() =>
      jsonResponse(200, { data: { description_markdown: '新しい説明文' } }),
    );
    const client = createPublicApiClient({
      env: { E2E_API_URL: server.origin },
      clientIp: CLIENT_IP,
    });

    const response = await client.request({
      apiKey: API_KEY,
      method: 'PUT',
      path: '/me/products/rocket/description',
      body: { description_markdown: '新しい説明文' },
    });

    expect(response.status).toBe(200);
    expect(server.received).toStrictEqual([
      {
        method: 'PUT',
        pathname: '/v1/me/products/rocket/description',
        authorization: `Bearer ${API_KEY}`,
        connectingIp: CLIENT_IP,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ description_markdown: '新しい説明文' }),
      },
    ]);
  });

  test('失敗の応答も例外にせず、状態コードとJSONの本文を返す', async () => {
    const server = startRecordingServer(() =>
      jsonResponse(401, { error: { code: 'invalid_api_key' } }),
    );
    const client = createPublicApiClient({
      env: { E2E_API_URL: server.origin },
      clientIp: CLIENT_IP,
    });

    expect(
      await client.request({ apiKey: API_KEY, path: '/me/profile' }),
    ).toStrictEqual({
      status: 401,
      body: { error: { code: 'invalid_api_key' } },
    });
  });

  test('転送の応答は追わずに、そのままの状態コードを返す', async () => {
    const server = startRecordingServer(
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: '/v1/products/renamed' },
        }),
    );
    const client = createPublicApiClient({
      env: { E2E_API_URL: server.origin },
      clientIp: CLIENT_IP,
    });

    const response = await client.request({
      apiKey: API_KEY,
      path: '/products/rocket',
    });

    expect(response).toStrictEqual({ status: 302, body: null });
    expect(server.received.map(({ pathname }) => pathname)).toStrictEqual([
      '/v1/products/rocket',
    ]);
  });

  test('JSONでない本文は文字列のまま返し、空の本文はnullにする', async () => {
    const server = startRecordingServer((request) =>
      new URL(request.url).pathname.endsWith('/text')
        ? new Response('Too Many Requests', {
            status: 429,
            headers: { 'Content-Type': 'text/plain' },
          })
        : new Response(null, { status: 204 }),
    );
    const client = createPublicApiClient({
      env: { E2E_API_URL: server.origin },
      clientIp: CLIENT_IP,
    });

    expect(
      await client.request({ apiKey: API_KEY, path: '/text' }),
    ).toStrictEqual({ status: 429, body: 'Too Many Requests' });
    expect(
      await client.request({ apiKey: API_KEY, path: '/empty' }),
    ).toStrictEqual({ status: 204, body: null });
  });

  test('接続元のIPアドレスを指定しないと、クライアントごとに文書用のIPv6アドレスの範囲から別の値を選び、同じクライアントの要求では同じ値を名乗る', async () => {
    const server = startRecordingServer(() => jsonResponse(200, {}));
    const env = { E2E_API_URL: server.origin };
    const first = createPublicApiClient({ env });
    const second = createPublicApiClient({ env });

    await first.request({ apiKey: API_KEY, path: '/products/a' });
    await first.request({ apiKey: API_KEY, path: '/products/b' });
    await second.request({ apiKey: API_KEY, path: '/products/c' });

    const [firstIp, firstAgainIp, secondIp] = server.received.map(
      ({ connectingIp }) => connectingIp,
    );
    expect(firstIp).toMatch(DOCUMENTATION_IPV6_PATTERN);
    expect(secondIp).toMatch(DOCUMENTATION_IPV6_PATTERN);
    expect(firstAgainIp).toBe(firstIp);
    expect(secondIp).not.toBe(firstIp);
  });

  test('送信の関数を差し替えると、その関数へ要求のURLと内容を渡す', async () => {
    const sent: { url: string; method: string | undefined }[] = [];
    const client = createPublicApiClient({
      env: {},
      clientIp: CLIENT_IP,
      send: (url, init) => {
        sent.push({ url: url.href, method: init.method });
        return Promise.resolve(jsonResponse(200, { data: [] }));
      },
    });

    const response = await client.request({
      apiKey: API_KEY,
      method: 'PATCH',
      path: '/me/profile',
      body: { bio: '' },
    });

    expect(response).toStrictEqual({ status: 200, body: { data: [] } });
    expect(sent).toStrictEqual([
      { url: 'http://localhost:48042/v1/me/profile', method: 'PATCH' },
    ]);
  });
});
