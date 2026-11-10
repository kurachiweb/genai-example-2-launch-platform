import type { Hono } from 'hono';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createMatchPlatformModule } from '../../lib/workers/match/match-platform-module.ts';

export const API_MATCH_PLATFORM_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> =
  createMatchPlatformModule('api');
