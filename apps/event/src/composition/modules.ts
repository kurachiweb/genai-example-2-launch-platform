import type { Hono } from 'hono';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { ADMIN_PLATFORM_MODULE } from '../../lib/workers/admin/admin-platform-module.ts';
import { DIRECTORY_PLATFORM_MODULE } from '../../lib/workers/directory/directory-platform-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { EMAIL_PLATFORM_MODULE } from '../../lib/workers/email/email-platform-module.ts';
import { IDENTITY_PLATFORM_MODULE } from '../../lib/workers/identity/identity-platform-module.ts';
import { PRODUCT_PLATFORM_MODULE } from '../../lib/workers/product/product-platform-module.ts';
import { PROFILE_PLATFORM_MODULE } from '../../lib/workers/profile/profile-platform-module.ts';
import { createImageGatewayModule } from '../presentation/media/image-gateway-module.ts';
import { EVENT_EMAIL_MODULE } from './email-module.ts';
import type { EventEnv } from './env-schema.ts';
import { EVENT_IDENTITY_MODULE } from './identity-module.ts';
import { EVENT_INQUIRY_MODULE } from './inquiry-module.ts';
import {
  EVENT_MATCH_MODULE,
  EVENT_MATCH_PLATFORM_MODULE,
} from './match-module.ts';
import { MEDIA_SMOKE_MODULE } from './media-smoke-module.ts';
import {
  EVENT_MEDIA_MODULE,
  EVENT_MEDIA_PLATFORM_MODULE,
} from './media-module.ts';
import {
  EVENT_PAYMENTS_MODULE,
  EVENT_PAYMENTS_PLATFORM_MODULE,
} from './payments-module.ts';
import { EVENT_PRODUCT_MODULE } from './product-module.ts';
import { EVENT_PROFILE_MODULE } from './profile-module.ts';
import {
  EVENT_SEARCH_MODULE,
  EVENT_SEARCH_PLATFORM_MODULE,
} from './search-module.ts';
import {
  EVENT_ULTRAS_MODULE,
  EVENT_ULTRAS_PLATFORM_MODULE,
} from './ultras-module.ts';

export const MODULES: readonly AppModule<Hono<PlatformHonoEnv<EventEnv>>>[] =
  Object.freeze([
    createImageGatewayModule<EventEnv>(),
    EVENT_MEDIA_PLATFORM_MODULE,
    EVENT_MEDIA_MODULE,
    MEDIA_SMOKE_MODULE,
    EMAIL_PLATFORM_MODULE,
    EVENT_EMAIL_MODULE,
    IDENTITY_PLATFORM_MODULE,
    EVENT_IDENTITY_MODULE,
    ADMIN_PLATFORM_MODULE,
    PROFILE_PLATFORM_MODULE,
    PRODUCT_PLATFORM_MODULE,
    EVENT_MATCH_PLATFORM_MODULE,
    EVENT_MATCH_MODULE,
    DIRECTORY_PLATFORM_MODULE,
    EVENT_PROFILE_MODULE,
    EVENT_SEARCH_PLATFORM_MODULE,
    EVENT_SEARCH_MODULE,
    EVENT_INQUIRY_MODULE,
    EVENT_PAYMENTS_PLATFORM_MODULE,
    EVENT_PAYMENTS_MODULE,
    EVENT_ULTRAS_PLATFORM_MODULE,
    EVENT_ULTRAS_MODULE,
    EVENT_PRODUCT_MODULE,
  ]);
