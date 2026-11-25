import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { UserLifecycleAsyncHandler } from '../../lib/core/identity/user-lifecycle.ts';
import type { ProductLifecycleAsyncHandler } from '../../lib/core/product/product-lifecycle.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { AccountRecordErasureHandler } from '../application/moderation/account-record-erasure-handler.ts';
import { EVENT_MODERATION_TYPES } from '../application/moderation/event-moderation-types.ts';
import { ProductRecordErasureHandler } from '../application/moderation/product-record-erasure-handler.ts';
import type { EventEnv } from './env-schema.ts';

// 共通の束縛(MODERATION_PLATFORM_MODULE)が登録されている前提で、利用者とプロダクトの物理削除の時期の措置の記録の削除を束縛する
export const EVENT_MODERATION_MODULE: AppModule<
  Hono<PlatformHonoEnv<EventEnv>>
> = {
  name: 'event-moderation',
  bindings: new ContainerModule(({ bind }) => {
    bind<UserLifecycleAsyncHandler>(
      EVENT_MODERATION_TYPES.AccountRecordErasureHandler,
    ).to(AccountRecordErasureHandler);
    bind<ProductLifecycleAsyncHandler>(
      EVENT_MODERATION_TYPES.ProductRecordErasureHandler,
    ).to(ProductRecordErasureHandler);
  }),
};
