import type { Hono } from 'hono';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createUltrasPlatformModule } from '../../lib/workers/ultras/ultras-platform-module.ts';

// 共通の束縛は決済(API_PAYMENTS_PLATFORM_MODULE)・メール・利用者の共通の束縛を使う
export const API_ULTRAS_PLATFORM_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> =
  createUltrasPlatformModule('api');
