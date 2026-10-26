import { Hono, type MiddlewareHandler } from 'hono';

import type { AppModule } from '../../../lib/core/di/app-module.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { NOT_FOUND_RESPONSE } from '../../../lib/core/errors/error-envelope.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { PlatformEnv } from '../../../lib/workers/env/platform-env.ts';
import type { PlatformHonoEnv } from '../../../lib/workers/http/hono-env.ts';
import { GATEWAY_HEADERS } from './gateway-headers.ts';
import { parseClientIp, readInternalCaller } from './internal-request.ts';

export const INTERNAL_ROUTE_PREFIX = '/internal';

export type InternalRoutes<E extends PlatformEnv> = (
  app: Hono<PlatformHonoEnv<E>>,
) => void;

const clientIpLogger = getAppLogger(['api', 'gateway', 'client-ip']);

// 経路の存在を明かさないよう、未登録の経路と同じ定型の404にする
function createNotFoundError(): AppError {
  return new AppError({
    kind: 'not_found',
    code: NOT_FOUND_RESPONSE.body.error.code,
    message: NOT_FOUND_RESPONSE.body.error.message,
  });
}

export function internalOnly(): MiddlewareHandler {
  return async (c, next) => {
    if (readInternalCaller(c.req.raw) === undefined) {
      throw createNotFoundError();
    }
    await next();
  };
}

export function warnOnMissingClientIp(request: Request): void {
  const caller = readInternalCaller(request);
  if (caller === undefined) {
    return;
  }
  const value = request.headers.get(GATEWAY_HEADERS.clientIp);
  if (value === null) {
    clientIpLogger.warn('元のクライアントIPアドレスがありません', {
      reason: 'missing',
      caller,
    });
    return;
  }
  if (parseClientIp(value) === undefined) {
    clientIpLogger.warn('元のクライアントIPアドレスを解釈できません', {
      reason: 'invalid',
      caller,
    });
  }
}

export function createInternalRoutesModule<E extends PlatformEnv>(
  routes: readonly InternalRoutes<E>[],
): AppModule<Hono<PlatformHonoEnv<E>>> {
  return {
    name: 'internal-rest',
    routes: (app) => {
      const internal = new Hono<PlatformHonoEnv<E>>();
      internal.use(internalOnly());
      internal.use(async (c, next) => {
        warnOnMissingClientIp(c.req.raw);
        await next();
      });
      for (const register of routes) {
        register(internal);
      }
      app.route(INTERNAL_ROUTE_PREFIX, internal);
    },
  };
}
