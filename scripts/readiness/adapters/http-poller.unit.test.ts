import { afterAll, describe, expect, test } from 'bun:test';

import { createVirtualClock } from '../test-fixtures/virtual-clock.ts';
import {
  createHttpPoller,
  type PollerFetch,
  type ProbeTarget,
  systemClock,
} from './http-poller.ts';

const USER_AGENT = 'readiness-probe-test/1.0';
const TARGET_A: ProbeTarget = { name: 'a', url: 'http://a.example/health' };
const TARGET_B: ProbeTarget = { name: 'b', url: 'http://b.example/' };

interface Recorded {
  readonly url: string;
  readonly init: RequestInit;
  readonly at: number;
}

const setup = (
  respond: (url: string) => Promise<Response> | Response,
  options: { readonly latencyMs?: number } = {},
) => {
  const clock = createVirtualClock();
  const requests: Recorded[] = [];
  const fetch: PollerFetch = async (url, init) => {
    requests.push({ url, init, at: clock.now() });
    await clock.sleep(options.latencyMs ?? 0);
    return respond(url);
  };
  const poller = createHttpPoller({
    fetch,
    clock,
    userAgent: USER_AGENT,
    timeoutMs: 10_000,
    intervalMs: 1_000,
  });
  return { clock, requests, poller };
};

const ok = (): Response => new Response('ok', { status: 200 });

describe('createHttpPoller().poll', () => {
  test('指定の時間の間、1秒ごとに全対象へGETし、時間の秒数だけの件数を観測する', async () => {
    const { clock, requests, poller } = setup(ok);

    const observations = await clock.run(
      poller.poll({ targets: [TARGET_A, TARGET_B], durationMs: 5_000 }),
    );

    expect(observations).toHaveLength(10);
    expect(observations.filter((o) => o.target === 'a')).toHaveLength(5);
    expect(observations.filter((o) => o.target === 'b')).toHaveLength(5);
    const start = requests[0]?.at ?? 0;
    expect(requests.map((r) => r.at - start)).toEqual([
      0, 0, 1000, 1000, 2000, 2000, 3000, 3000, 4000, 4000,
    ]);
    expect(requests.every((r) => r.init.method === 'GET')).toBe(true);
  });

  test('識別のためのUser-Agentを付け、リダイレクトを辿らずに応答の状態コードを記録する', async () => {
    const { clock, requests, poller } = setup(
      () => new Response(null, { status: 302 }),
    );

    const observations = await clock.run(
      poller.poll({ targets: [TARGET_A], durationMs: 1_000 }),
    );

    expect(observations.map((o) => o.status)).toEqual([302]);
    expect(new Headers(requests[0]?.init.headers).get('user-agent')).toBe(
      USER_AGENT,
    );
    expect(requests[0]?.init.redirect).toBe('manual');
    expect(requests[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  test('応答に掛かった時間と要求の開始の時刻を記録する', async () => {
    const { clock, poller } = setup(ok, { latencyMs: 250 });

    const [observation] = await clock.run(
      poller.poll({ targets: [TARGET_A], durationMs: 1_000 }),
    );

    expect(observation).toEqual({
      target: 'a',
      at: '2026-11-23T00:00:00.000Z',
      status: 200,
      durationMs: 250,
    });
  });

  test('応答が1秒より遅くても次の要求を1秒ごとに送り、全ての応答を待ってから返す', async () => {
    const { clock, requests, poller } = setup(ok, { latencyMs: 3_500 });

    const observations = await clock.run(
      poller.poll({ targets: [TARGET_A], durationMs: 3_000 }),
    );

    const start = requests[0]?.at ?? 0;
    expect(requests.map((r) => r.at - start)).toEqual([0, 1000, 2000]);
    expect(observations.map((o) => o.durationMs)).toEqual([3500, 3500, 3500]);
  });

  test('状態コードが2xx・3xx以外でも例外にせず、そのまま記録する', async () => {
    const { clock, poller } = setup(
      (url) => new Response('x', { status: url === TARGET_A.url ? 503 : 404 }),
    );

    const observations = await clock.run(
      poller.poll({ targets: [TARGET_A, TARGET_B], durationMs: 1_000 }),
    );

    expect(observations.map((o) => [o.target, o.status])).toEqual([
      ['a', 503],
      ['b', 404],
    ]);
  });

  test('接続できなかった要求を通信の失敗として記録し、他の対象の観測を続ける', async () => {
    const { clock, poller } = setup((url) => {
      if (url === TARGET_A.url) throw new TypeError('ECONNREFUSED');
      return ok();
    });

    const observations = await clock.run(
      poller.poll({ targets: [TARGET_A, TARGET_B], durationMs: 2_000 }),
    );

    expect(observations.map((o) => [o.target, o.status])).toEqual([
      ['a', 'network-error'],
      ['b', 200],
      ['a', 'network-error'],
      ['b', 200],
    ]);
  });

  test('時間切れで中断された要求を時間切れとして記録する', async () => {
    const { clock, poller } = setup(() => {
      throw new DOMException('timed out', 'TimeoutError');
    });

    const observations = await clock.run(
      poller.poll({ targets: [TARGET_A], durationMs: 1_000 }),
    );

    expect(observations.map((o) => o.status)).toEqual(['timeout']);
  });

  test('応答の本文を読み捨てて、本文の取得で失敗しても状態コードを記録する', async () => {
    const failingBody = new Response(
      new ReadableStream({
        cancel() {
          throw new Error('cancel failed');
        },
      }),
      { status: 200 },
    );
    const { clock, poller } = setup(() => failingBody);

    const observations = await clock.run(
      poller.poll({ targets: [TARGET_A], durationMs: 1_000 }),
    );

    expect(observations.map((o) => o.status)).toEqual([200]);
  });

  test('時間が1秒に満たないときも1回は観測する', async () => {
    const { clock, poller } = setup(ok);

    const observations = await clock.run(
      poller.poll({ targets: [TARGET_A], durationMs: 400 }),
    );

    expect(observations).toHaveLength(1);
  });
});

describe('createHttpPoller() 実際のHTTP', () => {
  const servers: ReturnType<typeof Bun.serve>[] = [];
  afterAll(async () => {
    await Promise.all(servers.map((server) => server.stop(true)));
  });

  test('応答しない相手への要求を指定の時間で打ち切り、時間切れとして記録する', async () => {
    const hanging = Bun.serve({
      port: 0,
      fetch: () => new Promise<Response>(() => undefined),
    });
    servers.push(hanging);
    const poller = createHttpPoller({
      fetch: (url, init) => fetch(url, init),
      clock: systemClock,
      userAgent: USER_AGENT,
      timeoutMs: 100,
      intervalMs: 1_000,
    });

    const [observation] = await poller.poll({
      targets: [
        { name: 'hang', url: `http://127.0.0.1:${String(hanging.port)}/` },
      ],
      durationMs: 1,
    });

    expect(observation?.status).toBe('timeout');
    expect(observation?.durationMs).toBeGreaterThanOrEqual(90);
    expect(observation?.durationMs).toBeLessThan(2_000);
  });

  test('待ち受けていないポートへの要求を通信の失敗として記録し、応答する相手には状態コードを記録する', async () => {
    const responding = Bun.serve({
      port: 0,
      fetch: (request) =>
        new Response(null, {
          status: 200,
          headers: { 'x-user-agent': request.headers.get('user-agent') ?? '' },
        }),
    });
    servers.push(responding);
    const closed = Bun.serve({ port: 0, fetch: () => new Response('') });
    const closedPort = closed.port;
    await closed.stop(true);
    const poller = createHttpPoller({
      fetch: (url, init) => fetch(url, init),
      clock: systemClock,
      userAgent: USER_AGENT,
      timeoutMs: 2_000,
      intervalMs: 1_000,
    });

    const observations = await poller.poll({
      targets: [
        { name: 'up', url: `http://127.0.0.1:${String(responding.port)}/` },
        { name: 'down', url: `http://127.0.0.1:${String(closedPort)}/` },
      ],
      durationMs: 1,
    });

    expect(observations.map((o) => [o.target, o.status])).toEqual([
      ['up', 200],
      ['down', 'network-error'],
    ]);
  });
});
