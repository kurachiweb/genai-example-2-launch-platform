import { afterEach, describe, expect, test } from 'bun:test';

import { exhaustApiIpRateLimit } from './api-rate-limit.ts';

type TestServer = ReturnType<typeof Bun.serve>;

interface ReceivedRequest {
  readonly method: string;
  readonly pathname: string;
  readonly connectingIp: string | null;
}

interface RecordingServer {
  readonly origin: string;
  readonly received: readonly ReceivedRequest[];
}

const CLIENT_IP = '2001:db8::1';

const startedServers: TestServer[] = [];

// 接続元のIPアドレスごとに数え、上限を超えた要求に429を返す
const startRateLimitedServer = (limit: number): RecordingServer => {
  const received: ReceivedRequest[] = [];
  const counts = new Map<string, number>();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => {
      const connectingIp = request.headers.get('CF-Connecting-IP');
      received.push({
        method: request.method,
        pathname: new URL(request.url).pathname,
        connectingIp,
      });
      const count = (counts.get(connectingIp ?? '') ?? 0) + 1;
      counts.set(connectingIp ?? '', count);
      return new Response(null, { status: count > limit ? 429 : 200 });
    },
  });
  startedServers.push(server);
  return { origin: `http://127.0.0.1:${String(server.port)}`, received };
};

afterEach(async () => {
  await Promise.all(startedServers.splice(0).map((server) => server.stop()));
});

describe('exhaustApiIpRateLimit', () => {
  test('APIサーバーのヘルスチェックの経路へ接続元のIPアドレスを名乗るGETを送り、429が返った時点で終える', async () => {
    const server = startRateLimitedServer(30);

    await exhaustApiIpRateLimit(CLIENT_IP, { E2E_API_URL: server.origin });

    expect(server.received.length).toBeGreaterThan(30);
    expect(server.received.length).toBeLessThanOrEqual(60);
    expect(
      server.received.every(
        ({ method, pathname, connectingIp }) =>
          method === 'GET' &&
          pathname === '/health' &&
          connectingIp === CLIENT_IP,
      ),
    ).toBe(true);
  });

  test('上限の要求数を送っても429が返らなければ、APIサーバーのURLを示して失敗する', async () => {
    const server = startRateLimitedServer(Number.POSITIVE_INFINITY);

    const rejection: unknown = await exhaustApiIpRateLimit(CLIENT_IP, {
      E2E_API_URL: server.origin,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(rejection instanceof Error ? rejection.message : rejection).toBe(
      `APIサーバーのIPアドレス単位の制限に1000回の要求で達しませんでした: ${server.origin}/health`,
    );
  });

  test.each([
    ['無い時', {}],
    ['空文字の時', { E2E_API_URL: '' }],
  ])(
    'APIサーバーのURLの環境変数が%sは、ローカルの既定のオリジンへ送る',
    async (_, env) => {
      const destinations: string[] = [];

      await exhaustApiIpRateLimit(CLIENT_IP, env, (url) => {
        destinations.push(url.href);
        return Promise.resolve(new Response(null, { status: 429 }));
      });

      expect(new Set(destinations)).toStrictEqual(
        new Set(['http://localhost:48042/health']),
      );
    },
  );
});
