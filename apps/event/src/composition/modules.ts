import type { Hono } from 'hono';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { EMAIL_PLATFORM_MODULE } from '../../lib/workers/email/email-platform-module.ts';
import { IDENTITY_PLATFORM_MODULE } from '../../lib/workers/identity/identity-platform-module.ts';
import { createImageGatewayModule } from '../presentation/media/image-gateway-module.ts';
import { EVENT_EMAIL_MODULE } from './email-module.ts';
import type { EventEnv } from './env-schema.ts';
import { MEDIA_SMOKE_MODULE } from './media-smoke-module.ts';
import {
  EVENT_MEDIA_MODULE,
  EVENT_MEDIA_PLATFORM_MODULE,
} from './media-module.ts';
import {
  EVENT_SEARCH_MODULE,
  EVENT_SEARCH_PLATFORM_MODULE,
} from './search-module.ts';

export const MODULES: readonly AppModule<Hono<PlatformHonoEnv<EventEnv>>>[] =
  Object.freeze([
    createImageGatewayModule<EventEnv>(),
    EVENT_MEDIA_PLATFORM_MODULE,
    EVENT_MEDIA_MODULE,
    MEDIA_SMOKE_MODULE,
    EMAIL_PLATFORM_MODULE,
    EVENT_EMAIL_MODULE,
    IDENTITY_PLATFORM_MODULE,
    EVENT_SEARCH_PLATFORM_MODULE,
    EVENT_SEARCH_MODULE,
  ]);
