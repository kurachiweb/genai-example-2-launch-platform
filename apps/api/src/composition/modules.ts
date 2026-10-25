import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import {
  type BotVerifier,
  createTurnstileVerifier,
} from '../../lib/workers/bot-protection/turnstile-verifier.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import {
  createRateLimitCounterClient,
  type RateLimitCounterClient,
} from '../../lib/workers/rate-limit/rate-limit-counter-client.ts';

function parseExpectedHostnames(value: string): readonly string[] {
  return value
    .split(',')
    .map((hostname) => hostname.trim())
    .filter((hostname) => hostname !== '');
}

const platformModule: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'platform',
  bindings: new ContainerModule(({ bind }) => {
    bind<BotVerifier>(PLATFORM_TYPES.BotVerifier)
      .toDynamicValue((context) => {
        const env = context.get<Env>(PLATFORM_TYPES.Env);
        return createTurnstileVerifier({
          secretKey: env.TURNSTILE_SECRET_KEY,
          expectedHostnames: parseExpectedHostnames(
            env.TURNSTILE_EXPECTED_HOSTNAMES,
          ),
          // workerdのfetchは別のオブジェクトのメソッドとして呼ぶと不正な呼び出しになるため、呼び出し時に大域のfetchを引く
          fetch: (input, init) => fetch(input, init),
        });
      })
      .inSingletonScope();
    bind<RateLimitCounterClient>(PLATFORM_TYPES.RateLimitCounterClient)
      .toDynamicValue((context) =>
        createRateLimitCounterClient(
          context.get<Env>(PLATFORM_TYPES.Env).RATE_LIMIT_COUNTER,
        ),
      )
      .inSingletonScope();
  }),
};

export const MODULES: readonly AppModule<Hono<PlatformHonoEnv<Env>>>[] = [
  platformModule,
];
