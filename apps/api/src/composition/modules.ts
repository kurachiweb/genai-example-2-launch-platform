import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { ADMIN_PLATFORM_MODULE } from '../../lib/workers/admin/admin-platform-module.ts';
import {
  type BotVerifier,
  createTurnstileVerifier,
} from '../../lib/workers/bot-protection/turnstile-verifier.ts';
import { EMAIL_PLATFORM_MODULE } from '../../lib/workers/email/email-platform-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { IDENTITY_PLATFORM_MODULE } from '../../lib/workers/identity/identity-platform-module.ts';
import { PROFILE_PLATFORM_MODULE } from '../../lib/workers/profile/profile-platform-module.ts';
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
import { ADMIN_MODULE } from './admin-module.ts';
import { API_EMAIL_MODULE } from './email-module.ts';
import { GRAPHQL_SCHEMA_MODULES } from './graphql-modules.ts';
import { IDENTITY_MODULE } from './identity-module.ts';
import { INQUIRY_MODULE } from './inquiry-module.ts';
import { INTERNAL_ROUTES } from './internal-routes.ts';
import { LEGAL_MODULE } from './legal-module.ts';
import { API_MEDIA_MODULE, API_MEDIA_PLATFORM_MODULE } from './media-module.ts';
import { MEDIA_REVIEW_POLICY_BINDINGS } from './media-review-policy.ts';
import {
  API_PAYMENTS_MODULE,
  API_PAYMENTS_PLATFORM_MODULE,
} from './payments-module.ts';
import {
  API_SEARCH_MODULE,
  API_SEARCH_PLATFORM_MODULE,
} from './search-module.ts';
import { SESSION_BINDINGS } from './session.ts';
import {
  API_ULTRAS_MODULE,
  API_ULTRAS_PLATFORM_MODULE,
} from './ultras-module.ts';
import { UPLOADER_ELIGIBILITY_BINDINGS } from './uploader-eligibility.ts';

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
  IDENTITY_PLATFORM_MODULE,
  IDENTITY_MODULE,
  ADMIN_PLATFORM_MODULE,
  PROFILE_PLATFORM_MODULE,
  ADMIN_MODULE,
  API_SEARCH_PLATFORM_MODULE,
  API_SEARCH_MODULE,
  API_MEDIA_PLATFORM_MODULE,
  API_MEDIA_MODULE,
  { name: 'media-review-policy', bindings: MEDIA_REVIEW_POLICY_BINDINGS },
  { name: 'uploader-eligibility', bindings: UPLOADER_ELIGIBILITY_BINDINGS },
  LEGAL_MODULE,
  INQUIRY_MODULE,
  API_PAYMENTS_PLATFORM_MODULE,
  API_PAYMENTS_MODULE,
  API_ULTRAS_PLATFORM_MODULE,
  API_ULTRAS_MODULE,
];
