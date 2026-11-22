import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { UserLifecycleAsyncHandler } from '../../lib/core/identity/user-lifecycle.ts';
import type { ProductLifecycleAsyncHandler } from '../../lib/core/product/product-lifecycle.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { EVENT_REPORTING_TYPES } from '../application/reporting/event-reporting-types.ts';
import { ProductReportErasureHandler } from '../application/reporting/product-report-erasure-handler.ts';
import { UserReportErasureHandler } from '../application/reporting/user-report-erasure-handler.ts';
import type { EventEnv } from './env-schema.ts';

// 共通の束縛(REPORTING_PLATFORM_MODULE)が登録されている前提で、ユーザーとプロダクトの物理削除の時期の通報の削除と参照の消去を束縛する
export const EVENT_REPORTING_MODULE: AppModule<
  Hono<PlatformHonoEnv<EventEnv>>
> = {
  name: 'event-reporting',
  bindings: new ContainerModule(({ bind }) => {
    bind<UserLifecycleAsyncHandler>(
      EVENT_REPORTING_TYPES.UserReportErasureHandler,
    ).to(UserReportErasureHandler);
    bind<ProductLifecycleAsyncHandler>(
      EVENT_REPORTING_TYPES.ProductReportErasureHandler,
    ).to(ProductReportErasureHandler);
  }),
};
