import type { Hono } from 'hono';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { EMAIL_PLATFORM_MODULE } from '../../lib/workers/email/email-platform-module.ts';
import { EVENT_EMAIL_MODULE } from './email-module.ts';
import type { EventEnv } from './env-schema.ts';

export const MODULES: readonly AppModule<Hono<PlatformHonoEnv<EventEnv>>>[] =
  Object.freeze([EMAIL_PLATFORM_MODULE, EVENT_EMAIL_MODULE]);
