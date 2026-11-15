import { withContext } from '@logtape/logtape';
import { setTag } from '@sentry/cloudflare';
import type { MiddlewareHandler } from 'hono';

import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type { ClientIpResolver } from '../rate-limit/client-ip.ts';

export interface InvocationContextOptions {
  readonly appName: LoggingOptions['appName'];
  readonly resolveClientIp: ClientIpResolver;
}

interface InvocationContextHonoEnv {
  Variables: {
    correlationId: string;
    clientIp: string | undefined;
  };
}

export function invocationContext(
  options: InvocationContextOptions,
): MiddlewareHandler {
  const accessLogger = getAppLogger([options.appName, 'http', 'access']);
  const middleware: MiddlewareHandler<InvocationContextHonoEnv> = async (
    c,
    next,
  ) => {
    const correlationId = crypto.randomUUID();
    c.set('correlationId', correlationId);
    c.set('clientIp', options.resolveClientIp(c.req.raw));
    setTag('correlation_id', correlationId);
    await withContext({ correlationId }, async () => {
      const startedAt = Date.now();
      await next();
      // IPアドレスは個人情報のため、アクセスログには記録しない
      accessLogger.info('HTTPリクエストを処理しました', {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - startedAt,
      });
    });
  };
  return middleware;
}
