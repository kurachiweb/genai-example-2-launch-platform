import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { PRODUCT_CATEGORY_OTHER_ID } from '../../common-lib/product/product-category-constants.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../lib/core/product/identifiers.ts';
import type {
  LaunchExport,
  LaunchOutcomeRecorder,
  ProductCategoryDirectory,
  ProductDirectory,
  ProductExport,
  ProductLifecycleStore,
  ScheduledLaunchDirectory,
} from '../../lib/core/product/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  D1LaunchOutcomeRecorder,
  D1ScheduledLaunchDirectory,
} from '../../lib/workers/product/d1-launch-schedule.ts';
import { D1ProductCategoryDirectory } from '../../lib/workers/product/d1-product-category-directory.ts';
import { D1ProductDirectory } from '../../lib/workers/product/d1-product-directory.ts';
import {
  D1LaunchExport,
  D1ProductExport,
} from '../../lib/workers/product/d1-product-export.ts';
import {
  after,
  clearProductTables,
  T0,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import {
  SAMPLE_EVENT_ID,
  SAMPLE_LAUNCH_DATE,
  SAMPLE_LAUNCH_ID,
  SAMPLE_OWNER_ID,
  SAMPLE_PRODUCT_ID,
  seedProductPlatformSample,
} from '../../lib/workers/product/testing/product-platform-fixtures.ts';
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

beforeEach(async () => {
  await clearProductTables();
  await seedProductPlatformSample();
});

describe('APIサーバーのプロダクトの共通の束縛', () => {
  test('処理単位のコンテナから表示用とカテゴリの照会をD1の実装に解決し、ハンドルとカテゴリを引ける', async () => {
    const container = createContainer();
    const directory = container.get<ProductDirectory>(
      PRODUCT_PLATFORM_TYPES.ProductDirectory,
    );
    const categories = container.get<ProductCategoryDirectory>(
      PRODUCT_PLATFORM_TYPES.ProductCategoryDirectory,
    );

    expect(directory).toBeInstanceOf(D1ProductDirectory);
    expect(categories).toBeInstanceOf(D1ProductCategoryDirectory);
    await expect(directory.resolveHandle('alpha')).resolves.toMatchObject({
      kind: 'current',
      product: { productId: SAMPLE_PRODUCT_ID, handle: 'Alpha' },
    });
    await expect(categories.list()).resolves.toEqual([
      expect.objectContaining({ id: PRODUCT_CATEGORY_OTHER_ID }),
    ]);
  });

  test('処理単位のコンテナから予定のローンチの照会と予選の結果の記録をD1の実装に解決し、ローンチを引いて結果を記録できる', async () => {
    const container = createContainer();
    const schedule = container.get<ScheduledLaunchDirectory>(
      PRODUCT_PLATFORM_TYPES.ScheduledLaunchDirectory,
    );
    const recorder = container.get<LaunchOutcomeRecorder>(
      PRODUCT_PLATFORM_TYPES.LaunchOutcomeRecorder,
    );

    expect(schedule).toBeInstanceOf(D1ScheduledLaunchDirectory);
    expect(recorder).toBeInstanceOf(D1LaunchOutcomeRecorder);
    await expect(
      schedule.listForDate({
        launchDate: SAMPLE_LAUNCH_DATE,
        after: undefined,
        limit: 10,
      }),
    ).resolves.toMatchObject({
      launches: [{ launchId: SAMPLE_LAUNCH_ID }],
      next: undefined,
    });
    await expect(
      recorder.record([
        { launchId: SAMPLE_LAUNCH_ID, outcome: 'lost', decidedAt: after(1) },
      ]),
    ).resolves.toEqual(new Map([[SAMPLE_LAUNCH_ID, 'recorded']]));
  });

  test('処理単位のコンテナからデータエクスポートの照会をD1の実装に解決し、投稿者のプロダクトとローンチを引ける', async () => {
    const container = createContainer();
    const productExport = container.get<ProductExport>(
      PRODUCT_PLATFORM_TYPES.ProductExport,
    );
    const launchExport = container.get<LaunchExport>(
      PRODUCT_PLATFORM_TYPES.LaunchExport,
    );

    expect(productExport).toBeInstanceOf(D1ProductExport);
    expect(launchExport).toBeInstanceOf(D1LaunchExport);
    await expect(productExport.listByUser(SAMPLE_OWNER_ID)).resolves.toEqual([
      expect.objectContaining({ id: SAMPLE_PRODUCT_ID }),
    ]);
    await expect(launchExport.listByUser(SAMPLE_OWNER_ID, T0)).resolves.toEqual(
      [expect.objectContaining({ id: SAMPLE_LAUNCH_ID })],
    );
  });

  test('処理単位のコンテナからライフサイクルの記録のストアを解決し、イベントを引ける', async () => {
    const store = createContainer().get<ProductLifecycleStore>(
      PRODUCT_PLATFORM_TYPES.ProductLifecycleStore,
    );

    await expect(store.findEvent(SAMPLE_EVENT_ID)).resolves.toMatchObject({
      id: SAMPLE_EVENT_ID,
      productId: SAMPLE_PRODUCT_ID,
    });
  });
});
