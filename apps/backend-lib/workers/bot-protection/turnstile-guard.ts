import type { MiddlewareHandler } from 'hono';

import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { PlatformEnv } from '../env/platform-env.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import type { BotVerifier } from './turnstile-verifier.ts';

export interface TurnstileGuardOptions {
  readonly action?: string;
  readonly token?: (request: Request) => string | undefined;
}

export const TURNSTILE_RESPONSE_HEADER = 'CF-Turnstile-Response';

const readTurnstileResponseHeader = (request: Request): string | undefined =>
  request.headers.get(TURNSTILE_RESPONSE_HEADER) ?? undefined;

export function turnstileGuard(
  options: TurnstileGuardOptions = {},
): MiddlewareHandler {
  const readToken = options.token ?? readTurnstileResponseHeader;
  const middleware: MiddlewareHandler<PlatformHonoEnv<PlatformEnv>> = async (
    c,
    next,
  ) => {
    const verifier = c
      .get('container')
      .get<BotVerifier>(PLATFORM_TYPES.BotVerifier);
    await verifier.assertHuman({
      token: readToken(c.req.raw),
      remoteIp: c.get('clientIp'),
      ...(options.action !== undefined && { expectedAction: options.action }),
    });
    await next();
  };
  return middleware;
}
