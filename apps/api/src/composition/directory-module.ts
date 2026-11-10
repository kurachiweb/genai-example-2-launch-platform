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
import { DIRECTORY_ITEM_METRIC_SOURCES } from './directory-item-metric-sources.ts';

const resolverOf =
  (context: ResolutionContext) =>
  <T>(identifier: ServiceIdentifier<T>): T =>
    context.get(identifier);

// 一覧の照会(DIRECTORY_PLATFORM_TYPES)・プロダクトとカテゴリの照会と要約の供給元(PRODUCT_PLATFORM_TYPES・PRODUCT_TYPES)・マッチの照会(MATCH_PLATFORM_TYPES)は各機能の束縛を使う
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
  }),
};
