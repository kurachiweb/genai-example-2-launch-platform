import type { Context, Hono } from 'hono';

import type { AppModule } from '../../../lib/core/di/app-module.ts';
import { NOT_FOUND_RESPONSE } from '../../../lib/core/errors/error-envelope.ts';
import type { PlatformEnv } from '../../../lib/workers/env/platform-env.ts';
import type { PlatformHonoEnv } from '../../../lib/workers/http/hono-env.ts';
import {
  type ImageDeliveryHostEnv,
  imageDeliveryHostConfigOf,
  matchImageRequest,
} from './image-request-match.ts';

const ALLOWED_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

const METHOD_NOT_ALLOWED_BODY = Object.freeze({
  error: Object.freeze({
    code: 'method_not_allowed',
    message: 'この操作を受け付けられませんでした。',
  }),
});

const METHOD_NOT_ALLOWED_HEADERS: Readonly<Record<string, string>> =
  Object.freeze({
    Allow: [...ALLOWED_METHODS].join(', '),
    'Cache-Control': 'no-store',
  });

// 応答を要求のヘッダーとクエリ文字列に依存させず、キャッシュのキーをパスだけにするため、メソッドだけを引き継いだ要求を作り直す
function delegateToImageDelivery<E extends PlatformEnv>(
  c: Context<PlatformHonoEnv<E>>,
  path: string,
): Promise<Response> {
  const origin = new URL(c.req.url).origin;
  // 実体はworkerdのExecutionContextだが、Honoは実行環境に依存しない狭い型で宣言している
  const { exports } = c.executionCtx as ExecutionContext;
  return exports.ImageDelivery.fetch(
    new Request(`${origin}${path}`, { method: c.req.method }),
  );
}

export function registerImageGatewayRoutes<
  E extends PlatformEnv & ImageDeliveryHostEnv,
>(app: Hono<PlatformHonoEnv<E>>): void {
  app.use(async (c, next) => {
    const match = matchImageRequest(
      new URL(c.req.url),
      imageDeliveryHostConfigOf(c.env),
    );
    if (match.kind === 'not-image-host') {
      await next();
      return;
    }
    if (match.kind === 'reject-on-dedicated-host') {
      return c.json(
        NOT_FOUND_RESPONSE.body,
        NOT_FOUND_RESPONSE.status,
        NOT_FOUND_RESPONSE.headers,
      );
    }
    if (!ALLOWED_METHODS.has(c.req.method)) {
      return c.json(METHOD_NOT_ALLOWED_BODY, 405, METHOD_NOT_ALLOWED_HEADERS);
    }
    return delegateToImageDelivery(c, match.path);
  });
}

// 他のモジュールの経路より先に画像配信のホストへの要求を受け止めるため、登録箇所の先頭に置く
export function createImageGatewayModule<
  E extends PlatformEnv & ImageDeliveryHostEnv,
>(): AppModule<Hono<PlatformHonoEnv<E>>> {
  return {
    name: 'event-image-gateway',
    routes: registerImageGatewayRoutes,
  };
}
