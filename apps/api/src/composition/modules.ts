import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import {
  type BotVerifier,
  createTurnstileVerifier,
} from '../../lib/workers/bot-protection/turnstile-verifier.ts';
import { EMAIL_PLATFORM_MODULE } from '../../lib/workers/email/email-platform-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import {
  createRateLimitCounterClient,
  type RateLimitCounterClient,
} from '../../lib/workers/rate-limit/rate-limit-counter-client.ts';
import {
  type DatabaseProbe,
  DefaultSystemStatusQuery,
  SYSTEM_TYPES,
  type SystemStatusQuery,
} from '../application/system/system-status-query.ts';
import { D1DatabaseProbe } from '../infrastructure/system/d1-database-probe.ts';
import { createInternalRoutesModule } from '../presentation/gateway/internal-only.ts';
import allowlist from '../presentation/graphql/generated/allowlist.json';
import { createGraphQLModule } from '../presentation/graphql/graphql-module.ts';
import { API_EMAIL_MODULE } from './email-module.ts';
import { GRAPHQL_SCHEMA_MODULES } from './graphql-modules.ts';
import { INTERNAL_ROUTES } from './internal-routes.ts';
import { SESSION_BINDINGS } from './session.ts';

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

const systemModule: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'system',
  bindings: new ContainerModule(({ bind }) => {
    bind<SystemStatusQuery>(SYSTEM_TYPES.SystemStatusQuery).to(
      DefaultSystemStatusQuery,
    );
    bind<DatabaseProbe>(SYSTEM_TYPES.DatabaseProbe).to(D1DatabaseProbe);
  }),
};

// 公開RESTのモジュールは仕様書の情報と経路の表を同じインスタンスから得るため、api-worker.tsで組み立てて加える
export const MODULES: readonly AppModule<Hono<PlatformHonoEnv<Env>>>[] = [
  platformModule,
  { name: 'session', bindings: SESSION_BINDINGS },
  systemModule,
  createGraphQLModule<Env>({
    schemaModules: GRAPHQL_SCHEMA_MODULES,
    allowlist,
  }),
  createInternalRoutesModule<Env>(INTERNAL_ROUTES),
  EMAIL_PLATFORM_MODULE,
  API_EMAIL_MODULE,
];
