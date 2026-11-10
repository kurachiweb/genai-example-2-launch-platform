import type { Hono } from 'hono';
import {
  ContainerModule,
  type ResolutionContext,
  type ServiceIdentifier,
} from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import {
  CountedDirectoryCategoryReader,
  type DirectoryCategoryReader,
} from '../application/directory/directory-category-reader.ts';
import {
  type DirectoryReader,
  ListingDirectoryReader,
} from '../application/directory/directory-reader.ts';
import { DIRECTORY_TYPES } from '../application/directory/directory-types.ts';
import {
  type RegisteredItemMetricSource,
  resolveItemMetricSources,
} from '../application/directory/item-metric-sources.ts';
import {
  type ItemMetricsReader,
  SourcedItemMetricsReader,
} from '../application/directory/item-metrics-reader.ts';
import {
  type LaunchHighlightsReader,
  SourcedLaunchHighlightsReader,
} from '../application/directory/launch-highlights-reader.ts';
import {
  DirectoryLiveMatchReader,
  type LiveMatchReader,
} from '../application/directory/live-match-reader.ts';
import {
  DirectoryProductPageReader,
  type ProductPageReader,
} from '../application/directory/product-page-reader.ts';
import {
  DirectorySupporterListReader,
  type SupporterListReader,
} from '../application/directory/supporter-list-reader.ts';
import { AccountIndexRemovalSyncHandler } from '../infrastructure/directory/account-index-removal-sync-handler.ts';
import { ProductIndexRemovalSyncHandler } from '../infrastructure/directory/product-index-removal-sync-handler.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import type { ProductLifecycleSyncHandler } from '../infrastructure/product/product-lifecycle-sync-handler.ts';
import { DIRECTORY_ITEM_METRIC_SOURCES } from './directory-item-metric-sources.ts';

const resolverOf =
  (context: ResolutionContext) =>
  <T>(identifier: ServiceIdentifier<T>): T =>
    context.get(identifier);

// 一覧の照会(DIRECTORY_PLATFORM_TYPES)・プロダクトとカテゴリの照会と要約の供給元(PRODUCT_PLATFORM_TYPES・PRODUCT_TYPES)・マッチとサポーターの照会(MATCH_PLATFORM_TYPES)・索引文書の文(SEARCH_TYPES)は各機能の束縛を使う
export const DIRECTORY_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'directory',
  bindings: new ContainerModule(({ bind }) => {
    bind<readonly RegisteredItemMetricSource[]>(
      DIRECTORY_TYPES.ItemMetricSources,
    ).toDynamicValue((context) =>
      resolveItemMetricSources(
        DIRECTORY_ITEM_METRIC_SOURCES,
        resolverOf(context),
      ),
    );
    bind<ItemMetricsReader>(DIRECTORY_TYPES.ItemMetricsReader).to(
      SourcedItemMetricsReader,
    );
    bind<LaunchHighlightsReader>(DIRECTORY_TYPES.LaunchHighlightsReader).to(
      SourcedLaunchHighlightsReader,
    );
    bind<DirectoryReader>(DIRECTORY_TYPES.DirectoryReader).to(
      ListingDirectoryReader,
    );
    bind<DirectoryCategoryReader>(DIRECTORY_TYPES.DirectoryCategoryReader).to(
      CountedDirectoryCategoryReader,
    );
    bind<ProductPageReader>(DIRECTORY_TYPES.ProductPageReader).to(
      DirectoryProductPageReader,
    );
    bind<LiveMatchReader>(DIRECTORY_TYPES.LiveMatchReader).to(
      DirectoryLiveMatchReader,
    );
    bind<SupporterListReader>(DIRECTORY_TYPES.SupporterListReader).to(
      DirectorySupporterListReader,
    );
    bind<UserLifecycleSyncHandler>(
      DIRECTORY_TYPES.AccountIndexRemovalSyncHandler,
    ).to(AccountIndexRemovalSyncHandler);
    bind<ProductLifecycleSyncHandler>(
      DIRECTORY_TYPES.ProductIndexRemovalSyncHandler,
    ).to(ProductIndexRemovalSyncHandler);
  }),
};
