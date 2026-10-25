import { Hono, type MiddlewareHandler } from 'hono';
import { describe, expect, test } from 'vitest';

import {
  bindingRateLimit,
  type BindingRateLimitOptions,
} from './binding-rate-limit.ts';
import { excludeHostname, excludePath } from './exclusions.ts';

interface CountingRateLimit {
  readonly binding: RateLimit;
  readonly keys: string[];
}

// Rate Limitingバインディングと同じく、キーごとに上限までだけ成功を返す
function createCountingRateLimit(limit: number): CountingRateLimit {
  const keys: string[] = [];
  const counts = new Map<string, number>();
  const binding: RateLimit = {
    limit: ({ key }) => {
      keys.push(key);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return Promise.resolve({ success: count <= limit });
    },
  };
  return { binding, keys };
}

interface TestEnv {
  readonly PUBLIC_API_LIMITER: RateLimit;
  readonly MEDIA_HOSTNAME: string;
}

interface TestHonoEnv {
  Bindings: TestEnv;
  Variables: { clientIp: string | undefined };
}

const CLIENT_IP_HEADER = 'X-Test-Client-Ip';

function createApp(limiter: MiddlewareHandler): Hono<TestHonoEnv> {
  const app = new Hono<TestHonoEnv>();
  app.use(async (c, next) => {
    c.set('clientIp', c.req.header(CLIENT_IP_HEADER));
    await next();
  });
  app.use(limiter);
  app.all('*', (c) => c.text('handled'));
  return app;
}

function createEnv(binding: RateLimit): TestEnv {
  return {
    PUBLIC_API_LIMITER: binding,
    MEDIA_HOSTNAME: 'media.launch.example',
  };
}

function publicApiOptions(
  overrides: Partial<BindingRateLimitOptions<TestEnv>> = {},
): BindingRateLimitOptions<TestEnv> {
  return {
    binding: (env) => env.PUBLIC_API_LIMITER,
    key: (_, clientIp) => `public-api:${clientIp ?? 'none'}`,
    periodSeconds: 60,
    ...overrides,
  };
}

async function send(
  app: Hono<TestHonoEnv>,
  env: TestEnv,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return app.request(url, init, env);
}

describe('bindingRateLimit', () => {
  test('上限までは後続の処理へ進み、超えたリクエストを429と共通のエラー形式で止める', async () => {
    const { binding } = createCountingRateLimit(2);
    const env = createEnv(binding);
    const app = createApp(bindingRateLimit(publicApiOptions()));
    const init = { headers: { [CLIENT_IP_HEADER]: '203.0.113.10' } };

    const first = await send(app, env, 'https://api.launch.example/v1', init);
    const second = await send(app, env, 'https://api.launch.example/v1', init);
    const third = await send(app, env, 'https://api.launch.example/v1', init);

    expect(first.status).toBe(200);
    expect(await first.text()).toBe('handled');
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.headers.get('Retry-After')).toBe('60');
    expect(third.headers.get('Cache-Control')).toBe('no-store');
    expect(await third.json()).toStrictEqual({
      error: {
        code: 'rate_limit_exceeded',
        message: '操作が集中しています。しばらく待ってから再度お試しください。',
      },
    });
  });

  test('期間の秒数をRetry-Afterに使う', async () => {
    const { binding } = createCountingRateLimit(0);
    const app = createApp(
      bindingRateLimit(publicApiOptions({ periodSeconds: 10 })),
    );

    const response = await send(
      app,
      createEnv(binding),
      'https://api.launch.example/v1',
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('10');
  });

  test('キーの関数にリクエストと文脈のクライアントIPを渡し、その戻り値で数える', async () => {
    const { binding, keys } = createCountingRateLimit(10);
    const app = createApp(
      bindingRateLimit(
        publicApiOptions({
          key: (request, clientIp) =>
            `${new URL(request.url).pathname}|${clientIp ?? 'none'}`,
        }),
      ),
    );
    const env = createEnv(binding);

    await send(app, env, 'https://api.launch.example/v1/items', {
      headers: { [CLIENT_IP_HEADER]: '198.51.100.20' },
    });
    await send(app, env, 'https://api.launch.example/v1/users');

    expect(keys).toStrictEqual(['/v1/items|198.51.100.20', '/v1/users|none']);
  });

  test('別のキーの回数は互いに影響しない', async () => {
    const { binding } = createCountingRateLimit(1);
    const env = createEnv(binding);
    const app = createApp(bindingRateLimit(publicApiOptions()));

    const exhausted = await send(app, env, 'https://api.launch.example/v1', {
      headers: { [CLIENT_IP_HEADER]: '203.0.113.30' },
    });
    const rejected = await send(app, env, 'https://api.launch.example/v1', {
      headers: { [CLIENT_IP_HEADER]: '203.0.113.30' },
    });
    const otherKey = await send(app, env, 'https://api.launch.example/v1', {
      headers: { [CLIENT_IP_HEADER]: '203.0.113.31' },
    });

    expect(exhausted.status).toBe(200);
    expect(rejected.status).toBe(429);
    expect(otherKey.status).toBe(200);
  });

  test('除外規則に当たるリクエストは数えずに後続の処理へ進める', async () => {
    const { binding, keys } = createCountingRateLimit(0);
    const env = createEnv(binding);
    const app = createApp(
      bindingRateLimit(
        publicApiOptions({
          exclusions: [
            excludePath('/webhooks/stripe', 'POST'),
            excludeHostname((e) => e.MEDIA_HOSTNAME),
          ],
        }),
      ),
    );

    const webhook = await send(
      app,
      env,
      'https://event.launch.example/webhooks/stripe',
      { method: 'POST' },
    );
    const media = await send(
      app,
      env,
      'https://media.launch.example/images/a.webp',
    );
    const notExcluded = await send(
      app,
      env,
      'https://event.launch.example/webhooks/stripe',
    );

    expect(webhook.status).toBe(200);
    expect(media.status).toBe(200);
    expect(notExcluded.status).toBe(429);
    expect(keys).toStrictEqual(['public-api:none']);
  });
});
