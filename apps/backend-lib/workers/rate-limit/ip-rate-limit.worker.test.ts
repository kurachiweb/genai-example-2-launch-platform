import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';

import { type ClientIpResolver, resolveConnectingIp } from './client-ip.ts';
import { excludePath, type RateLimitExclusion } from './exclusions.ts';
import {
  IP_RATE_LIMIT_KEY_PREFIX,
  ipRateLimit,
  UNKNOWN_CLIENT_IP,
} from './ip-rate-limit.ts';

interface IpLimitedEnv {
  readonly IP_RATE_LIMITER: RateLimit;
}

interface TestHonoEnv {
  Bindings: IpLimitedEnv;
  Variables: { clientIp: string | undefined };
}

const IP_LIMIT = 100;
const PERIOD_MILLISECONDS = 10_000;
const BURST_MARGIN_MILLISECONDS = 4_000;
const BURST_TEST_TIMEOUT_MILLISECONDS = 30_000;
const API_URL = 'https://api.launch.example/v1/items';
const RELAYED_CLIENT_IP_HEADER = 'X-Test-Relayed-Client-Ip';

// 処理の文脈でクライアントIPを求めるinvocationContextの役割を、テストではこのミドルウェアが担う
function createApp(
  exclusions: readonly RateLimitExclusion<IpLimitedEnv>[],
  resolveClientIp: ClientIpResolver = resolveConnectingIp,
): Hono<TestHonoEnv> {
  const app = new Hono<TestHonoEnv>();
  app.use(async (c, next) => {
    c.set('clientIp', resolveClientIp(c.req.raw));
    await next();
  });
  app.use(ipRateLimit(exclusions));
  app.all('*', (c) => c.text('handled'));
  return app;
}

function fromIp(ip: string, method = 'GET'): RequestInit {
  return { method, headers: { 'CF-Connecting-IP': ip } };
}

// Miniflareのバインディングは壁時計にそろえた10秒の期間で数えるため、連続した要求が期間の切り替わりをまたがないように待つ
async function waitForFreshWindow(): Promise<void> {
  const remaining = PERIOD_MILLISECONDS - (Date.now() % PERIOD_MILLISECONDS);
  if (remaining < BURST_MARGIN_MILLISECONDS) {
    await scheduler.wait(remaining + 100);
  }
}

async function sendRepeatedly(
  app: Hono<TestHonoEnv>,
  times: number,
  url: string,
  init: RequestInit,
): Promise<readonly number[]> {
  const statuses: number[] = [];
  for (let index = 0; index < times; index += 1) {
    const response = await app.request(url, init, env);
    statuses.push(response.status);
    await response.body?.cancel();
  }
  return statuses;
}

function createRecordingRateLimit(keys: string[]): RateLimit {
  return {
    limit: ({ key }) => {
      keys.push(key);
      return Promise.resolve({ success: true });
    },
  };
}

describe('ipRateLimit(Rate Limitingバインディング)', () => {
  test(
    '同じIPの101回目を429・Retry-After: 10・共通のエラー形式で止め、別のIPと除外に当たるリクエストは影響を受けない',
    async () => {
      const app = createApp([excludePath('/webhooks/stripe', 'POST')]);
      await waitForFreshWindow();

      const allowed = await sendRepeatedly(
        app,
        IP_LIMIT,
        API_URL,
        fromIp('203.0.113.101'),
      );
      const exceeded = await app.request(API_URL, fromIp('203.0.113.101'), env);
      const otherIp = await app.request(API_URL, fromIp('203.0.113.102'), env);
      const excluded = await app.request(
        'https://api.launch.example/webhooks/stripe',
        fromIp('203.0.113.101', 'POST'),
        env,
      );

      expect(allowed).toStrictEqual(
        Array.from({ length: IP_LIMIT }, () => 200),
      );
      expect(exceeded.status).toBe(429);
      expect(exceeded.headers.get('Retry-After')).toBe('10');
      expect(await exceeded.json()).toStrictEqual({
        error: {
          code: 'rate_limit_exceeded',
          message:
            '操作が集中しています。しばらく待ってから再度お試しください。',
        },
      });
      expect(otherIp.status).toBe(200);
      expect(excluded.status).toBe(200);
      expect(await excluded.text()).toBe('handled');
    },
    BURST_TEST_TIMEOUT_MILLISECONDS,
  );

  test(
    '除外規則に当たるリクエストは回数に含めない',
    async () => {
      const app = createApp([excludePath('/webhooks/stripe', 'POST')]);
      await waitForFreshWindow();

      const excluded = await sendRepeatedly(
        app,
        IP_LIMIT,
        'https://api.launch.example/webhooks/stripe',
        fromIp('203.0.113.111', 'POST'),
      );
      const counted = await sendRepeatedly(
        app,
        IP_LIMIT,
        API_URL,
        fromIp('203.0.113.111'),
      );

      expect(excluded).toStrictEqual(
        Array.from({ length: IP_LIMIT }, () => 200),
      );
      expect(counted).toStrictEqual(
        Array.from({ length: IP_LIMIT }, () => 200),
      );
    },
    BURST_TEST_TIMEOUT_MILLISECONDS,
  );

  test(
    '差し替えたクライアントIPの解決結果で数える',
    async () => {
      const resolveRelayedIp: ClientIpResolver = (request) =>
        request.headers.get(RELAYED_CLIENT_IP_HEADER) ??
        resolveConnectingIp(request);
      const app = createApp([], resolveRelayedIp);
      await waitForFreshWindow();

      const statuses: number[] = [];
      for (let index = 0; index <= IP_LIMIT; index += 1) {
        const response = await app.request(
          API_URL,
          {
            headers: {
              'CF-Connecting-IP': `198.51.100.${String(index % 200)}`,
              [RELAYED_CLIENT_IP_HEADER]: '192.0.2.121',
            },
          },
          env,
        );
        statuses.push(response.status);
        await response.body?.cancel();
      }
      const connectingIpOfLastRequest = await app.request(
        API_URL,
        fromIp('198.51.100.100'),
        env,
      );

      expect(statuses.slice(0, IP_LIMIT)).toStrictEqual(
        Array.from({ length: IP_LIMIT }, () => 200),
      );
      expect(statuses.at(-1)).toBe(429);
      expect(connectingIpOfLastRequest.status).toBe(200);
    },
    BURST_TEST_TIMEOUT_MILLISECONDS,
  );
});

describe('ipRateLimit(数えるキー)', () => {
  test('クライアントIPを接頭辞ip:に続けたキーで数え、不明ならip:unknownで数える', async () => {
    const keys: string[] = [];
    const recordingEnv: IpLimitedEnv = {
      IP_RATE_LIMITER: createRecordingRateLimit(keys),
    };
    const app = createApp([]);

    await app.request(API_URL, fromIp('2001:db8::5'), recordingEnv);
    await app.request(API_URL, {}, recordingEnv);

    expect(IP_RATE_LIMIT_KEY_PREFIX).toBe('ip:');
    expect(UNKNOWN_CLIENT_IP).toBe('unknown');
    expect(keys).toStrictEqual(['ip:2001:db8::5', 'ip:unknown']);
  });
});
