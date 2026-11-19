import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';

// データエクスポートのAPIキーの照会はPUBLIC_API_PLATFORM_MODULEの束縛を使う
export const PUBLIC_API_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'public-api',
  bindings: new ContainerModule(() => undefined),
};
