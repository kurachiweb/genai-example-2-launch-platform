import { createWorkerHandler } from '../lib/workers/handler/create-worker-handler.ts';
import { createWorkerApp } from '../lib/workers/http/create-worker-app.ts';
import { withSecurityHeaders } from '../lib/workers/http/security-headers.ts';
import { createQueueDispatcher } from '../lib/workers/messaging/queue-consumer.ts';
import {
  buildSentryOptions,
  readSentryRuntimeOptions,
  type SentryOptionsFactory,
} from '../lib/workers/observability/sentry.ts';
import { type EventEnv, eventEnvSchema } from './composition/env-schema.ts';
import { MESSAGE_HANDLERS } from './composition/message-handlers.ts';
import { MODULES } from './composition/modules.ts';
import { RATE_LIMIT_EXCLUSIONS } from './composition/rate-limit-exclusions.ts';

const sentry: SentryOptionsFactory<EventEnv> = (env) =>
  buildSentryOptions(readSentryRuntimeOptions(env));

const app = createWorkerApp<EventEnv>({
  appName: 'event',
  envSchema: eventEnvSchema,
  modules: MODULES,
  rateLimitExclusions: RATE_LIMIT_EXCLUSIONS,
  sentry,
});

export default withSecurityHeaders(
  createWorkerHandler<EventEnv>({
    appName: 'event',
    app,
    envSchema: eventEnvSchema,
    sentry,
    queue: createQueueDispatcher<EventEnv>(MESSAGE_HANDLERS, MODULES),
  }),
);
