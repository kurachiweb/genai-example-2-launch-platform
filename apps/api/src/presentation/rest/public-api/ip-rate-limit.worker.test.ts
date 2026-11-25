import { z } from '@hono/zod-openapi';
import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import { createKeyedHasher } from '../../../../lib/core/crypto/keyed-hasher.ts';
import { hashRateLimitKey } from '../../../../lib/core/rate-limit/rate-limit-key.ts';
import {
  callPublic,
  recordingRateLimiter,
} from '../../../../test/support/gateway-test-harness.ts';
import { API_ORIGIN } from '../../../../test/support/graphql-request.ts';
import { createPublicApiRestHarness } from '../../../../test/support/public-api-rest-harness.ts';
import { PUBLIC_API_IP_RATE_LIMIT } from '../../../application/public-api/rate-limit-rules.ts';
import type { PublicRestRoutes } from '../public-api-app.ts';
import { dataEnvelope } from '../responses.ts';
import { PUBLIC_API_REST_ROUTES } from './index.ts';
import {
  PUBLIC_API_IP_RATE_LIMIT_KEY_PREFIX,
  publicApiIpRateLimitRoutes,
} from './ip-rate-limit.ts';
import { definePublicApiRoute } from './route-definition.ts';

const OPENAPI_URL = `${API_ORIGIN}/v1/openapi.json`;

const IP_LIMIT = PUBLIC_API_IP_RATE_LIMIT.limit;

const PERIOD_MILLISECONDS = PUBLIC_API_IP_RATE_LIMIT.periodSeconds * 1000;

const BURST_MARGIN_MILLISECONDS = 20_000;

const BURST_TEST_TIMEOUT_MILLISECONDS = 120_000;

const RATE_LIMIT_EXCEEDED_BODY = {
  error: {
    code: 'rate_limit_exceeded',
    message: '操作が集中しています。しばらく待ってから再度お試しください。',
  },
};

const AUTHENTICATED_PATH = '/test/ip-limited';

const authenticatedRoute = definePublicApiRoute({
  method: 'get',
  path: AUTHENTICATED_PATH,
  feature: 'products',
  access: 'read',
  target: 'public',
  responses: {
    200: {
      description: 'テスト用の応答',
      content: {
        'application/json': {
          schema: dataEnvelope(z.object({ ok: z.boolean() })),
        },
      },
    },
  },
});

const authenticatedRoutes: PublicRestRoutes<Env> = (api) => {
  api.openapi(authenticatedRoute, (c) => c.json({ data: { ok: true } }, 200));
};

const harness = createPublicApiRestHarness([
  ...PUBLIC_API_REST_ROUTES,
  authenticatedRoutes,
]);

function fromIp(ip: string): RequestInit {
  return { headers: { 'CF-Connecting-IP': ip } };
}

// Miniflareのバインディングは壁時計にそろえた期間で数えるため、連続した要求が期間の切り替わりをまたがないように待つ
async function waitForFreshWindow(): Promise<void> {
  const remaining = PERIOD_MILLISECONDS - (Date.now() % PERIOD_MILLISECONDS);
  if (remaining < BURST_MARGIN_MILLISECONDS) {
    await scheduler.wait(remaining + 100);
  }
}

async function statusOf(response: Response): Promise<number> {
  await response.body?.cancel();
  return response.status;
}

async function fetchOpenApiRepeatedly(
  times: number,
  ip: string,
): Promise<readonly number[]> {
  const statuses: number[] = [];
  for (let index = 0; index < times; index += 1) {
    statuses.push(
      await statusOf(await callPublic(new Request(OPENAPI_URL, fromIp(ip)))),
    );
  }
  return statuses;
}

function publicApiIpKeyOf(ip: string): Promise<string> {
  return hashRateLimitKey(
    createKeyedHasher(env.HASH_PEPPER),
    `${PUBLIC_API_IP_RATE_LIMIT_KEY_PREFIX}${ip}`,
  );
}

function preflight(ip?: string): Request {
  return new Request(OPENAPI_URL, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://tool.example',
      'Access-Control-Request-Method': 'GET',
      ...(ip === undefined ? {} : { 'CF-Connecting-IP': ip }),
    },
  });
}

describe('公開APIのIP単位の回数の制限(Rate Limitingバインディング)', () => {
  test(
    '仕様書の配信を送信元IPアドレスごとに60回目まで処理し、61回目を429・Retry-After: 60・共通のエラー形式で返し、別のIPアドレスは影響を受けない',
    async () => {
      await waitForFreshWindow();

      const allowed = await fetchOpenApiRepeatedly(IP_LIMIT, '203.0.113.141');
      const exceeded = await callPublic(
        new Request(OPENAPI_URL, fromIp('203.0.113.141')),
      );
      const otherIp = await callPublic(
        new Request(OPENAPI_URL, fromIp('203.0.113.142')),
      );

      expect(allowed).toStrictEqual(
        Array.from({ length: IP_LIMIT }, () => 200),
      );
      expect(exceeded.status).toBe(429);
      expect(exceeded.headers.get('Retry-After')).toBe('60');
      expect(exceeded.headers.get('Cache-Control')).toBe('no-store');
      expect(await exceeded.json()).toStrictEqual(RATE_LIMIT_EXCEEDED_BODY);
      expect(await statusOf(otherIp)).toBe(200);
    },
    BURST_TEST_TIMEOUT_MILLISECONDS,
  );

  test(
    '基準パスの下の全ての経路の要求を合わせて数え、超過は認証より前に429で返す',
    async () => {
      await waitForFreshWindow();
      const ip = '203.0.113.143';
      const paths = ['/openapi.json', AUTHENTICATED_PATH, '/not-registered'];

      const statuses: number[] = [];
      for (let index = 0; index < IP_LIMIT; index += 1) {
        const path = paths[index % paths.length] ?? AUTHENTICATED_PATH;
        statuses.push(
          await statusOf(
            await harness.request(path, {
              headers: { 'CF-Connecting-IP': ip },
            }),
          ),
        );
      }
      const exceeded = await harness.request(AUTHENTICATED_PATH, {
        headers: { 'CF-Connecting-IP': ip },
      });

      expect(statuses).not.toContain(429);
      expect(new Set(statuses)).toStrictEqual(new Set([200, 401, 404]));
      expect(exceeded.status).toBe(429);
      expect(exceeded.headers.get('Retry-After')).toBe('60');
      expect(exceeded.headers.get('WWW-Authenticate')).toBeNull();
      expect(await exceeded.json()).toStrictEqual(RATE_LIMIT_EXCEEDED_BODY);
    },
    BURST_TEST_TIMEOUT_MILLISECONDS,
  );
});

describe('公開APIのIP単位の回数の制限(数えるキー)', () => {
  test('送信元IPアドレスに接頭辞を付けてハッシュ化した値で数え、元のIPアドレスを渡さない', async () => {
    const limiter = recordingRateLimiter();

    const response = await callPublic(
      new Request(OPENAPI_URL, fromIp('198.51.100.141')),
      { PUBLIC_API_RATE_LIMITER: limiter.binding },
    );

    expect(await statusOf(response)).toBe(200);
    expect(limiter.keys).toStrictEqual([
      await publicApiIpKeyOf('198.51.100.141'),
    ]);
    expect(limiter.keys.join()).not.toContain('198.51.100.141');
  });

  test('送信元IPアドレスが分からない要求は不明として1つのキーで数える', async () => {
    const limiter = recordingRateLimiter();

    await statusOf(
      await callPublic(new Request(OPENAPI_URL), {
        PUBLIC_API_RATE_LIMITER: limiter.binding,
      }),
    );

    expect(limiter.keys).toStrictEqual([await publicApiIpKeyOf('unknown')]);
  });

  test('プリフライトは数えずに204で返す', async () => {
    const limiter = recordingRateLimiter(false);

    const response = await callPublic(preflight('198.51.100.142'), {
      PUBLIC_API_RATE_LIMITER: limiter.binding,
    });

    expect(await statusOf(response)).toBe(204);
    expect(limiter.keys).toStrictEqual([]);
  });

  test('基準パスの外の要求は数えない', async () => {
    const limiter = recordingRateLimiter(false);

    const response = await callPublic(
      new Request(`${API_ORIGIN}/not-public-api`, fromIp('198.51.100.143')),
      { PUBLIC_API_RATE_LIMITER: limiter.binding },
    );

    expect(await statusOf(response)).toBe(404);
    expect(limiter.keys).toStrictEqual([]);
  });

  test('公開APIの経路の集約はIP単位の制限を先頭に置く', () => {
    expect(PUBLIC_API_REST_ROUTES[0]).toBe(publicApiIpRateLimitRoutes);
  });
});
