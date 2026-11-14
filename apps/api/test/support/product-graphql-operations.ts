import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { ContainerModule } from 'inversify';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

import type { AdminRole } from '../../common-lib/admin/admin-roles.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../lib/core/time/business-time.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { PRODUCT_CATEGORY_OTHER_ID } from '../../common-lib/product/product-category-constants.ts';
import { users } from '../../db/schema/identity/users.ts';
import { products } from '../../db/schema/product/products.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { clearMediaTables } from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import { kickoffAt } from '../../lib/core/product/launch-status.ts';
import {
  clearProductTables,
  db,
  insertLaunch,
  insertProduct,
  logoFileIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import type {
  LaunchSummarySource,
  ProductLockSource,
  RegisteredDecisionSource,
  RelaunchConditionSource,
} from '../../src/application/product/decision-sources.ts';
import { PRODUCT_TYPES } from '../../src/application/product/product-types.ts';
import { IDENTITY_TYPES } from '../../src/application/identity/identity-types.ts';
import type { SessionIssuer } from '../../src/application/identity/session-issuer.ts';
import { MODULES } from '../../src/composition/modules.ts';
import {
  adminIdOf,
  clearAdminTables,
  insertAdmin,
} from '../../src/infrastructure/admin/testing/admin-store-fixtures.ts';
import { mediaSchemaModule } from '../../src/presentation/graphql/modules/media/index.ts';
import { productSchemaModule } from '../../src/presentation/graphql/modules/product/index.ts';
import { profileSchemaModule } from '../../src/presentation/graphql/modules/profile/index.ts';
import { issueAdminSession } from './admin-graphql-harness.ts';
import {
  createGraphQLGateway,
  type GatewayApp,
  type GatewayCallOptions,
  type GatewayResponse,
} from './graphql-gateway.ts';
import {
  ADMIN_PRODUCT_CATEGORIES,
  CREATE_PRODUCT_CATEGORY,
  DELETE_PRODUCT,
  DELETE_PRODUCT_CATEGORY,
  type HandleAvailabilityValue,
  LAUNCH_HISTORY,
  type LaunchDateWindowFields,
  type LaunchHistoryConnectionFields,
  MY_PRODUCT,
  MY_PRODUCTS,
  type MyProductConnectionFields,
  type MyProductFields,
  type MyProductRedirectFields,
  NEW_PRODUCT_LAUNCH_WINDOW,
  PRODUCT_CATEGORIES,
  PRODUCT_HANDLE_AVAILABILITY,
  PRODUCT_OWNER_STATUS,
  type ProductAwardFields,
  type ProductCategoryFields,
  type ProductOwnerStatusFields,
  PROFILE_AWARDS,
  REGISTER_PRODUCT,
  UPDATE_PRODUCT,
  UPDATE_PRODUCT_CATEGORY,
} from './product-graphql-documents.ts';
import {
  configureRecordingLogs,
  type LoggedObject,
} from './observability-recording.ts';

// 選べる日とローンチの状態が実行の時刻で変わらないよう、時計を業務時刻の2026-11-10 12:00に固定する
export const PRODUCT_TEST_NOW = fromBusinessDateTime(
  parseBusinessDate('2026-11-10'),
  { hour: 12, minute: 0 },
);

let currentNow = PRODUCT_TEST_NOW;

const testClock: Clock = { now: () => currentNow };

export function setProductTestNow(now: Date): void {
  currentNow = now;
}

const fixedClockModule: AppModule<GatewayApp> = {
  name: 'product-graphql-test-clock',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(testClock);
  }),
};

let decisionSourcesFailing = false;

// 判定の供給元の失敗を再現する。次回の予約の禁止と固定の供給元を1つずつ登録し、この関数を呼んだテストの間だけ例外を投げさせる
export function failProductDecisionSources(): void {
  decisionSourcesFailing = true;
}

async function answerOrFail<T>(answer: T): Promise<T> {
  await Promise.resolve();
  if (decisionSourcesFailing) {
    throw new Error('判定の供給元に接続できません');
  }
  return answer;
}

const testRelaunchSource: RelaunchConditionSource = {
  findBlocks: () => answerOrFail([]),
};

const testLockSource: ProductLockSource = {
  findLocks: () => answerOrFail([]),
};

const decisionSourcesModule: AppModule<GatewayApp> = {
  name: 'product-graphql-test-decision-sources',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<readonly RegisteredDecisionSource<RelaunchConditionSource>[]>(
      PRODUCT_TYPES.RelaunchConditionSources,
    ).toConstantValue([
      { name: 'product-test.relaunch', source: testRelaunchSource },
    ]);
    rebind<readonly RegisteredDecisionSource<ProductLockSource>[]>(
      PRODUCT_TYPES.ProductLockSources,
    ).toConstantValue([{ name: 'product-test.lock', source: testLockSource }]);
  }),
};

type LaunchSummaryAnswer = Awaited<
  ReturnType<LaunchSummarySource['summarize']>
>;

const EMPTY_SUMMARY_ANSWER: LaunchSummaryAnswer = Object.freeze({
  launches: [],
  awards: [],
});

let summaryAnswer: LaunchSummaryAnswer | Error = EMPTY_SUMMARY_ANSWER;

// 結果の要約と受賞の供給元を1つ登録し、この関数を呼んだテストの間だけ指定した答えを返させる。Errorを渡すと例外を投げる
export function answerLaunchSummaries(
  answer: LaunchSummaryAnswer | Error,
): void {
  summaryAnswer = answer;
}

const testSummarySource: LaunchSummarySource = {
  summarize: async () => {
    await Promise.resolve();
    if (summaryAnswer instanceof Error) {
      throw summaryAnswer;
    }
    return summaryAnswer;
  },
};

const summarySourcesModule: AppModule<GatewayApp> = {
  name: 'product-graphql-test-summary-sources',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<readonly RegisteredDecisionSource<LaunchSummarySource>[]>(
      PRODUCT_TYPES.LaunchSummarySources,
    ).toConstantValue([
      { name: 'product-test.summary', source: testSummarySource },
    ]);
  }),
};

const productGateway = createGraphQLGateway({
  documents: [
    MY_PRODUCTS,
    MY_PRODUCT,
    NEW_PRODUCT_LAUNCH_WINDOW,
    PRODUCT_HANDLE_AVAILABILITY,
    PRODUCT_OWNER_STATUS,
    REGISTER_PRODUCT,
    UPDATE_PRODUCT,
    DELETE_PRODUCT,
    LAUNCH_HISTORY,
    PROFILE_AWARDS,
    PRODUCT_CATEGORIES,
    ADMIN_PRODUCT_CATEGORIES,
    CREATE_PRODUCT_CATEGORY,
    UPDATE_PRODUCT_CATEGORY,
    DELETE_PRODUCT_CATEGORY,
  ],
  schemaModules: [mediaSchemaModule, profileSchemaModule, productSchemaModule],
  overrides: [fixedClockModule, decisionSourcesModule, summarySourcesModule],
});

export interface ProductTestContext {
  readonly logs: () => readonly LoggedObject[];
}

// 各テストの前にプロダクト・利用者・ファイルのテーブルとログの記録を空にし、時計を固定の時刻へ戻す
export function installProductGraphQLTest(): ProductTestContext {
  let logs: LoggedObject[] = [];

  beforeAll(() => {
    logs = configureRecordingLogs();
  });

  beforeEach(async () => {
    currentNow = PRODUCT_TEST_NOW;
    decisionSourcesFailing = false;
    summaryAnswer = EMPTY_SUMMARY_ANSWER;
    await clearMediaTables();
    await clearProductTables();
    logs.splice(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    resetSync();
  });

  return { logs: () => logs };
}

// セッションの検証が固定の時計で行われるため、発行も同じ時刻で行う
export async function issueProductUserSession(
  userIndex: number,
): Promise<string> {
  const container = createInvocationContainer(
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
  const issued = await container
    .get<SessionIssuer>(IDENTITY_TYPES.SessionIssuer)
    .issue(userIdOf(userIndex), {
      clientIp: undefined,
      userAgent: undefined,
      now: currentNow,
    });
  return issued.token;
}

// 投稿者のプロダクトと、同じ番号のローンチ1件を作る。最新のローンチ日の列もローンチの日にそろえる
export async function insertOwnedProduct(
  index: number,
  owner: number,
  launch: {
    readonly launchDate: string;
    readonly outcome?: 'won' | 'lost';
    readonly cancelledAt?: Date;
  },
  columns: Parameters<typeof insertProduct>[2] = {},
): Promise<void> {
  await insertProduct(index, owner, {
    latestLaunchDate: launch.launchDate,
    ...columns,
  });
  await insertLaunch(index, index, {
    launchDate: launch.launchDate,
    ...(launch.outcome !== undefined && {
      outcome: launch.outcome,
      decidedAt: T0,
    }),
    ...(launch.cancelledAt !== undefined && {
      cancelledAt: launch.cancelledAt,
    }),
  });
}

export const kickoffOf = (date: string): string =>
  kickoffAt(parseBusinessDate(date)).toISOString();

export function codesOf(response: GatewayResponse): (string | undefined)[] {
  return (response.errors ?? []).map((error) => error.extensions?.code);
}

export function detailsOf(response: GatewayResponse) {
  return response.errors?.[0]?.extensions?.details ?? [];
}

export function fetchMyProducts(
  variables: { first: number; after?: string | null },
  options?: GatewayCallOptions,
) {
  return productGateway.call<{ myProducts: MyProductConnectionFields | null }>(
    MY_PRODUCTS,
    variables,
    options,
  );
}

export function fetchMyProduct(handle: string, options?: GatewayCallOptions) {
  return productGateway.call<{
    myProduct: MyProductFields | MyProductRedirectFields | null;
  }>(MY_PRODUCT, { handle }, options);
}

export function fetchNewProductLaunchWindow(options?: GatewayCallOptions) {
  return productGateway.call<{
    newProductLaunchWindow: LaunchDateWindowFields | null;
  }>(NEW_PRODUCT_LAUNCH_WINDOW, {}, options);
}

export function fetchProductHandleAvailability(
  variables: { handle: string; productHandle?: string | null },
  options?: GatewayCallOptions,
) {
  return productGateway.call<{
    productHandleAvailability: HandleAvailabilityValue | null;
  }>(PRODUCT_HANDLE_AVAILABILITY, variables, options);
}

export function fetchProductOwnerStatus(
  productHandle: string,
  options?: GatewayCallOptions,
) {
  return productGateway.call<{
    productOwnerStatus: ProductOwnerStatusFields | null;
  }>(PRODUCT_OWNER_STATUS, { productHandle }, options);
}

export interface ProductFieldsVariables {
  readonly name: string;
  readonly tagline: string;
  readonly categoryId: string;
  readonly handle: string;
  readonly websiteUrl: string;
  readonly description: string;
  readonly logoFileId: string;
  readonly screenshotFileIds: readonly string[];
}

export function registerProduct(
  input: {
    readonly fields: ProductFieldsVariables;
    readonly launchDate: string;
  },
  options?: GatewayCallOptions,
) {
  return productGateway.call<{ registerProduct: MyProductFields | null }>(
    REGISTER_PRODUCT,
    { input },
    options,
  );
}

export function updateProduct(
  input: {
    readonly productHandle: string;
    readonly expectedVersion: number;
    readonly fields: ProductFieldsVariables;
    readonly launchDate?: string | null;
  },
  options?: GatewayCallOptions,
) {
  return productGateway.call<{ updateProduct: MyProductFields | null }>(
    UPDATE_PRODUCT,
    { input },
    options,
  );
}

export function deleteProduct(
  variables: {
    readonly productHandle: string;
    readonly expectedVersion: number;
  },
  options?: GatewayCallOptions,
) {
  return productGateway.call<{ deleteProduct: boolean | null }>(
    DELETE_PRODUCT,
    variables,
    options,
  );
}

export async function suspendProductUser(userIndex: number): Promise<void> {
  await db
    .update(users)
    .set({ status: 'suspended', suspendedAt: T0 })
    .where(eq(users.id, userIdOf(userIndex)));
}

// フィクスチャのinsertProductが作るプロダクトの現在の項目
export function fixtureProductFields(
  index: number,
  overrides: Partial<ProductFieldsVariables> = {},
): ProductFieldsVariables {
  return {
    name: `プロダクト${String(index)}`,
    tagline: `タグライン${String(index)}`,
    categoryId: PRODUCT_CATEGORY_OTHER_ID,
    handle: `product${String(index)}`,
    websiteUrl: `https://product${String(index)}.example/`,
    description: `説明文${String(index)}`,
    logoFileId: logoFileIdOf(index),
    screenshotFileIds: [],
    ...overrides,
  };
}

export async function readProductRow(index: number) {
  const [row] = await db
    .select({
      name: products.name,
      version: products.version,
      deletedAt: products.deletedAt,
    })
    .from(products)
    .where(eq(products.id, productIdOf(index)));
  return row;
}

export async function countProducts(): Promise<number> {
  return (await db.select({ id: products.id }).from(products)).length;
}

export function fetchLaunchHistory(
  variables: {
    readonly userHandle: string;
    readonly first: number;
    readonly after?: string | null;
  },
  options?: GatewayCallOptions,
) {
  return productGateway.call<{
    launchHistory: LaunchHistoryConnectionFields | null;
  }>(LAUNCH_HISTORY, variables, options);
}

export function fetchProfileAwards(
  userHandle: string,
  options?: GatewayCallOptions,
) {
  return productGateway.call<{
    profileAwards: readonly ProductAwardFields[] | null;
  }>(PROFILE_AWARDS, { userHandle }, options);
}

export const PRODUCT_ADMINS = Object.freeze({
  superAdmin: 21,
  moderator: 22,
  viewer: 23,
});

const ROLES_OF_PRODUCT_ADMINS: readonly (readonly [number, AdminRole])[] = [
  [PRODUCT_ADMINS.superAdmin, 'super_admin'],
  [PRODUCT_ADMINS.moderator, 'moderator'],
  [PRODUCT_ADMINS.viewer, 'viewer'],
];

const adminSessionTokens = new Map<number, string>();

export function productAdminIdOf(adminIndex: number): string {
  return adminIdOf(adminIndex);
}

// 管理者側の呼び出し元から、指定した管理者のセッションで要求する
export function asProductAdmin(adminIndex: number): GatewayCallOptions {
  const sessionToken = adminSessionTokens.get(adminIndex);
  if (sessionToken === undefined) {
    throw new Error(`管理者${String(adminIndex)}のセッションがありません`);
  }
  return { caller: 'admin', sessionToken };
}

// プロダクトのテストの用意に加え、管理者と監査ログのテーブルを空にし、3つのロールの管理者とそのセッションを固定の時刻で用意する
export function installProductAdminGraphQLTest(): ProductTestContext {
  const context = installProductGraphQLTest();

  beforeEach(async () => {
    await clearAdminTables();
    adminSessionTokens.clear();
    for (const [index, role] of ROLES_OF_PRODUCT_ADMINS) {
      await insertAdmin(index, { role, nickname: `運営${String(index)}` });
      adminSessionTokens.set(
        index,
        (await issueAdminSession(adminIdOf(index), { now: currentNow })).token,
      );
    }
  });

  return context;
}

export function fetchProductCategories(options?: GatewayCallOptions) {
  return productGateway.call<{
    productCategories: ProductCategoryFields[] | null;
  }>(PRODUCT_CATEGORIES, {}, options);
}

export function fetchAdminProductCategories(options: GatewayCallOptions) {
  return productGateway.call<{
    adminProductCategories: ProductCategoryFields[] | null;
  }>(ADMIN_PRODUCT_CATEGORIES, {}, options);
}

export interface ProductCategoryInputVariables {
  readonly name: string;
  readonly handle: string;
}

export function createProductCategory(
  variables: {
    readonly input: ProductCategoryInputVariables;
    readonly reason?: string | null;
  },
  options: GatewayCallOptions,
) {
  return productGateway.call<{
    createProductCategory: ProductCategoryFields | null;
  }>(CREATE_PRODUCT_CATEGORY, { ...variables }, options);
}

export function updateProductCategory(
  variables: {
    readonly id: string;
    readonly input: ProductCategoryInputVariables;
    readonly reason?: string | null;
  },
  options: GatewayCallOptions,
) {
  return productGateway.call<{
    updateProductCategory: ProductCategoryFields | null;
  }>(UPDATE_PRODUCT_CATEGORY, { ...variables }, options);
}

export function deleteProductCategory(
  variables: { readonly id: string; readonly reason?: string | null },
  options: GatewayCallOptions,
) {
  return productGateway.call<{ deleteProductCategory: boolean | null }>(
    DELETE_PRODUCT_CATEGORY,
    { ...variables },
    options,
  );
}
