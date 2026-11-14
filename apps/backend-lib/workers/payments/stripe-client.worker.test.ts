import { describe, expect, test } from 'vitest';

import {
  createStripeClient,
  STRIPE_MAX_NETWORK_RETRIES,
  STRIPE_TIMEOUT_MS,
} from './stripe-client.ts';

// シークレットの検出に実在の鍵と誤認させないよう、連結で組み立てる
const API_KEY = ['rk', 'test', 'StripeClientTest'].join('_');

function retryAfterServerError(): {
  readonly fetch: typeof fetch;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const fakeFetch = (
    input: Request | string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    calls.push(request.url);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          error: { type: 'api_error', message: 'unavailable' },
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  };
  return { fetch: fakeFetch as typeof fetch, calls };
}

describe('createStripeClient', () => {
  test.each([undefined, ''])('キーが%sならクライアントを作らない', (apiKey) => {
    expect(createStripeClient({ appName: 'api', apiKey })).toBeUndefined();
  });

  test('時間切れは10秒で、再試行の回数はapiが1回、eventが2回である', () => {
    expect(STRIPE_TIMEOUT_MS).toBe(10_000);
    expect(STRIPE_MAX_NETWORK_RETRIES).toStrictEqual({ api: 1, event: 2 });

    const api = createStripeClient({ appName: 'api', apiKey: API_KEY });
    const event = createStripeClient({ appName: 'event', apiKey: API_KEY });

    expect(api?.getApiField('timeout')).toBe(10_000);
    expect(api?.getMaxNetworkRetries()).toBe(1);
    expect(event?.getMaxNetworkRetries()).toBe(2);
  });

  test('渡したfetchで通信し、apiは一時的な失敗を1回だけ再試行する', async () => {
    const fake = retryAfterServerError();
    const client = createStripeClient({
      appName: 'api',
      apiKey: API_KEY,
      fetch: fake.fetch,
    });

    await expect(client?.customers.del('cus_retry')).rejects.toThrow();

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]).toBe('https://api.stripe.com/v1/customers/cus_retry');
  });

  test('eventは一時的な失敗を2回まで再試行する', async () => {
    const fake = retryAfterServerError();
    const client = createStripeClient({
      appName: 'event',
      apiKey: API_KEY,
      fetch: fake.fetch,
    });

    await expect(client?.customers.del('cus_retry')).rejects.toThrow();

    expect(fake.calls).toHaveLength(3);
  });
});
