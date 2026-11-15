import { ContainerModule } from 'inversify';

import type { Database } from '../../../db/client.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../core/product/identifiers.ts';
import type {
  AdminProductDirectory,
  LaunchExport,
  LaunchOutcomeRecorder,
  ProductCategoryDirectory,
  ProductDirectory,
  ProductExport,
  ProductLifecycleStore,
  ScheduledLaunchDirectory,
} from '../../core/product/ports.ts';
import { D1AdminProductDirectory } from './d1-admin-product-directory.ts';
import {
  D1LaunchOutcomeRecorder,
  D1ScheduledLaunchDirectory,
} from './d1-launch-schedule.ts';
import { D1ProductCategoryDirectory } from './d1-product-category-directory.ts';
import { D1ProductDirectory } from './d1-product-directory.ts';
import { D1LaunchExport, D1ProductExport } from './d1-product-export.ts';
import { createProductLifecycleStore } from './d1-product-lifecycle-store.ts';

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる
export const PRODUCT_PLATFORM_MODULE: Omit<AppModule, 'routes'> = {
  name: 'product-platform',
  bindings: new ContainerModule(({ bind }) => {
    bind<ProductDirectory>(PRODUCT_PLATFORM_TYPES.ProductDirectory)
      .to(D1ProductDirectory)
      .inSingletonScope();
    bind<ProductCategoryDirectory>(
      PRODUCT_PLATFORM_TYPES.ProductCategoryDirectory,
    )
      .to(D1ProductCategoryDirectory)
      .inSingletonScope();
    bind<ScheduledLaunchDirectory>(
      PRODUCT_PLATFORM_TYPES.ScheduledLaunchDirectory,
    )
      .to(D1ScheduledLaunchDirectory)
      .inSingletonScope();
    bind<LaunchOutcomeRecorder>(PRODUCT_PLATFORM_TYPES.LaunchOutcomeRecorder)
      .to(D1LaunchOutcomeRecorder)
      .inSingletonScope();
    bind<ProductExport>(PRODUCT_PLATFORM_TYPES.ProductExport)
      .to(D1ProductExport)
      .inSingletonScope();
    bind<LaunchExport>(PRODUCT_PLATFORM_TYPES.LaunchExport)
      .to(D1LaunchExport)
      .inSingletonScope();
    bind<ProductLifecycleStore>(PRODUCT_PLATFORM_TYPES.ProductLifecycleStore)
      .toDynamicValue((context) =>
        createProductLifecycleStore(
          context.get<Database>(PLATFORM_TYPES.Database),
          context.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
        ),
      )
      .inSingletonScope();
    bind<AdminProductDirectory>(PRODUCT_PLATFORM_TYPES.AdminProductDirectory)
      .to(D1AdminProductDirectory)
      .inSingletonScope();
  }),
};
