import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { PRODUCT_CATEGORY_OTHER_ID } from '../../common-lib/product/product-category-constants.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../lib/core/product/identifiers.ts';
import type {
  AdminProductDirectory,
  LaunchExport,
  LaunchOutcomeRecorder,
  ProductCategoryDirectory,
  ProductDirectory,
  ProductExport,
  ProductLifecycleStore,
  ScheduledLaunchDirectory,
} from '../../lib/core/product/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1AdminProductDirectory } from '../../lib/workers/product/d1-admin-product-directory.ts';
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

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const INVOCATION_KINDS = ['fetch', 'queue'] as const;

function createContainer(kind: (typeof INVOCATION_KINDS)[number]): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind,
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

// setupFilesでcloudflare:testを読み込むと、他のテストファイルのvi.mockより先にエントリが読み込まれて差し替えが効かなくなるため、D1を使うこのファイルで適用する
beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearProductTables();
  await seedProductPlatformSample();
});

describe.each(INVOCATION_KINDS)(
  'イベントサーバーのプロダクトの共通の束縛(%s)',
  (kind) => {
    test('処理単位のコンテナから表示用とカテゴリの照会をD1の実装に解決し、ハンドルとカテゴリを引ける', async () => {
      const container = createContainer(kind);
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
      const container = createContainer(kind);
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
          { launchId: SAMPLE_LAUNCH_ID, outcome: 'won', decidedAt: after(1) },
        ]),
      ).resolves.toEqual(new Map([[SAMPLE_LAUNCH_ID, 'recorded']]));
    });

    test('処理単位のコンテナからデータエクスポートの照会をD1の実装に解決し、投稿者のプロダクトとローンチを引ける', async () => {
      const container = createContainer(kind);
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
      await expect(
        launchExport.listByUser(SAMPLE_OWNER_ID, T0),
      ).resolves.toEqual([expect.objectContaining({ id: SAMPLE_LAUNCH_ID })]);
    });

    test('処理単位のコンテナからライフサイクルの記録のストアを解決し、イベントを引ける', async () => {
      const store = createContainer(kind).get<ProductLifecycleStore>(
        PRODUCT_PLATFORM_TYPES.ProductLifecycleStore,
      );

      await expect(store.findEvent(SAMPLE_EVENT_ID)).resolves.toMatchObject({
        id: SAMPLE_EVENT_ID,
        productId: SAMPLE_PRODUCT_ID,
      });
    });

    test('処理単位のコンテナから管理画面のプロダクトの検索の照会をD1の実装に解決し、プロダクトの検索と登録数の数え上げができる', async () => {
      const directory = createContainer(kind).get<AdminProductDirectory>(
        PRODUCT_PLATFORM_TYPES.AdminProductDirectory,
      );

      expect(directory).toBeInstanceOf(D1AdminProductDirectory);
      await expect(
        directory.search({ handle: 'alp' }, { limit: 10 }, T0),
      ).resolves.toMatchObject({
        products: [{ productId: SAMPLE_PRODUCT_ID }],
        nextCursor: null,
      });
      await expect(directory.countRegisteredAt(after(1))).resolves.toBe(1);
    });
  },
);
