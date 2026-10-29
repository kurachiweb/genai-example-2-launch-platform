import { afterAll, describe, expect, test } from 'bun:test';

import { createHttpProbe, type HttpProbeOptions } from './http-probe.ts';

const URL_UNDER_TEST = 'http://127.0.0.1:1/health';

type FetchLike = HttpProbeOptions['fetch'];

const respondingFetch = (
  statuses: readonly (number | Error)[],
): { readonly fetch: FetchLike; readonly calls: () => readonly string[] } => {
  const calls: string[] = [];
  return {
    fetch: (input) => {
      calls.push(input);
      const next = statuses[Math.min(calls.length - 1, statuses.length - 1)];
      if (next === undefined || next instanceof Error) {
        return Promise.reject(next ?? new Error('応答がありません'));
      }
      return Promise.resolve(new Response('body', { status: next }));
    },
    calls: () => [...calls],
  };
};

const FAST: Omit<HttpProbeOptions, 'fetch'> = {
  intervalMs: 1,
  attemptTimeoutMs: 50,
};

describe('createHttpProbe().waitFor', () => {
  test('期待する状態コードが返るまで間隔を空けて問い合わせ、返れば真を返す', async () => {
    const { fetch, calls } = respondingFetch([
      new Error('ECONNREFUSED'),
      503,
      200,
    ]);
    const probe = createHttpProbe({ fetch, ...FAST });

    const reached = await probe.waitFor(URL_UNDER_TEST, {
      timeoutMs: 5_000,
      expectStatus: 200,
    });

    expect(reached).toBe(true);
    expect(calls()).toEqual([URL_UNDER_TEST, URL_UNDER_TEST, URL_UNDER_TEST]);
  });

  test('anyでは状態コードを問わず最初の応答で真を返す', async () => {
    const { fetch, calls } = respondingFetch([new Error('ECONNREFUSED'), 404]);
    const probe = createHttpProbe({ fetch, ...FAST });

    const reached = await probe.waitFor(URL_UNDER_TEST, {
      timeoutMs: 5_000,
      expectStatus: 'any',
    });

    expect(reached).toBe(true);
    expect(calls()).toHaveLength(2);
  });

  test('時間の上限までに期待する応答が無ければ偽を返す', async () => {
    const { fetch } = respondingFetch([500]);
    const probe = createHttpProbe({ fetch, ...FAST });
    const startedAt = performance.now();

    const reached = await probe.waitFor(URL_UNDER_TEST, {
      timeoutMs: 100,
      expectStatus: 200,
    });

    expect(reached).toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });

  test('応答しない問い合わせは1回ごとの上限で打ち切り、全体の上限で偽を返す', async () => {
    const signals: AbortSignal[] = [];
    const probe = createHttpProbe({
      fetch: (_input, init) => {
        const signal = init?.signal;
        if (signal === undefined || signal === null) {
          return Promise.reject(new Error('打ち切りの合図がありません'));
        }
        signals.push(signal);
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('打ち切り'));
          });
        });
      },
      ...FAST,
    });

    const reached = await probe.waitFor(URL_UNDER_TEST, {
      timeoutMs: 200,
      expectStatus: 'any',
    });

    expect(reached).toBe(false);
    expect(signals.length).toBeGreaterThan(1);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  test('転送の応答は追わずにその状態コードで判定する', async () => {
    const redirects: (RequestRedirect | undefined)[] = [];
    const probe = createHttpProbe({
      fetch: (_input, init) => {
        redirects.push(init?.redirect);
        return Promise.resolve(
          new Response(null, { status: 302, headers: { location: '/' } }),
        );
      },
      ...FAST,
    });

    const reached = await probe.waitFor(URL_UNDER_TEST, {
      timeoutMs: 100,
      expectStatus: 200,
    });

    expect(reached).toBe(false);
    expect(new Set(redirects)).toEqual(new Set(['manual']));
  });
});

describe('createHttpProbe(実際のHTTP)', () => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === '/health'
        ? Response.json({ status: 'ok' })
        : new Response('not found', { status: 404 }),
  });

  afterAll(async () => {
    await server.stop(true);
  });

  test('待ち受けているサーバーの応答を待ち合わせられる', async () => {
    const probe = createHttpProbe({ fetch, ...FAST });
    const origin = `http://127.0.0.1:${String(server.port)}`;

    expect(
      await probe.waitFor(`${origin}/health`, {
        timeoutMs: 5_000,
        expectStatus: 200,
      }),
    ).toBe(true);
    expect(
      await probe.waitFor(`${origin}/missing`, {
        timeoutMs: 100,
        expectStatus: 200,
      }),
    ).toBe(false);
  });
});
