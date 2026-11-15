import { createExecutionContext } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';

import { NOT_FOUND_RESPONSE } from '../../../lib/core/errors/error-envelope.ts';
import type { PlatformEnv } from '../../../lib/workers/env/platform-env.ts';
import type { PlatformHonoEnv } from '../../../lib/workers/http/hono-env.ts';
import { createImageGatewayModule } from './image-gateway-module.ts';
import type { ImageDeliveryHostEnv } from './image-request-match.ts';

type GatewayTestEnv = PlatformEnv & Required<ImageDeliveryHostEnv>;

const OBJECT_KEY = '0123456789abcdef'.repeat(2);

const IMAGE_PATH = `/${OBJECT_KEY}/square-sm.webp`;

const NEXT_ROUTE_BODY = 'next-route';

const DEDICATED_ENV = {
  IMAGE_DELIVERY_HOSTNAME: 'images.launch.example',
  IMAGE_DELIVERY_DEDICATED_HOST: 'true',
} as const;

const SHARED_LOCAL_ENV = {
  IMAGE_DELIVERY_HOSTNAME: 'localhost',
  IMAGE_DELIVERY_DEDICATED_HOST: 'false',
} as const;

interface DelegationRecord {
  readonly ctx: ExecutionContext;
  readonly delegated: Request[];
}

// 画像配信の名前付きエントリポイントへの委譲を記録し、決まった応答を返す実行コンテキスト
function recordingContext(): DelegationRecord {
  const delegated: Request[] = [];
  const base = createExecutionContext();
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      base.waitUntil(promise);
    },
    passThroughOnException: () => {
      base.passThroughOnException();
    },
    props: {},
    exports: {
      ImageDelivery: {
        fetch: (request: Request) => {
          delegated.push(request);
          return Promise.resolve(
            new Response('delivered-image', {
              status: 200,
              headers: { 'Content-Type': 'image/webp' },
            }),
          );
        },
      },
    },
  } as unknown as ExecutionContext;
  return { ctx, delegated };
}

// 関門のモジュールの後に通常の経路を1つ置き、関門が次の経路へ進めたかを応答で見分ける
function appWithGateway(): Hono<PlatformHonoEnv<GatewayTestEnv>> {
  const app = new Hono<PlatformHonoEnv<GatewayTestEnv>>();
  createImageGatewayModule<GatewayTestEnv>().routes?.(app);
  app.all('*', (c) => c.text(NEXT_ROUTE_BODY));
  return app;
}

async function send(
  input: string,
  init: RequestInit,
  hostEnv: Required<ImageDeliveryHostEnv>,
): Promise<{ readonly response: Response; readonly delegated: Request[] }> {
  const { ctx, delegated } = recordingContext();
  const response = await appWithGateway().fetch(
    new Request(input, init),
    hostEnv,
    ctx,
  );
  return { response, delegated };
}

describe('画像配信の関門', () => {
  test('専用のホストの画像のURLを、クエリ文字列と要求ヘッダーを落としてImageDeliveryへ渡し、応答をそのまま返す', async () => {
    const { response, delegated } = await send(
      `https://images.launch.example${IMAGE_PATH}?w=9999&format=png`,
      {
        headers: {
          Accept: 'image/avif,image/webp',
          Cookie: 'session=secret-cookie',
          'CF-Connecting-IP': '203.0.113.30',
        },
      },
      DEDICATED_ENV,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(await response.text()).toBe('delivered-image');
    expect(delegated).toHaveLength(1);
    expect(delegated[0]?.url).toBe(
      `https://images.launch.example${IMAGE_PATH}`,
    );
    expect(delegated[0]?.method).toBe('GET');
    expect([...(delegated[0]?.headers.keys() ?? [])]).toStrictEqual([]);
  });

  test('HEADはメソッドを保って渡し、本文の無い応答を返す', async () => {
    const { response, delegated } = await send(
      `https://images.launch.example${IMAGE_PATH}`,
      { method: 'HEAD' },
      DEDICATED_ENV,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(await response.text()).toBe('');
    expect(delegated.map((request) => request.method)).toStrictEqual(['HEAD']);
  });

  test.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    '画像のURLへの%sは渡さずに405・Allow・no-storeを返す',
    async (method) => {
      const { response, delegated } = await send(
        `https://images.launch.example${IMAGE_PATH}`,
        { method },
        DEDICATED_ENV,
      );

      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('GET, HEAD');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toMatchObject({
        error: { code: 'method_not_allowed' },
      });
      expect(delegated).toHaveLength(0);
    },
  );

  test.each([
    ['ヘルスチェック以外の経路', '/internal/email/smoke', 'POST'],
    ['ルート', '/', 'GET'],
    ['バリアントの無い原本', `/${OBJECT_KEY}`, 'GET'],
  ])(
    '専用のホストの画像のURLの形式に合わない要求(%s)は、通常の経路へ進めずに404・no-storeを返す',
    async (_case, path, method) => {
      const { response, delegated } = await send(
        `https://images.launch.example${path}`,
        { method },
        DEDICATED_ENV,
      );

      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
      expect(delegated).toHaveLength(0);
    },
  );

  test('画像配信のホスト以外への要求は、画像のURLの形式でも通常の経路へ進める', async () => {
    const { response, delegated } = await send(
      `https://event.launch.example${IMAGE_PATH}`,
      {},
      DEDICATED_ENV,
    );

    expect(await response.text()).toBe(NEXT_ROUTE_BODY);
    expect(delegated).toHaveLength(0);
  });

  test('専用でないホスト(ローカル)では、画像のURLだけをImageDeliveryへ渡し、他は通常の経路へ進める', async () => {
    const image = await send(
      `http://localhost:48043${IMAGE_PATH}?v=1`,
      {},
      SHARED_LOCAL_ENV,
    );
    const health = await send(
      'http://localhost:48043/health',
      {},
      SHARED_LOCAL_ENV,
    );
    const smoke = await send(
      'http://localhost:48043/internal/email/smoke',
      { method: 'POST' },
      SHARED_LOCAL_ENV,
    );

    expect(await image.response.text()).toBe('delivered-image');
    expect(image.delegated.map((request) => request.url)).toStrictEqual([
      `http://localhost:48043${IMAGE_PATH}`,
    ]);
    expect(await health.response.text()).toBe(NEXT_ROUTE_BODY);
    expect(await smoke.response.text()).toBe(NEXT_ROUTE_BODY);
    expect([...health.delegated, ...smoke.delegated]).toHaveLength(0);
  });
});
