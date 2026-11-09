import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { type Container, ContainerModule } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { IMAGE_MEDIA_TYPES } from '../../common-lib/media/media-types.ts';
import { UPLOAD_FILE_NAME_HEADER } from '../../common-lib/media/upload-protocol.ts';
import { PRODUCT_CATEGORY_OTHER_ID } from '../../common-lib/product/product-category-constants.ts';
import {
  PRODUCT_LOGO_MAX_BYTES,
  PRODUCT_LOGO_PURPOSE,
  PRODUCT_SCREENSHOT_MAX_BYTES,
  PRODUCT_SCREENSHOT_PURPOSE,
} from '../../common-lib/product/product-input-rules.ts';
import { productLaunches } from '../../db/schema/product/product-launches.ts';
import { products } from '../../db/schema/product/products.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { CurrentUser } from '../../lib/core/identity/account-guard.ts';
import { MEDIA_TYPES } from '../../lib/core/media/identifiers.ts';
import type { UploadPurposeRegistry } from '../../lib/core/media/upload-purpose.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../lib/core/time/business-time.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import {
  fileIdOf,
  insertFile,
} from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  clearMediaState,
  countRecords,
  pngBytes,
} from '../../lib/workers/media/testing/upload-receiver-fixtures.ts';
import {
  clearProductTables,
  db,
  insertUser,
  T0,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { callInternal } from '../../test/support/gateway-test-harness.ts';
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import type { SessionIssuer } from '../application/identity/session-issuer.ts';
import type {
  LaunchSummarySource,
  ProductLockSource,
  RegisteredDecisionSource,
  RelaunchConditionSource,
} from '../application/product/decision-sources.ts';
import type { ProductStore } from '../application/product/ports.ts';
import {
  type MyProductsReader,
  StoreMyProductsReader,
} from '../application/product/my-products-reader.ts';
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
import { computeLaunchDateWindow } from '../domain/product/launch-date-rules.ts';
import { D1ProductStore } from '../infrastructure/product/d1-product-store.ts';
import type { ProductSaveHooks } from '../infrastructure/product/product-save-hooks.ts';
import { GATEWAY_HEADERS } from '../presentation/gateway/gateway-headers.ts';
import { MODULES } from './modules.ts';

const BASE_URL = 'https://api.launch.example';
const RELAYED_IP = '203.0.113.7';

const OWNER = 1;
const LOGO_FILE = 1;
const SCREENSHOT_FILE = 2;

function createContainer(
  modules: readonly AppModule<Hono<PlatformHonoEnv<Env>>>[] = MODULES,
): Container {
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
    modules,
  );
}

// 選べる日と状態の判定が実行の時刻で変わらないよう、時計だけを業務時刻の昼に固定する
const REGISTRATION_NOW = fromBusinessDateTime(parseBusinessDate('2026-11-10'), {
  hour: 12,
  minute: 0,
});

const FIXED_CLOCK: Clock = { now: () => REGISTRATION_NOW };

const fixedClockOverride: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'fixed-clock',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(FIXED_CLOCK);
  }),
};

function createRegistrationContainer(): Container {
  return createContainer([...MODULES, fixedClockOverride]);
}

const ownerOf = (index: number): CurrentUser => ({
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: userIdOf(index),
    sessionId: '01JC0SESSION000000000000001',
  },
  user: {
    id: userIdOf(index),
    pseudonymousId: '01JC0PSEUDO000000000000001',
    status: 'active',
    emailVerifiedAt: T0,
    deletedAt: null,
    email: 'owner@mail.example',
    nickname: 'オーナー',
    handle: 'owner',
  },
});

beforeEach(async () => {
  await clearProductTables();
  await clearMediaState();
});

describe('APIサーバーのプロダクトのモジュールの束縛', () => {
  test('処理単位のコンテナから、ストア・登録と編集と説明文の更新と自分のプロダクトの照会とハンドルの使用可否のユースケース・状態の判定をそれぞれの実装に解決する', () => {
    const container = createContainer();

    expect(
      container.get<ProductStore>(PRODUCT_TYPES.ProductStore),
    ).toBeInstanceOf(D1ProductStore);
    expect(
      container.get<ProductRegistration>(PRODUCT_TYPES.ProductRegistration),
    ).toBeInstanceOf(StoreProductRegistration);
    expect(
      container.get<ProductEditor>(PRODUCT_TYPES.ProductEditor),
    ).toBeInstanceOf(StoreProductEditor);
    expect(
      container.get<ProductDescriptionEditor>(
        PRODUCT_TYPES.ProductDescriptionEditor,
      ),
    ).toBeInstanceOf(StoreProductDescriptionEditor);
    expect(
      container.get<MyProductsReader>(PRODUCT_TYPES.MyProductsReader),
    ).toBeInstanceOf(StoreMyProductsReader);
    expect(
      container.get<ProductHandleAvailabilityChecker>(
        PRODUCT_TYPES.ProductHandleAvailabilityChecker,
      ),
    ).toBeInstanceOf(StoreProductHandleAvailabilityChecker);
    expect(
      container.get<ProductStateEvaluator>(PRODUCT_TYPES.ProductStateEvaluator),
    ).toBeInstanceOf(DefaultProductStateEvaluator);
  });

  test('判定の供給元は、初版の空の登録口から組み立てた空の一覧に解決する', () => {
    const container = createContainer();

    expect(
      container.get<
        readonly RegisteredDecisionSource<RelaunchConditionSource>[]
      >(PRODUCT_TYPES.RelaunchConditionSources),
    ).toEqual([]);
    expect(
      container.get<readonly RegisteredDecisionSource<ProductLockSource>[]>(
        PRODUCT_TYPES.ProductLockSources,
      ),
    ).toEqual([]);
    expect(
      container.get<readonly RegisteredDecisionSource<LaunchSummarySource>[]>(
        PRODUCT_TYPES.LaunchSummarySources,
      ),
    ).toEqual([]);
  });

  test('保存の登録口は、初版の空の登録口から組み立てた部品に解決し、文を加えない', async () => {
    const hooks = createContainer().get<ProductSaveHooks>(
      PRODUCT_TYPES.ProductSaveHooks,
    );

    await expect(
      hooks.statementsFor(
        { productId: '01JD0PRODUCT00000000000001', at: T0 },
        db,
      ),
    ).resolves.toEqual([]);
  });
});

describe('プロダクトの登録(実物の束縛)', () => {
  test('確認済みの利用者が、標準カテゴリ・本人の画像・選べる最も早い日で登録すると、プロダクトと最初のローンチを保存して状態付きで返す', async () => {
    await insertUser(OWNER, { emailVerifiedAt: T0 });
    await insertFile(LOGO_FILE, {
      purpose: PRODUCT_LOGO_PURPOSE,
      ownerId: userIdOf(OWNER),
    });
    await insertFile(SCREENSHOT_FILE, {
      purpose: PRODUCT_SCREENSHOT_PURPOSE,
      ownerId: userIdOf(OWNER),
    });
    const { earliest } = computeLaunchDateWindow({
      now: REGISTRATION_NOW,
      basis: null,
      entitled: false,
    });

    const view = await createRegistrationContainer()
      .get<ProductRegistration>(PRODUCT_TYPES.ProductRegistration)
      .register(ownerOf(OWNER), {
        name: 'ローンチ計測',
        tagline: '公開の反応をまとめて見る',
        categoryId: PRODUCT_CATEGORY_OTHER_ID,
        handle: 'Launch-Meter',
        websiteUrl: 'https://launch-meter.example/',
        descriptionMarkdown: '# 概要',
        logoFileId: fileIdOf(LOGO_FILE),
        screenshotFileIds: [fileIdOf(SCREENSHOT_FILE)],
        launchDate: earliest,
      });

    expect(view).toMatchObject({
      handle: 'Launch-Meter',
      category: { id: PRODUCT_CATEGORY_OTHER_ID },
      logoFileId: fileIdOf(LOGO_FILE),
      screenshotFileIds: [fileIdOf(SCREENSHOT_FILE)],
      hidden: false,
      listed: false,
      state: {
        latestLaunch: { launchDate: earliest, status: 'scheduled' },
        plan: { mode: 'reschedule', current: earliest },
      },
    });
    const [saved] = await db
      .select({ userId: products.userId, handle: products.handle })
      .from(products)
      .where(eq(products.id, view.productId));
    expect(saved).toEqual({ userId: userIdOf(OWNER), handle: 'Launch-Meter' });
    expect(
      await db
        .select({ launchDate: productLaunches.launchDate })
        .from(productLaunches)
        .where(eq(productLaunches.productId, view.productId)),
    ).toEqual([{ launchDate: earliest }]);
  });

  test('他の利用者の画像は紐付けられず、invalid_uploadで拒否してプロダクトを作らない', async () => {
    await insertUser(OWNER, { emailVerifiedAt: T0 });
    await insertUser(2, { emailVerifiedAt: T0 });
    await insertFile(LOGO_FILE, {
      purpose: PRODUCT_LOGO_PURPOSE,
      ownerId: userIdOf(2),
    });
    const { earliest } = computeLaunchDateWindow({
      now: REGISTRATION_NOW,
      basis: null,
      entitled: false,
    });

    await expect(
      createRegistrationContainer()
        .get<ProductRegistration>(PRODUCT_TYPES.ProductRegistration)
        .register(ownerOf(OWNER), {
          name: 'ローンチ計測',
          tagline: '公開の反応をまとめて見る',
          categoryId: PRODUCT_CATEGORY_OTHER_ID,
          handle: 'launch-meter',
          websiteUrl: 'https://launch-meter.example/',
          descriptionMarkdown: '# 概要',
          logoFileId: fileIdOf(LOGO_FILE),
          screenshotFileIds: [],
          launchDate: earliest,
        }),
    ).rejects.toMatchObject({ code: 'invalid_upload' });
    expect(await db.select({ id: products.id }).from(products)).toEqual([]);
  });
});

describe('自分のプロダクトの照会とハンドルの使用可否(実物の束縛)', () => {
  test('登録したプロダクトを、一覧と1件の照会と所有者の状態で本人だけに返し、使用可否は編集中のプロダクトの現在のハンドルを使えるとする', async () => {
    await insertUser(OWNER, { emailVerifiedAt: T0 });
    await insertUser(2, { emailVerifiedAt: T0 });
    await insertFile(LOGO_FILE, {
      purpose: PRODUCT_LOGO_PURPOSE,
      ownerId: userIdOf(OWNER),
    });
    const container = createRegistrationContainer();
    const { earliest } = container
      .get<MyProductsReader>(PRODUCT_TYPES.MyProductsReader)
      .newProductWindow(ownerOf(OWNER), REGISTRATION_NOW);
    const registered = await container
      .get<ProductRegistration>(PRODUCT_TYPES.ProductRegistration)
      .register(ownerOf(OWNER), {
        name: 'ローンチ計測',
        tagline: '公開の反応をまとめて見る',
        categoryId: PRODUCT_CATEGORY_OTHER_ID,
        handle: 'launch-meter',
        websiteUrl: 'https://launch-meter.example/',
        descriptionMarkdown: '# 概要',
        logoFileId: fileIdOf(LOGO_FILE),
        screenshotFileIds: [],
        launchDate: earliest,
      });
    const reader = createRegistrationContainer().get<MyProductsReader>(
      PRODUCT_TYPES.MyProductsReader,
    );
    const checker =
      createRegistrationContainer().get<ProductHandleAvailabilityChecker>(
        PRODUCT_TYPES.ProductHandleAvailabilityChecker,
      );

    const page = await reader.list(ownerOf(OWNER), {
      first: 20,
      after: undefined,
    });

    expect(page.nodes).toEqual([registered]);
    expect(page.hasNextPage).toBe(false);
    expect(
      await reader.list(ownerOf(OWNER), {
        first: 20,
        after: page.endCursor ?? undefined,
      }),
    ).toEqual({ nodes: [], hasNextPage: false, endCursor: null });
    expect(await reader.find(ownerOf(OWNER), 'launch-meter')).toEqual({
      kind: 'product',
      product: registered,
    });
    expect(await reader.find(ownerOf(2), 'launch-meter')).toEqual({
      kind: 'not-found',
    });
    expect(await reader.ownerStatus(ownerOf(OWNER), 'launch-meter')).toEqual({
      latestLaunch: registered.state.latestLaunch,
      state: registered.state,
    });
    expect(await reader.ownerStatus(ownerOf(2), 'launch-meter')).toBeNull();
    expect(
      await checker.check(ownerOf(OWNER), 'Launch-Meter', 'launch-meter'),
    ).toBe('available');
    expect(await checker.check(ownerOf(2), 'Launch-Meter', undefined)).toBe(
      'unavailable',
    );
  });
});

describe('プロダクトの画像のアップロードの用途', () => {
  async function issueUserSession(userIndex: number): Promise<string> {
    const issued = await createContainer()
      .get<SessionIssuer>(IDENTITY_TYPES.SessionIssuer)
      .issue(userIdOf(userIndex), {
        clientIp: undefined,
        userAgent: undefined,
        now: new Date(),
      });
    return issued.token;
  }

  function uploadRequest(
    token: string,
    purpose: string,
    byteLength: number,
  ): Request {
    return new Request(`${BASE_URL}/internal/media/uploads/${purpose}`, {
      method: 'POST',
      headers: {
        [GATEWAY_HEADERS.clientIp]: RELAYED_IP,
        [GATEWAY_HEADERS.sessionToken]: token,
        [UPLOAD_FILE_NAME_HEADER]: 'image.png',
        'Content-Type': 'image/png',
        'Content-Length': String(byteLength),
      },
      body: pngBytes(16, 16, byteLength),
    });
  }

  test('ロゴは画像の5形式を512,000バイトまで、スクリーンショットは5,242,880バイトまで、利用者だけが画像の保存先へアップロードできる用途として登録する', () => {
    const registry = createContainer().get<UploadPurposeRegistry>(
      MEDIA_TYPES.UploadPurposeRegistry,
    );

    expect(registry.find(PRODUCT_LOGO_PURPOSE)).toEqual({
      name: 'product-logo',
      storage: 'images',
      uploaderKinds: ['user'],
      allowedTypes: IMAGE_MEDIA_TYPES,
      maxBytes: 512_000,
    });
    expect(registry.find(PRODUCT_SCREENSHOT_PURPOSE)).toEqual({
      name: 'product-screenshot',
      storage: 'images',
      uploaderKinds: ['user'],
      allowedTypes: IMAGE_MEDIA_TYPES,
      maxBytes: 5_242_880,
    });
    expect(PRODUCT_LOGO_MAX_BYTES).toBe(512_000);
    expect(PRODUCT_SCREENSHOT_MAX_BYTES).toBe(5_242_880);
  });

  test('利用者がロゴに512,001バイトの画像をアップロードすると、413で拒否し記録を作らない', async () => {
    await insertUser(OWNER, { emailVerifiedAt: T0 });
    const token = await issueUserSession(OWNER);

    const response = await callInternal(
      'client',
      uploadRequest(token, PRODUCT_LOGO_PURPOSE, PRODUCT_LOGO_MAX_BYTES + 1),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: 'file_too_large' },
    });
    expect(await countRecords()).toBe(0);
  });

  test('利用者がロゴに512,000バイトの画像をアップロードすると、201で受け付ける', async () => {
    await insertUser(OWNER, { emailVerifiedAt: T0 });
    const token = await issueUserSession(OWNER);

    const response = await callInternal(
      'client',
      uploadRequest(token, PRODUCT_LOGO_PURPOSE, PRODUCT_LOGO_MAX_BYTES),
    );

    expect(response.status).toBe(201);
    expect(await countRecords()).toBe(1);
  });

  test('利用者がスクリーンショットに5,242,881バイトの画像をアップロードすると、413で拒否し記録を作らない', async () => {
    await insertUser(OWNER, { emailVerifiedAt: T0 });
    const token = await issueUserSession(OWNER);

    const response = await callInternal(
      'client',
      uploadRequest(
        token,
        PRODUCT_SCREENSHOT_PURPOSE,
        PRODUCT_SCREENSHOT_MAX_BYTES + 1,
      ),
    );

    expect(response.status).toBe(413);
    expect(await countRecords()).toBe(0);
  });
});
