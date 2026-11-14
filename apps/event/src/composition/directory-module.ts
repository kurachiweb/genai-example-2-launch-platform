import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { UserLifecycleAsyncHandler } from '../../lib/core/identity/user-lifecycle.ts';
import type { MatchEventHandler } from '../../lib/core/match/match-events.ts';
import type { ProductLifecycleAsyncHandler } from '../../lib/core/product/product-lifecycle.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { AccountIndexRestoreHandler } from '../application/directory/account-index-restore-handler.ts';
import { EntryErasureHandler } from '../application/directory/entry-erasure-handler.ts';
import { EVENT_DIRECTORY_TYPES } from '../application/directory/event-directory-types.ts';
import type { ProductIndexPendingMarker } from '../application/directory/ports.ts';
import { ProductIndexRestoreHandler } from '../application/directory/product-index-restore-handler.ts';
import { QualifierListingHandler } from '../application/directory/qualifier-listing-handler.ts';
import { D1ProductIndexPendingMarker } from '../infrastructure/directory/d1-product-index-pending-marker.ts';
import type { EventEnv } from './env-schema.ts';

// 共通の束縛(DIRECTORY_PLATFORM_MODULE・EVENT_MATCH_PLATFORM_MODULE・EVENT_SEARCH_PLATFORM_MODULE)が登録されている前提で、掲載と索引の処理と更新待ちの書き込みの単位を束縛する
export const EVENT_DIRECTORY_MODULE: AppModule<
  Hono<PlatformHonoEnv<EventEnv>>
> = {
  name: 'event-directory',
  bindings: new ContainerModule(({ bind }) => {
    bind<ProductIndexPendingMarker>(
      EVENT_DIRECTORY_TYPES.ProductIndexPendingMarker,
    ).to(D1ProductIndexPendingMarker);
    bind<MatchEventHandler>(EVENT_DIRECTORY_TYPES.QualifierListingHandler).to(
      QualifierListingHandler,
    );
    bind<ProductLifecycleAsyncHandler>(
      EVENT_DIRECTORY_TYPES.ProductIndexRestoreHandler,
    ).to(ProductIndexRestoreHandler);
    bind<ProductLifecycleAsyncHandler>(
      EVENT_DIRECTORY_TYPES.EntryErasureHandler,
    ).to(EntryErasureHandler);
    bind<UserLifecycleAsyncHandler>(
      EVENT_DIRECTORY_TYPES.AccountIndexRestoreHandler,
    ).to(AccountIndexRestoreHandler);
  }),
};
