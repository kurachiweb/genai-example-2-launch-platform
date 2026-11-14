import type { Hono } from 'hono';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createNotificationsPlatformModule } from '../../lib/workers/notifications/notifications-platform-module.ts';

export const API_NOTIFICATIONS_PLATFORM_MODULE: AppModule<
  Hono<PlatformHonoEnv<Env>>
> = createNotificationsPlatformModule('api');
