import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { ContainerModule } from 'inversify';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

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
  ProductLockSource,
  RegisteredDecisionSource,
  RelaunchConditionSource,
} from '../../src/application/product/decision-sources.ts';
import { PRODUCT_TYPES } from '../../src/application/product/product-types.ts';
import { IDENTITY_TYPES } from '../../src/application/identity/identity-types.ts';
import type { SessionIssuer } from '../../src/application/identity/session-issuer.ts';
import { MODULES } from '../../src/composition/modules.ts';
import { mediaSchemaModule } from '../../src/presentation/graphql/modules/media/index.ts';
import { productSchemaModule } from '../../src/presentation/graphql/modules/product/index.ts';
import { profileSchemaModule } from '../../src/presentation/graphql/modules/profile/index.ts';
import {
  createGraphQLGateway,
  type GatewayApp,
  type GatewayCallOptions,
  type GatewayResponse,
} from './graphql-gateway.ts';
import {
  configureRecordingLogs,
  type LoggedObject,
} from './observability-recording.ts';

export interface MediaImageFields {
  readonly id: string;
  readonly objectKey: string | null;
}

export interface ProductCategoryFields {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
  readonly systemDefault: boolean;
}

export interface ProductLaunchFields {
  readonly id: string;
  readonly number: number;
  readonly launchDate: string;
  readonly kickoffAt: string;
  readonly status:
    'SCHEDULED' | 'PAIRED' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELED';
  readonly outcome: 'WON' | 'LOST' | null;
  readonly summary: { readonly label: string; readonly inMatch: boolean };
}

export interface LaunchDateWindowFields {
  readonly earliest: string;
  readonly latest: string;
  readonly unavailable: readonly {
    readonly from: string;
    readonly to: string;
    readonly reason: 'PAIRING_DEADLINE' | 'RELAUNCH_INTERVAL' | 'OUT_OF_RANGE';
  }[];
  readonly relaunchIntervalDays: number | null;
}

export interface ProductLaunchPlanFields {
  readonly mode: 'NEW' | 'RESCHEDULE' | 'BLOCKED' | 'UNKNOWN';
  readonly currentLaunchDate: string | null;
  readonly window: LaunchDateWindowFields | null;
  readonly blocks: readonly {
    readonly code: string;
    readonly message: string;
    readonly releaseAt: string | null;
  }[];
  readonly locked: boolean;
  readonly locks: readonly {
    readonly code: string;
    readonly message: string;
  }[];
  readonly lockUnknown: boolean;
  readonly ultrasEntitled: boolean;
}

export interface MyProductFields {
  readonly __typename: 'MyProduct';
  readonly handle: string;
  readonly previousHandle: string | null;
  readonly name: string;
  readonly tagline: string;
  readonly category: ProductCategoryFields;
  readonly websiteUrl: string;
  readonly description: string;
  readonly logoFileId: string;
  readonly logo: MediaImageFields | null;
  readonly screenshots: readonly {
    readonly fileId: string;
    readonly image: MediaImageFields | null;
  }[];
  readonly hidden: boolean;
  readonly listed: boolean;
  readonly version: number;
  readonly latestLaunch: ProductLaunchFields | null;
  readonly plan: ProductLaunchPlanFields;
}

export interface MyProductRedirectFields {
  readonly __typename: 'MyProductRedirect';
  readonly handle: string;
}

export interface MyProductConnectionFields {
  readonly nodes: readonly MyProductFields[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
}

export interface ProductOwnerStatusFields {
  readonly latestLaunch: ProductLaunchFields | null;
  readonly plan: ProductLaunchPlanFields;
}

export type HandleAvailabilityValue = 'AVAILABLE' | 'UNAVAILABLE' | 'INVALID';

const LAUNCH_FIELDS = /* GraphQL */ `
  id
  number
  launchDate
  kickoffAt
  status
  outcome
  summary {
    label
    inMatch
  }
`;

const WINDOW_FIELDS = /* GraphQL */ `
  earliest
  latest
  unavailable {
    from
    to
    reason
  }
  relaunchIntervalDays
`;

const PLAN_FIELDS = /* GraphQL */ `
  mode
  currentLaunchDate
  window {
    ${WINDOW_FIELDS}
  }
  blocks {
    code
    message
    releaseAt
  }
  locked
  locks {
    code
    message
  }
  lockUnknown
  ultrasEntitled
`;

const MY_PRODUCT_FIELDS = /* GraphQL */ `
  __typename
  handle
  previousHandle
  name
  tagline
  category {
    id
    name
    handle
    systemDefault
  }
  websiteUrl
  description
  logoFileId
  logo {
    id
    objectKey
  }
  screenshots {
    fileId
    image {
      id
      objectKey
    }
  }
  hidden
  listed
  version
  latestLaunch {
    ${LAUNCH_FIELDS}
  }
  plan {
    ${PLAN_FIELDS}
  }
`;

export const MY_PRODUCTS = /* GraphQL */ `
  query ClientMyProducts($first: Int!, $after: String) {
    myProducts(first: $first, after: $after) {
      nodes {
        ${MY_PRODUCT_FIELDS}
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const MY_PRODUCT = /* GraphQL */ `
  query ClientMyProduct($handle: String!) {
    myProduct(handle: $handle) {
      __typename
      ... on MyProduct {
        ${MY_PRODUCT_FIELDS}
      }
      ... on MyProductRedirect {
        handle
      }
    }
  }
`;

export const NEW_PRODUCT_LAUNCH_WINDOW = /* GraphQL */ `
  query ClientNewProductLaunchWindow {
    newProductLaunchWindow {
      ${WINDOW_FIELDS}
    }
  }
`;

export const PRODUCT_HANDLE_AVAILABILITY = /* GraphQL */ `
  query ClientProductHandleAvailability(
    $handle: String!
    $productHandle: String
  ) {
    productHandleAvailability(handle: $handle, productHandle: $productHandle)
  }
`;

export const PRODUCT_OWNER_STATUS = /* GraphQL */ `
  query ClientProductOwnerStatus($productHandle: String!) {
    productOwnerStatus(productHandle: $productHandle) {
      latestLaunch {
        ${LAUNCH_FIELDS}
      }
      plan {
        ${PLAN_FIELDS}
      }
    }
  }
`;

export const REGISTER_PRODUCT = /* GraphQL */ `
  mutation ClientRegisterProduct($input: RegisterProductInput!) {
    registerProduct(input: $input) {
      ${MY_PRODUCT_FIELDS}
    }
  }
`;

export const UPDATE_PRODUCT = /* GraphQL */ `
  mutation ClientUpdateProduct($input: UpdateProductInput!) {
    updateProduct(input: $input) {
      ${MY_PRODUCT_FIELDS}
    }
  }
`;

export const DELETE_PRODUCT = /* GraphQL */ `
  mutation ClientDeleteProduct(
    $productHandle: String!
    $expectedVersion: Int!
  ) {
    deleteProduct(
      productHandle: $productHandle
      expectedVersion: $expectedVersion
    )
  }
`;

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
  ],
  schemaModules: [mediaSchemaModule, profileSchemaModule, productSchemaModule],
  overrides: [fixedClockModule, decisionSourcesModule],
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
