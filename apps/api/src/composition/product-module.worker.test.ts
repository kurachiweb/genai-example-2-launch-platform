import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { type Container, ContainerModule } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  PRODUCT_CATEGORY_CREATE_ACTION,
  PRODUCT_CATEGORY_DELETE_ACTION,
  PRODUCT_CATEGORY_UPDATE_ACTION,
} from '../../common-lib/admin/audit-actions/product-launch.ts';
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
import type { CurrentAdmin } from '../../lib/core/admin/current-admin.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { CurrentUser } from '../../lib/core/identity/account-guard.ts';
import { MEDIA_TYPES } from '../../lib/core/media/identifiers.ts';
import type { UploadPurposeRegistry } from '../../lib/core/media/upload-purpose.ts';
import type { SessionView } from '../../lib/core/session/session-view.ts';
import type { ScheduledJobHandler } from '../../lib/core/scheduling/cron-registry.ts';
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
  insertLaunch,
  insertProduct,
  insertUser,
  productIdOf,
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
import { ProductLifecycleRedispatchJob } from '../application/product/jobs/product-lifecycle-redispatch-job.ts';
import { ProductPurgeOrchestratorJob } from '../application/product/jobs/product-purge-orchestrator-job.ts';
import type {
  LaunchHistoryStore,
  ProductCategoryStore,
  ProductIncidentReporter,
  ProductLifecycleCommitter,
  ProductStore,
} from '../application/product/ports.ts';
import {
  type ProductCategoryService,
  StoreProductCategoryService,
} from '../application/product/product-category-service.ts';
import {
  type LaunchHistoryReader,
  StoreLaunchHistoryReader,
} from '../application/product/launch-history-reader.ts';
import {
  type MyProductsReader,
  StoreMyProductsReader,
} from '../application/product/my-products-reader.ts';
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
import { computeLaunchDateWindow } from '../domain/product/launch-date-rules.ts';
import {
  adminIdOf,
  clearAdminTables,
  readAuditLogSummaries,
  readAuditLogTargetIds,
} from '../infrastructure/admin/testing/admin-store-fixtures.ts';
import { D1LaunchHistoryStore } from '../infrastructure/product/d1-launch-history-store.ts';
import { D1ProductCategoryStore } from '../infrastructure/product/d1-product-category-store.ts';
import { D1ProductStore } from '../infrastructure/product/d1-product-store.ts';
import type { ProductSaveHooks } from '../infrastructure/product/product-save-hooks.ts';
import { SentryProductIncidentReporter } from '../infrastructure/product/sentry-product-incident-reporter.ts';
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

  test('ライフサイクルの確定は、初版の空の同期の処理の登録口で組み立てた部品に解決し、非公開化をD1へ確定する', async () => {
    await insertUser(OWNER, { emailVerifiedAt: T0 });
    await insertProduct(1, OWNER);
    const committer = createContainer().get<ProductLifecycleCommitter>(
      PRODUCT_TYPES.ProductLifecycleCommitter,
    );

    const result = await committer.commit({
      type: 'hidden',
      productId: productIdOf(1),
      at: REGISTRATION_NOW,
    });

    expect(result).toMatchObject({
      kind: 'committed',
      event: {
        productId: productIdOf(1),
        ownerUserId: userIdOf(OWNER),
        type: 'hidden',
        occurredAt: REGISTRATION_NOW,
      },
    });
  });

  test('削除と非公開化・復元の操作口を、後続specが識別子で解決できるそれぞれの実装に解決する', () => {
    const container = createContainer();

    expect(
      container.get<ProductDeletion>(PRODUCT_TYPES.ProductDeletion),
    ).toBeInstanceOf(StoreProductDeletion);
    expect(
      container.get<ProductVisibilityControl>(
        PRODUCT_TYPES.ProductVisibilityControl,
      ),
    ).toBeInstanceOf(StoreProductVisibilityControl);
  });

  test('4:21の2つのジョブと期限超過の報告を、定期実行の起動ごとのコンテナでそれぞれの実装に解決する', () => {
    const container = createContainer();

    expect(
      container.get<ProductIncidentReporter>(
        PRODUCT_TYPES.ProductIncidentReporter,
      ),
    ).toBeInstanceOf(SentryProductIncidentReporter);
    expect(
      container.get<ScheduledJobHandler>(
        PRODUCT_TYPES.ProductPurgeOrchestratorJob,
      ),
    ).toBeInstanceOf(ProductPurgeOrchestratorJob);
    expect(
      container.get<ScheduledJobHandler>(
        PRODUCT_TYPES.ProductLifecycleRedispatchJob,
      ),
    ).toBeInstanceOf(ProductLifecycleRedispatchJob);
  });

  test('非公開化・復元の操作口は、実物の確定と送信の部品で非公開化を確定し、同じ状態ならunchangedを返す', async () => {
    await insertUser(OWNER, { emailVerifiedAt: T0 });
    await insertProduct(1, OWNER);
    const control = createContainer().get<ProductVisibilityControl>(
      PRODUCT_TYPES.ProductVisibilityControl,
    );

    expect(await control.hide(productIdOf(1), REGISTRATION_NOW)).toBe(
      'changed',
    );
    expect(await control.hide(productIdOf(1), REGISTRATION_NOW)).toBe(
      'unchanged',
    );
    const [hidden] = await db
      .select({ hiddenAt: products.hiddenAt })
      .from(products)
      .where(eq(products.id, productIdOf(1)));
    expect(hidden?.hiddenAt).toEqual(REGISTRATION_NOW);

    expect(await control.unhide(productIdOf(1), REGISTRATION_NOW)).toBe(
      'changed',
    );
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

describe('プロダクトカテゴリのマスタ(実物の束縛)', () => {
  const ADMIN: CurrentAdmin = {
    id: adminIdOf(1),
    role: 'moderator',
    nickname: '運営の管理者',
    sessionId: 'session-1',
  };

  test('ストアとユースケースを処理単位のコンテナからそれぞれの実装に解決する', () => {
    const container = createContainer();

    expect(
      container.get<ProductCategoryStore>(PRODUCT_TYPES.ProductCategoryStore),
    ).toBeInstanceOf(D1ProductCategoryStore);
    expect(
      container.get<ProductCategoryService>(
        PRODUCT_TYPES.ProductCategoryService,
      ),
    ).toBeInstanceOf(StoreProductCategoryService);
  });

  test('追加・変更・削除を、本物の監査ログの記録で操作種別と対象を検証してD1へ確定する', async () => {
    await clearAdminTables();
    const service = createContainer().get<ProductCategoryService>(
      PRODUCT_TYPES.ProductCategoryService,
    );

    const created = await service.create(
      ADMIN,
      { name: ' 開発ツール ', handle: 'dev-tools' },
      undefined,
    );
    await service.update(
      ADMIN,
      created.id,
      { name: '開発者ツール', handle: 'developer-tools' },
      '表記の統一',
    );
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        name: '開発者ツール',
        handle: 'developer-tools',
      }),
      expect.objectContaining({ id: PRODUCT_CATEGORY_OTHER_ID }),
    ]);
    await service.delete(ADMIN, created.id, undefined);

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ id: PRODUCT_CATEGORY_OTHER_ID }),
    ]);
    const summaries = await readAuditLogSummaries();
    expect(summaries.map((summary) => summary.action).toSorted()).toEqual(
      [
        PRODUCT_CATEGORY_CREATE_ACTION.name,
        PRODUCT_CATEGORY_UPDATE_ACTION.name,
        PRODUCT_CATEGORY_DELETE_ACTION.name,
      ].toSorted(),
    );
    expect(
      summaries.every((summary) => summary.operatorAdminId === ADMIN.id),
    ).toBe(true);
    await expect(readAuditLogTargetIds()).resolves.toEqual([
      created.id,
      created.id,
      created.id,
    ]);
  });
});

describe('ローンチ履歴(実物の束縛)', () => {
  const sessionOf = (userIndex: number | undefined): SessionView => ({
    principal: () =>
      Promise.resolve(
        userIndex === undefined
          ? { kind: 'anonymous' }
          : {
              kind: 'authenticated',
              subjectKind: 'user',
              subjectId: userIdOf(userIndex),
              sessionId: '01JC0SESSION000000000000001',
            },
      ),
  });

  test('ストアとユースケースを処理単位のコンテナからそれぞれの実装に解決する', () => {
    const container = createContainer();

    expect(
      container.get<LaunchHistoryStore>(PRODUCT_TYPES.LaunchHistoryStore),
    ).toBeInstanceOf(D1LaunchHistoryStore);
    expect(
      container.get<LaunchHistoryReader>(PRODUCT_TYPES.LaunchHistoryReader),
    ).toBeInstanceOf(StoreLaunchHistoryReader);
  });

  test('他人には掲載済みのプロダクトだけを、本人には未掲載を含めて、予選の結果からの要約付きで返す', async () => {
    await insertUser(OWNER, { emailVerifiedAt: T0 });
    await insertUser(2, { emailVerifiedAt: T0 });
    await insertProduct(1, OWNER, { latestLaunchDate: '2026-11-01' });
    await insertProduct(2, OWNER, { latestLaunchDate: '2026-11-20' });
    await insertLaunch(1, 1, {
      launchDate: '2026-11-01',
      outcome: 'won',
      decidedAt: T0,
    });
    await insertLaunch(2, 2, { launchDate: '2026-11-20' });
    const reader = createRegistrationContainer().get<LaunchHistoryReader>(
      PRODUCT_TYPES.LaunchHistoryReader,
    );
    const input = { userHandle: 'user1', first: 20, after: undefined };

    const guest = await reader.list(sessionOf(undefined), input);
    const other = await reader.list(sessionOf(2), input);
    const owner = await reader.list(sessionOf(OWNER), input);

    expect(guest).toEqual(other);
    expect(guest).toMatchObject({
      viewerIsOwner: false,
      ownerSuspended: false,
      totalCount: 1,
      hasNextPage: false,
      nodes: [
        {
          product: { productId: productIdOf(1), listed: true },
          launches: [
            {
              number: 1,
              status: 'finished',
              summary: { label: 'ディレクトリ掲載', inMatch: false },
            },
          ],
          awards: [],
        },
      ],
    });
    expect(owner).toMatchObject({
      viewerIsOwner: true,
      totalCount: 2,
      nodes: [
        {
          product: { productId: productIdOf(2), listed: false },
          launches: [
            {
              status: 'scheduled',
              summary: { label: 'キックオフ予定', inMatch: false },
            },
          ],
        },
        { product: { productId: productIdOf(1) } },
      ],
    });
    expect(
      await reader.list(sessionOf(undefined), {
        ...input,
        userHandle: 'nobody',
      }),
    ).toBeNull();
  });
});
