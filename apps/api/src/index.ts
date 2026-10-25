import { createCronRegistry } from '../lib/core/scheduling/cron-registry.ts';
import { createRunBudgetTable } from '../lib/core/scheduling/run-budget.ts';
import { createWorkerHandler } from '../lib/workers/handler/create-worker-handler.ts';
import { createWorkerApp } from '../lib/workers/http/create-worker-app.ts';
import {
  buildSentryOptions,
  readSentryRuntimeOptions,
} from '../lib/workers/observability/sentry.ts';
import { createScheduledDispatcher } from '../lib/workers/scheduling/scheduled-dispatcher.ts';
import { apiEnvSchema } from './composition/env-schema.ts';
import { MODULES } from './composition/modules.ts';
import { RATE_LIMIT_EXCLUSIONS } from './composition/rate-limit-exclusions.ts';
import {
  SCHEDULED_JOBS,
  SCHEDULED_RUN_BUDGETS,
} from './composition/scheduled-jobs.ts';

export { RateLimitCounter } from '../lib/workers/rate-limit/rate-limit-counter.ts';

const APP_NAME = 'api';

const sentry = (env: Env) => buildSentryOptions(readSentryRuntimeOptions(env));

const app = createWorkerApp<Env>({
  appName: APP_NAME,
  envSchema: apiEnvSchema,
  modules: MODULES,
  rateLimitExclusions: RATE_LIMIT_EXCLUSIONS,
  sentry,
});

const scheduled = createScheduledDispatcher<Env>(
  createCronRegistry(SCHEDULED_JOBS),
  MODULES,
  { budgets: createRunBudgetTable(SCHEDULED_RUN_BUDGETS) },
);

export default createWorkerHandler<Env>({
  appName: APP_NAME,
  app,
  envSchema: apiEnvSchema,
  sentry,
  scheduled,
});
