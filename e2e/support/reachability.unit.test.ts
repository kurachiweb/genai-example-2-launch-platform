import { afterEach, describe, expect, test } from 'bun:test';

import { assertE2ETargetReachable } from './reachability.ts';

type TestServer = ReturnType<typeof Bun.serve>;

const startedServers: TestServer[] = [];

const startServer = (
  handler: (request: Request) => Response | Promise<Response>,
): TestServer => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler });
  startedServers.push(server);
  return server;
};

const baseURLOf = (server: TestServer): string =>
  `http://127.0.0.1:${String(server.port)}`;

// 一度使ってから止めたポートは、待ち受けが無い(接続が拒否される)URLとして使える
const createClosedPortURL = async (): Promise<string> => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response(),
  });
  const url = baseURLOf(server);
  await server.stop(true);
  return url;
};

const rejectionOf = async (promise: Promise<void>): Promise<Error> => {
  const rejection: unknown = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(rejection instanceof Error)) {
    throw new Error('Errorで失敗することを期待したが、失敗しなかった');
  }
  return rejection;
};

afterEach(async () => {
  await Promise.all(
    startedServers.splice(0).map((server) => server.stop(true)),
  );
});

describe('assertE2ETargetReachable', () => {
  test('対象URLへHTTPのGETリクエストを送り、応答があれば成功する', async () => {
    const requests: { method: string; pathname: string }[] = [];
    const server = startServer((request) => {
      requests.push({
        method: request.method,
        pathname: new URL(request.url).pathname,
      });
      return new Response('ok');
    });

    await assertE2ETargetReachable(`${baseURLOf(server)}/health`);

    expect(requests).toStrictEqual([{ method: 'GET', pathname: '/health' }]);
  });

  test('エラーの状態コードでも、応答があれば到達できたとみなして成功する', async () => {
    let requestCount = 0;
    const server = startServer(() => {
      requestCount += 1;
      return new Response('error', { status: 500 });
    });

    await assertE2ETargetReachable(baseURLOf(server));

    expect(requestCount).toBe(1);
  });

  test('リダイレクト先へは辿らず、対象URL自体の応答で成功する', async () => {
    const closedPortURL = await createClosedPortURL();
    let requestCount = 0;
    const server = startServer(() => {
      requestCount += 1;
      return Response.redirect(closedPortURL, 302);
    });

    await assertE2ETargetReachable(baseURLOf(server));

    expect(requestCount).toBe(1);
  });

  test('接続できなければ、到達できなかったURLを示し、原因をcauseに残して失敗する', async () => {
    const closedPortURL = await createClosedPortURL();

    const error = await rejectionOf(assertE2ETargetReachable(closedPortURL));

    expect(error.message).toBe(`E2E対象に到達できません: ${closedPortURL}`);
    expect(error.cause).toBeDefined();
  });

  test('待ち時間内に応答が無ければ、到達できなかったURLを示して失敗する', async () => {
    const server = startServer(() => new Promise<Response>(() => undefined));
    const url = baseURLOf(server);

    const error = await rejectionOf(
      assertE2ETargetReachable(url, { timeoutMs: 100 }),
    );

    expect(error.message).toBe(`E2E対象に到達できません: ${url}`);
  });

  test('待ち時間を指定しなければ、開発サーバーの初回応答のように遅い応答も待って成功する', async () => {
    const server = startServer(async () => {
      await Bun.sleep(1_000);
      return new Response('ok');
    });

    await assertE2ETargetReachable(baseURLOf(server));
  });

  test('URLとして解釈できない値は、その値を示して失敗する', async () => {
    const error = await rejectionOf(
      assertE2ETargetReachable('localhost:48044'),
    );

    expect(error.message).toBe('E2E対象に到達できません: localhost:48044');
  });

  test.each([
    ['undefined', undefined],
    ['空文字列', ''],
  ])(
    '対象URLが%sなら、URLが未設定であることを示して失敗する',
    async (_label, baseURL) => {
      const error = await rejectionOf(assertE2ETargetReachable(baseURL));

      expect(error.message).toBe('E2E対象のURLが設定されていません');
    },
  );
});
