import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { describe, expect, test } from 'vitest';

import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  CountedDirectoryCategoryReader,
  type DirectoryCategoryReader,
} from '../application/directory/directory-category-reader.ts';
import {
  type DirectoryReader,
  ListingDirectoryReader,
} from '../application/directory/directory-reader.ts';
import { DIRECTORY_TYPES } from '../application/directory/directory-types.ts';
import type { RegisteredItemMetricSource } from '../application/directory/item-metric-sources.ts';
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
import { DIRECTORY_ITEM_METRIC_SOURCES } from './directory-item-metric-sources.ts';
import { MODULES } from './modules.ts';

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

describe('APIサーバーのディレクトリの束縛', () => {
  test('一覧とカテゴリの選択肢のユースケースと、要約・項目の値の読み取りを処理単位のコンテナから解決する', () => {
    const container = createContainer();

    expect(
      container.get<DirectoryReader>(DIRECTORY_TYPES.DirectoryReader),
    ).toBeInstanceOf(ListingDirectoryReader);
    expect(
      container.get<DirectoryCategoryReader>(
        DIRECTORY_TYPES.DirectoryCategoryReader,
      ),
    ).toBeInstanceOf(CountedDirectoryCategoryReader);
    expect(
      container.get<LaunchHighlightsReader>(
        DIRECTORY_TYPES.LaunchHighlightsReader,
      ),
    ).toBeInstanceOf(SourcedLaunchHighlightsReader);
    expect(
      container.get<ItemMetricsReader>(DIRECTORY_TYPES.ItemMetricsReader),
    ).toBeInstanceOf(SourcedItemMetricsReader);
  });

  test('プロダクト詳細ページ・開催中のマッチ・サポーターの一覧のユースケースを処理単位のコンテナから解決する', () => {
    const container = createContainer();

    expect(
      container.get<ProductPageReader>(DIRECTORY_TYPES.ProductPageReader),
    ).toBeInstanceOf(DirectoryProductPageReader);
    expect(
      container.get<LiveMatchReader>(DIRECTORY_TYPES.LiveMatchReader),
    ).toBeInstanceOf(DirectoryLiveMatchReader);
    expect(
      container.get<SupporterListReader>(DIRECTORY_TYPES.SupporterListReader),
    ).toBeInstanceOf(DirectorySupporterListReader);
  });

  test('項目の値の供給元は登録の一覧と同じ数だけ解決する', () => {
    const sources = createContainer().get<
      readonly RegisteredItemMetricSource[]
    >(DIRECTORY_TYPES.ItemMetricSources);

    expect(sources.map(({ name, key }) => ({ name, key }))).toEqual(
      DIRECTORY_ITEM_METRIC_SOURCES.map(({ name, key }) => ({ name, key })),
    );
  });
});
