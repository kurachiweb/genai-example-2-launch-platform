import { asc, eq, ne } from 'drizzle-orm';

import { productCategories } from '../../../../db/schema/product/product-categories.ts';
import { productLaunches } from '../../../../db/schema/product/product-launches.ts';
import { productLifecycleEvents } from '../../../../db/schema/product/product-lifecycle-events.ts';
import { productLifecycleHandlerRuns } from '../../../../db/schema/product/product-lifecycle-handler-runs.ts';
import { productPreviousHandles } from '../../../../db/schema/product/product-previous-handles.ts';
import { productScreenshots } from '../../../../db/schema/product/product-screenshots.ts';
import { products } from '../../../../db/schema/product/products.ts';
import { PRODUCT_CATEGORY_OTHER_ID } from '../../../../common-lib/product/product-category-constants.ts';
import type { IdGenerator } from '../../../core/ids/id-generator.ts';
import {
  after,
  clearIdentityTables,
  db,
  insertUser,
  insertUsers,
  T0,
  userIdOf,
} from '../../identity/testing/identity-store-fixtures.ts';

export { after, db, insertUser, insertUsers, T0, userIdOf };

// 1行が15個前後のバインド変数を使うため、上限(100)に収まる行数ずつ追加する
const ROWS_PER_INSERT = 5;

type ProductRow = typeof products.$inferInsert;
type CategoryRow = typeof productCategories.$inferInsert;
type LaunchRow = typeof productLaunches.$inferInsert;
type LifecycleEventRow = typeof productLifecycleEvents.$inferInsert;

export function productEventIdOf(index: number): string {
  return `01JD0PEVT${String(index).padStart(17, '0')}`;
}

// 検証で作った行の識別子を予測できるよう、指定した番号から順に識別子を作る
export function createSequentialProductEventIds(start = 1000): IdGenerator {
  let next = start;
  return {
    generate: () => {
      const id = productEventIdOf(next);
      next += 1;
      return id;
    },
  };
}

export function productIdOf(index: number): string {
  return `01JD0PROD${String(index).padStart(17, '0')}`;
}

export function categoryIdOf(index: number): string {
  return `01JD0CATG${String(index).padStart(17, '0')}`;
}

export function launchIdOf(index: number): string {
  return `01JD0LNCH${String(index).padStart(17, '0')}`;
}

export function screenshotIdOf(index: number): string {
  return `01JD0SCRN${String(index).padStart(17, '0')}`;
}

export function previousHandleIdOf(index: number): string {
  return `01JD0PRVH${String(index).padStart(17, '0')}`;
}

export function logoFileIdOf(index: number): string {
  return `01JD0LOGO${String(index).padStart(17, '0')}`;
}

function productRowOf(
  index: number,
  ownerIndex: number,
  columns: Partial<ProductRow>,
): ProductRow {
  return {
    id: productIdOf(index),
    userId: userIdOf(ownerIndex),
    categoryId: PRODUCT_CATEGORY_OTHER_ID,
    handle: `product${String(index)}`,
    name: `プロダクト${String(index)}`,
    tagline: `タグライン${String(index)}`,
    websiteUrl: `https://product${String(index)}.example/`,
    descriptionMarkdown: `説明文${String(index)}`,
    logoFileId: logoFileIdOf(index),
    latestLaunchDate: '2026-11-20',
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  };
}

export async function insertProduct(
  index: number,
  ownerIndex: number,
  columns: Partial<ProductRow> = {},
): Promise<void> {
  await db.insert(products).values(productRowOf(index, ownerIndex, columns));
}

export async function insertProducts(
  indexes: readonly number[],
  ownerIndex: number,
  columns: Partial<ProductRow> = {},
): Promise<void> {
  const rows = indexes.map((index) => productRowOf(index, ownerIndex, columns));
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    await db
      .insert(products)
      .values(rows.slice(start, start + ROWS_PER_INSERT));
  }
}

export async function insertCategory(
  index: number,
  columns: Partial<CategoryRow> = {},
): Promise<void> {
  await db.insert(productCategories).values({
    id: categoryIdOf(index),
    name: `カテゴリ${String(index)}`,
    handle: `category${String(index)}`,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  });
}

function launchRowOf(
  index: number,
  productIndex: number,
  columns: Partial<LaunchRow>,
): LaunchRow {
  return {
    id: launchIdOf(index),
    productId: productIdOf(productIndex),
    launchDate: '2026-11-20',
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  };
}

export async function insertLaunch(
  index: number,
  productIndex: number,
  columns: Partial<LaunchRow> = {},
): Promise<void> {
  await db
    .insert(productLaunches)
    .values(launchRowOf(index, productIndex, columns));
}

export async function insertLaunches(
  entries: readonly {
    readonly index: number;
    readonly productIndex: number;
    readonly columns?: Partial<LaunchRow>;
  }[],
): Promise<void> {
  const rows = entries.map(({ index, productIndex, columns = {} }) =>
    launchRowOf(index, productIndex, columns),
  );
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    await db
      .insert(productLaunches)
      .values(rows.slice(start, start + ROWS_PER_INSERT));
  }
}

export async function insertScreenshot(
  index: number,
  productIndex: number,
  position: number,
  fileId: string,
): Promise<void> {
  await db.insert(productScreenshots).values({
    id: screenshotIdOf(index),
    productId: productIdOf(productIndex),
    position,
    fileId,
    createdAt: T0,
    updatedAt: T0,
  });
}

export async function insertProductPreviousHandle(
  index: number,
  productIndex: number,
  handle: string,
  columns: { readonly deletedAt?: Date | null } = {},
): Promise<void> {
  await db.insert(productPreviousHandles).values({
    id: previousHandleIdOf(index),
    ownerId: productIdOf(productIndex),
    handle,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: columns.deletedAt ?? null,
  });
}

function lifecycleEventRowOf(
  index: number,
  productIndex: number,
  columns: Partial<LifecycleEventRow>,
): LifecycleEventRow {
  return {
    id: productEventIdOf(index),
    productId: productIdOf(productIndex),
    ownerUserId: userIdOf(1),
    type: 'deleted',
    occurredAt: T0,
    lastDispatchedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  };
}

export async function insertProductEvent(
  index: number,
  productIndex: number,
  columns: Partial<LifecycleEventRow> = {},
): Promise<void> {
  await db
    .insert(productLifecycleEvents)
    .values(lifecycleEventRowOf(index, productIndex, columns));
}

export async function insertProductEvents(
  indexes: readonly number[],
  productIndex: number,
  columns: Partial<LifecycleEventRow> = {},
): Promise<void> {
  const rows = indexes.map((index) =>
    lifecycleEventRowOf(index, productIndex, columns),
  );
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    await db
      .insert(productLifecycleEvents)
      .values(rows.slice(start, start + ROWS_PER_INSERT));
  }
}

export async function readProductEvent(index: number) {
  const [row] = await db
    .select()
    .from(productLifecycleEvents)
    .where(eq(productLifecycleEvents.id, productEventIdOf(index)));
  return row;
}

export async function readProductEventsOf(productIndex: number) {
  return db
    .select()
    .from(productLifecycleEvents)
    .where(eq(productLifecycleEvents.productId, productIdOf(productIndex)))
    .orderBy(asc(productLifecycleEvents.id));
}

export async function readProductHandlerRuns() {
  return db
    .select({
      id: productLifecycleHandlerRuns.id,
      eventId: productLifecycleHandlerRuns.eventId,
      handlerName: productLifecycleHandlerRuns.handlerName,
      completedAt: productLifecycleHandlerRuns.completedAt,
    })
    .from(productLifecycleHandlerRuns)
    .orderBy(
      asc(productLifecycleHandlerRuns.eventId),
      asc(productLifecycleHandlerRuns.handlerName),
    );
}

// 初期データの標準カテゴリは残し、外部キーの参照元から先に消す
export async function clearProductTables(): Promise<void> {
  await db.delete(productLifecycleHandlerRuns);
  await db.delete(productLifecycleEvents);
  await db.delete(productLaunches);
  await db.delete(productScreenshots);
  await db.delete(productPreviousHandles);
  await db.delete(products);
  await db
    .delete(productCategories)
    .where(ne(productCategories.id, PRODUCT_CATEGORY_OTHER_ID));
  await clearIdentityTables();
}
