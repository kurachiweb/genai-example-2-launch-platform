import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import { PRODUCT_CATEGORY_OTHER_ID } from '../../../common-lib/product/product-category-constants.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import type { InvocationScopeInfo } from '../../core/di/identifiers.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../core/product/identifiers.ts';
import type {
  LaunchExport,
  LaunchOutcomeRecorder,
  ProductCategoryDirectory,
  ProductDirectory,
  ProductExport,
  ProductLifecycleStore,
  ScheduledLaunchDirectory,
} from '../../core/product/ports.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import {
  D1LaunchOutcomeRecorder,
  D1ScheduledLaunchDirectory,
} from './d1-launch-schedule.ts';
import { D1ProductCategoryDirectory } from './d1-product-category-directory.ts';
import { D1ProductDirectory } from './d1-product-directory.ts';
import { D1LaunchExport, D1ProductExport } from './d1-product-export.ts';
import { PRODUCT_PLATFORM_MODULE } from './product-platform-module.ts';
import { after, clearProductTables, T0 } from './testing/product-fixtures.ts';
import {
  SAMPLE_EVENT_ID,
  SAMPLE_LAUNCH_DATE,
  SAMPLE_LAUNCH_ID,
  SAMPLE_OWNER_ID,
  SAMPLE_PRODUCT_ID,
  seedProductPlatformSample,
} from './testing/product-platform-fixtures.ts';

// 管理画面のプロダクトの検索の照会はこのモジュールにまだ束縛しない
const BOUND_IDENTIFIERS = Object.values(PRODUCT_PLATFORM_TYPES).filter(
  (identifier) => identifier !== PRODUCT_PLATFORM_TYPES.AdminProductDirectory,
);

function createContainer(
  kind: InvocationScopeInfo['kind'] = 'fetch',
): Container {
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
    [PRODUCT_PLATFORM_MODULE],
  );
}

beforeEach(async () => {
  await clearProductTables();
  await seedProductPlatformSample();
});

describe('PRODUCT_PLATFORM_MODULE', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられる', () => {
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      PRODUCT_PLATFORM_MODULE,
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(PRODUCT_PLATFORM_MODULE.name).toBe('product-platform');
    expect('routes' in PRODUCT_PLATFORM_MODULE).toBe(false);
  });

  test('表示用の照会をD1の実装に解決し、ハンドルを大文字小文字を区別せず引ける', async () => {
    const directory = createContainer().get<ProductDirectory>(
      PRODUCT_PLATFORM_TYPES.ProductDirectory,
    );

    expect(directory).toBeInstanceOf(D1ProductDirectory);
    await expect(directory.resolveHandle('ALPHA')).resolves.toMatchObject({
      kind: 'current',
      product: { productId: SAMPLE_PRODUCT_ID, handle: 'Alpha' },
    });
  });

  test('カテゴリの照会をD1の実装に解決し、標準カテゴリを引ける', async () => {
    const categories = createContainer().get<ProductCategoryDirectory>(
      PRODUCT_PLATFORM_TYPES.ProductCategoryDirectory,
    );

    expect(categories).toBeInstanceOf(D1ProductCategoryDirectory);
    await expect(categories.list()).resolves.toEqual([
      expect.objectContaining({
        id: PRODUCT_CATEGORY_OTHER_ID,
        systemDefault: true,
      }),
    ]);
  });

  test('予定のローンチの照会をD1の実装に解決し、指定した日のローンチを引ける', async () => {
    const schedule = createContainer().get<ScheduledLaunchDirectory>(
      PRODUCT_PLATFORM_TYPES.ScheduledLaunchDirectory,
    );

    expect(schedule).toBeInstanceOf(D1ScheduledLaunchDirectory);
    await expect(
      schedule.listForDate({
        launchDate: SAMPLE_LAUNCH_DATE,
        after: undefined,
        limit: 10,
      }),
    ).resolves.toEqual({
      launches: [
        {
          launchId: SAMPLE_LAUNCH_ID,
          productId: SAMPLE_PRODUCT_ID,
          ownerUserId: SAMPLE_OWNER_ID,
          categoryId: PRODUCT_CATEGORY_OTHER_ID,
        },
      ],
      next: undefined,
    });
  });

  test('予選の結果の記録をD1の実装に解決し、結果を記録できる', async () => {
    const recorder = createContainer().get<LaunchOutcomeRecorder>(
      PRODUCT_PLATFORM_TYPES.LaunchOutcomeRecorder,
    );

    expect(recorder).toBeInstanceOf(D1LaunchOutcomeRecorder);
    await expect(
      recorder.record([
        { launchId: SAMPLE_LAUNCH_ID, outcome: 'won', decidedAt: after(1) },
      ]),
    ).resolves.toEqual(new Map([[SAMPLE_LAUNCH_ID, 'recorded']]));
  });

  test('プロダクトとローンチのデータエクスポートの照会をD1の実装に解決し、投稿者の行を引ける', async () => {
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
      expect.objectContaining({ id: SAMPLE_PRODUCT_ID, handle: 'Alpha' }),
    ]);
    await expect(launchExport.listByUser(SAMPLE_OWNER_ID, T0)).resolves.toEqual(
      [
        expect.objectContaining({
          id: SAMPLE_LAUNCH_ID,
          productId: SAMPLE_PRODUCT_ID,
        }),
      ],
    );
  });

  test('ライフサイクルの記録のストアを解決し、未完了のイベントを引ける', async () => {
    const store = createContainer().get<ProductLifecycleStore>(
      PRODUCT_PLATFORM_TYPES.ProductLifecycleStore,
    );

    await expect(store.findEvent(SAMPLE_EVENT_ID)).resolves.toMatchObject({
      id: SAMPLE_EVENT_ID,
      productId: SAMPLE_PRODUCT_ID,
      status: 'pending',
    });
    await expect(
      store.findOldestPending(SAMPLE_PRODUCT_ID),
    ).resolves.toMatchObject({ id: SAMPLE_EVENT_ID });
  });

  test.each(['fetch', 'queue', 'scheduled'] as const)(
    '%sの処理単位でも束縛した7つの識別子をすべて解決する',
    (kind) => {
      const container = createContainer(kind);

      expect(BOUND_IDENTIFIERS).toHaveLength(7);
      for (const identifier of BOUND_IDENTIFIERS) {
        expect(container.get(identifier)).toBeDefined();
      }
    },
  );

  test('照会と記録は処理単位の中では同じインスタンスを返し、別の処理単位では別のインスタンスを返す', () => {
    const first = createContainer();
    const second = createContainer();

    for (const identifier of BOUND_IDENTIFIERS) {
      expect(first.get(identifier)).toBe(first.get(identifier));
      expect(second.get(identifier)).not.toBe(first.get(identifier));
    }
  });

  test('管理画面のプロダクトの検索の照会は束縛しない', () => {
    expect(
      createContainer().isBound(PRODUCT_PLATFORM_TYPES.AdminProductDirectory),
    ).toBe(false);
  });
});
