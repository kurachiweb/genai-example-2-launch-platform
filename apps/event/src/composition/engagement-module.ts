import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { UserLifecycleAsyncHandler } from '../../lib/core/identity/user-lifecycle.ts';
import type { ProductLifecycleAsyncHandler } from '../../lib/core/product/product-lifecycle.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { AccountErasureHandler } from '../application/engagement/account-erasure-handler.ts';
import { EVENT_ENGAGEMENT_TYPES } from '../application/engagement/event-engagement-types.ts';
import { ProductErasureHandler } from '../application/engagement/product-erasure-handler.ts';
import type { EventEnv } from './env-schema.ts';

// 共通の束縛(ENGAGEMENT_PLATFORM_MODULE)が登録されている前提で、利用者とプロダクトの物理削除の時期の処理を束縛する
export const EVENT_ENGAGEMENT_MODULE: AppModule<
  Hono<PlatformHonoEnv<EventEnv>>
> = {
  name: 'event-engagement',
  bindings: new ContainerModule(({ bind }) => {
    bind<UserLifecycleAsyncHandler>(
      EVENT_ENGAGEMENT_TYPES.AccountErasureHandler,
    ).to(AccountErasureHandler);
    bind<ProductLifecycleAsyncHandler>(
      EVENT_ENGAGEMENT_TYPES.ProductErasureHandler,
    ).to(ProductErasureHandler);
  }),
};
