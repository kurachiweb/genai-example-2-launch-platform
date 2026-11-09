import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { Database } from '../../db/client.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../lib/core/ids/id-generator.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import {
  type LaunchSummarySource,
  type ProductLockSource,
  type RegisteredDecisionSource,
  type RelaunchConditionSource,
  resolveDecisionSources,
} from '../application/product/decision-sources.ts';
import {
  type MyProductsReader,
  StoreMyProductsReader,
} from '../application/product/my-products-reader.ts';
import type {
  ProductLifecycleCommitter,
  ProductStore,
} from '../application/product/ports.ts';
import {
  type ProductDeletion,
  StoreProductDeletion,
} from '../application/product/product-deletion.ts';
import {
  type ProductDescriptionEditor,
  StoreProductDescriptionEditor,
} from '../application/product/product-description-editor.ts';
import {
  type ProductEditor,
  StoreProductEditor,
} from '../application/product/product-editor.ts';
import {
  type ProductHandleAvailabilityChecker,
  StoreProductHandleAvailabilityChecker,
} from '../application/product/product-handle-availability-checker.ts';
import {
  type ProductRegistration,
  StoreProductRegistration,
} from '../application/product/product-registration.ts';
import {
  DefaultProductStateEvaluator,
  type ProductStateEvaluator,
} from '../application/product/product-state-evaluator.ts';
import { PRODUCT_TYPES } from '../application/product/product-types.ts';
import {
  type ProductVisibilityControl,
  StoreProductVisibilityControl,
} from '../application/product/product-visibility-control.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { createD1ProductLifecycleCommitter } from '../infrastructure/product/d1-product-lifecycle-committer.ts';
import { D1ProductStore } from '../infrastructure/product/d1-product-store.ts';
import { LaunchCancellationSyncHandler } from '../infrastructure/product/launch-cancellation-sync-handler.ts';
import {
  createProductSaveHooks,
  type ProductSaveHooks,
} from '../infrastructure/product/product-save-hooks.ts';
import { ProductWithdrawalSyncHandler } from '../infrastructure/product/product-withdrawal-sync-handler.ts';
import {
  LAUNCH_SUMMARY_SOURCES,
  PRODUCT_LOCK_SOURCES,
  RELAUNCH_CONDITION_SOURCES,
} from './product-decision-sources.ts';
import { PRODUCT_LIFECYCLE_SYNC_HANDLERS } from './product-lifecycle-sync-handlers.ts';
import { PRODUCT_SAVE_HOOKS } from './product-save-hooks.ts';

// 表示用の照会とハンドルの対象(PRODUCT_PLATFORM_TYPES)・ファイル(MEDIA_TYPES)・時計とID生成とデータベース(PLATFORM_TYPES)・Ultrasの判定(ULTRAS_TYPES)は各機能の共通の束縛を使う
export const PRODUCT_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'product',
  bindings: new ContainerModule(({ bind }) => {
    bind<readonly RegisteredDecisionSource<RelaunchConditionSource>[]>(
      PRODUCT_TYPES.RelaunchConditionSources,
    ).toDynamicValue((context) =>
      resolveDecisionSources(RELAUNCH_CONDITION_SOURCES, (identifier) =>
        context.get(identifier),
      ),
    );
    bind<readonly RegisteredDecisionSource<ProductLockSource>[]>(
      PRODUCT_TYPES.ProductLockSources,
    ).toDynamicValue((context) =>
      resolveDecisionSources(PRODUCT_LOCK_SOURCES, (identifier) =>
        context.get(identifier),
      ),
    );
    bind<readonly RegisteredDecisionSource<LaunchSummarySource>[]>(
      PRODUCT_TYPES.LaunchSummarySources,
    ).toDynamicValue((context) =>
      resolveDecisionSources(LAUNCH_SUMMARY_SOURCES, (identifier) =>
        context.get(identifier),
      ),
    );
    bind<ProductStateEvaluator>(PRODUCT_TYPES.ProductStateEvaluator).to(
      DefaultProductStateEvaluator,
    );
    // 保存の登録口はD1ProductStoreだけが受け取り、ユースケースには渡さない
    bind<ProductSaveHooks>(PRODUCT_TYPES.ProductSaveHooks).toDynamicValue(
      (context) =>
        createProductSaveHooks(PRODUCT_SAVE_HOOKS, (identifier) =>
          context.get(identifier),
        ),
    );
    bind<ProductStore>(PRODUCT_TYPES.ProductStore).to(D1ProductStore);
    bind<ProductRegistration>(PRODUCT_TYPES.ProductRegistration).to(
      StoreProductRegistration,
    );
    bind<ProductEditor>(PRODUCT_TYPES.ProductEditor).to(StoreProductEditor);
    bind<ProductDescriptionEditor>(PRODUCT_TYPES.ProductDescriptionEditor).to(
      StoreProductDescriptionEditor,
    );
    bind<MyProductsReader>(PRODUCT_TYPES.MyProductsReader).to(
      StoreMyProductsReader,
    );
    bind<ProductHandleAvailabilityChecker>(
      PRODUCT_TYPES.ProductHandleAvailabilityChecker,
    ).to(StoreProductHandleAvailabilityChecker);
    // 同期の処理の登録口は確定の部品だけが受け取り、操作口のユースケースには渡さない
    bind<ProductLifecycleCommitter>(PRODUCT_TYPES.ProductLifecycleCommitter)
      .toDynamicValue((context) =>
        createD1ProductLifecycleCommitter(
          context.get<Database>(PLATFORM_TYPES.Database),
          context.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
          PRODUCT_LIFECYCLE_SYNC_HANDLERS,
          (identifier) => context.get(identifier),
        ),
      )
      .inSingletonScope();
    bind<ProductDeletion>(PRODUCT_TYPES.ProductDeletion).to(
      StoreProductDeletion,
    );
    bind<ProductVisibilityControl>(PRODUCT_TYPES.ProductVisibilityControl).to(
      StoreProductVisibilityControl,
    );
    bind<UserLifecycleSyncHandler>(
      PRODUCT_TYPES.ProductWithdrawalSyncHandler,
    ).to(ProductWithdrawalSyncHandler);
    bind<UserLifecycleSyncHandler>(
      PRODUCT_TYPES.LaunchCancellationSyncHandler,
    ).to(LaunchCancellationSyncHandler);
  }),
};
