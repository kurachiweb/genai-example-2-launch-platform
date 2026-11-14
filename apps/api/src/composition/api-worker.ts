import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import { createRunBudgetTable } from '../../lib/core/scheduling/run-budget.ts';
import { createWorkerHandler } from '../../lib/workers/handler/create-worker-handler.ts';
import { createWorkerApp } from '../../lib/workers/http/create-worker-app.ts';
import {
  buildSentryOptions,
  readSentryRuntimeOptions,
} from '../../lib/workers/observability/sentry.ts';
import { createScheduledDispatcher } from '../../lib/workers/scheduling/scheduled-dispatcher.ts';
import { resolveGatewayClientIp } from '../presentation/gateway/internal-request.ts';
import { createPublicEntrypoint } from '../presentation/gateway/public-entrypoint.ts';
import { createPublicApiCorsPolicy } from '../presentation/rest/cors-policy.ts';
import { createRestModule } from '../presentation/rest/rest-module.ts';
import { apiEnvSchema } from './env-schema.ts';
import { MODULES } from './modules.ts';
import { RATE_LIMIT_EXCLUSIONS } from './rate-limit-exclusions.ts';
import { REST_ROUTES } from './rest-routes.ts';
import { SCHEDULED_JOBS, SCHEDULED_RUN_BUDGETS } from './scheduled-jobs.ts';

const APP_NAME = 'api';

const sentry = (env: Env) => buildSentryOptions(readSentryRuntimeOptions(env));

// 外部経路のCORSの方針は登録した経路の表から作るため、アプリに載せるモジュールと同じインスタンスを1度だけ組み立てる
const rest = createRestModule<Env>(REST_ROUTES);

const app = createWorkerApp<Env>({
  appName: APP_NAME,
  envSchema: apiEnvSchema,
  modules: [...MODULES, rest.module],
  rateLimitExclusions: RATE_LIMIT_EXCLUSIONS,
  resolveClientIp: resolveGatewayClientIp,
  sentry,
});

const scheduled = createScheduledDispatcher<Env>(
  createCronRegistry(SCHEDULED_JOBS),
  MODULES,
  { budgets: createRunBudgetTable(SCHEDULED_RUN_BUDGETS) },
);

// 名前付きエントリポイントが内側の処理として使うため、外部経路の包みを掛ける前の処理を公開する
export const apiHandler = createWorkerHandler<Env>({
  appName: APP_NAME,
  app,
  envSchema: apiEnvSchema,
  sentry,
  scheduled,
});

export const publicEntrypoint = createPublicEntrypoint(apiHandler, {
  cors: createPublicApiCorsPolicy(rest.routeTable),
});
