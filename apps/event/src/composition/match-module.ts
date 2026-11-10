import type { Hono } from 'hono';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createMatchPlatformModule } from '../../lib/workers/match/match-platform-module.ts';
import type { EventEnv } from './env-schema.ts';

export const EVENT_MATCH_PLATFORM_MODULE: AppModule<
  Hono<PlatformHonoEnv<EventEnv>>
> = createMatchPlatformModule('event');
