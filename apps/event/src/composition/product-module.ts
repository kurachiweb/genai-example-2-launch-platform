import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { RunProductLifecycleBody } from '../../lib/core/messaging/contracts/product.ts';
import type { MessageHandler } from '../../lib/core/messaging/message-contract.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../lib/core/product/identifiers.ts';
import type { ProductLifecycleStore } from '../../lib/core/product/ports.ts';
import {
  createProductLifecycleRegistry,
  type ProductLifecycleAsyncHandler,
  type ProductLifecycleAsyncRegistration,
} from '../../lib/core/product/product-lifecycle.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { EVENT_PRODUCT_TYPES } from '../application/product/event-product-types.ts';
import type { ProductPurgeStore } from '../application/product/ports.ts';
import { ProductLifecycleRunner } from '../application/product/product-lifecycle-runner.ts';
import { D1ProductPurgeStore } from '../infrastructure/product/d1-product-purge-store.ts';
import type { EventEnv } from './env-schema.ts';
import { PRODUCT_LIFECYCLE_ASYNC_HANDLERS } from './product-lifecycle-async-handlers.ts';

type EventAppModule = AppModule<Hono<PlatformHonoEnv<EventEnv>>>;

export interface EventProductModuleOptions {
  readonly asyncHandlers: readonly ProductLifecycleAsyncRegistration[];
}

// 共通の束縛(PRODUCT_PLATFORM_MODULE)が登録されている前提で、プロダクトライフサイクルの実行器と物理削除のストアを束縛する
export function createEventProductModule(
  options: EventProductModuleOptions,
): EventAppModule {
  // 名前・順序の重複などの登録の誤りを、最初のメッセージではなくisolateの起動時に検出する
  const registry = createProductLifecycleRegistry(options.asyncHandlers);
  return {
    name: 'event-product',
    bindings: new ContainerModule(({ bind }) => {
      bind<ProductPurgeStore>(EVENT_PRODUCT_TYPES.ProductPurgeStore).to(
        D1ProductPurgeStore,
      );
      bind<MessageHandler<RunProductLifecycleBody>>(
        EVENT_PRODUCT_TYPES.ProductLifecycleRunner,
      ).toDynamicValue(
        (context) =>
          new ProductLifecycleRunner({
            store: context.get<ProductLifecycleStore>(
              PRODUCT_PLATFORM_TYPES.ProductLifecycleStore,
            ),
            registry,
            // 処理は受け取る各機能のモジュールが束縛するため、呼ばれた時点の処理単位のコンテナから引く
            resolver: {
              resolve: (registration) =>
                context.get<ProductLifecycleAsyncHandler>(registration.handler),
            },
            purgeStore: context.get<ProductPurgeStore>(
              EVENT_PRODUCT_TYPES.ProductPurgeStore,
            ),
            clock: context.get<Clock>(PLATFORM_TYPES.Clock),
          }),
      );
    }),
  };
}

export const EVENT_PRODUCT_MODULE: EventAppModule = createEventProductModule({
  asyncHandlers: PRODUCT_LIFECYCLE_ASYNC_HANDLERS,
});
