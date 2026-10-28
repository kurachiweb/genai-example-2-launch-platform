import type { MiddlewareHandler } from 'hono';

import { AppError } from '../../core/errors/app-error.ts';
import { toErrorResponse } from '../../core/errors/error-envelope.ts';
import type { RateLimitExclusion } from './exclusions.ts';

export type RateLimitKeyResolver<E> = (
  request: Request,
  clientIp: string | undefined,
  env: E,
) => string | undefined | Promise<string | undefined>;

export interface BindingRateLimitOptions<E> {
  readonly binding: (env: E) => RateLimit;
  readonly key: RateLimitKeyResolver<E>;
  readonly periodSeconds: 10 | 60;
  readonly exclusions?: readonly RateLimitExclusion<E>[];
}

interface RateLimitHonoEnv<E> {
  Bindings: E;
  Variables: { clientIp: string | undefined };
}

const RATE_LIMIT_EXCEEDED_MESSAGE =
  '操作が集中しています。しばらく待ってから再度お試しください。';

export function bindingRateLimit<E extends object>(
  options: BindingRateLimitOptions<E>,
): MiddlewareHandler {
  const exclusions = options.exclusions ?? [];
  const exceeded = toErrorResponse(
    new AppError({
      kind: 'rate_limited',
      code: 'rate_limit_exceeded',
      message: RATE_LIMIT_EXCEEDED_MESSAGE,
      retryAfterSeconds: options.periodSeconds,
    }),
  );
  const middleware: MiddlewareHandler<RateLimitHonoEnv<E>> = async (
    c,
    next,
  ) => {
    const request = c.req.raw;
    if (exclusions.some((isExcluded) => isExcluded(request, c.env))) {
      await next();
      return;
    }
    const key = await options.key(request, c.get('clientIp'), c.env);
    if (key === undefined) {
      await next();
      return;
    }
    const { success } = await options.binding(c.env).limit({ key });
    if (!success) {
      return c.json(exceeded.body, exceeded.status, exceeded.headers);
    }
    await next();
  };
  return middleware;
}
