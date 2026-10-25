import type { Hono } from 'hono';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import type { EventEnv } from './env-schema.ts';

export const MODULES: readonly AppModule<Hono<PlatformHonoEnv<EventEnv>>>[] =
  Object.freeze([]);
