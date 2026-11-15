import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { verifiedUsers } from '../../../db/schema/identity/visibility.ts';
import { productCategories } from '../../../db/schema/product/product-categories.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { productPreviousHandles } from '../../../db/schema/product/product-previous-handles.ts';
import { productScreenshots } from '../../../db/schema/product/product-screenshots.ts';
import { products } from '../../../db/schema/product/products.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import { qualifierLockThresholdDate } from '../../../lib/core/product/launch-status.ts';
import type { ProductDirectory } from '../../../lib/core/product/ports.ts';
import { isHandleOccupied } from '../../../lib/workers/handles/handle-queries.ts';
import {
  previousHandleRelease,
  previousHandleUpsert,
} from '../../../lib/workers/handles/previous-handle-statements.ts';
import { PRODUCT_HANDLE_NAMESPACE } from '../../../lib/workers/product/product-handle-namespaces.ts';
import type {
  ProductDescriptionUpdateInput,
  ProductDescriptionUpdateResult,
  ProductInsertInput,
  ProductListPosition,
  ProductSaveInput,
  ProductSaveResult,
  ProductSnapshot,
  ProductStore,
} from '../../application/product/ports.ts';
import { PRODUCT_TYPES } from '../../application/product/product-types.ts';
import { PRODUCT_SAVE_GUARDS as guards } from './product-save-guards.ts';
import type { ProductSaveHooks } from './product-save-hooks.ts';

// 1行が6個のバインド変数を使うため、上限(100)に収まる行数ずつ追加する
const SCREENSHOT_ROWS_PER_STATEMENT = 10;

const SCREENSHOT_COUNT_MISMATCH =
  'スクリーンショットの行のIDは画像と同じ件数で指定してください';

// 保存の取り消しが起こす違反だけを分類の対象にする。取り消しは、先頭のproductsの文のNOT NULL制約(条件の不成立)か、ハンドル・旧ハンドル・終了していないローンチの一意制約(同時の保存)で起こる。
// D1は`D1_ERROR: NOT NULL constraint failed: products.user_id: SQLITE_CONSTRAINT (...)`を投げ、causeにSQLiteのエラーを持つ
const ABORT_VIOLATION_PATTERN =
  /(?:NOT NULL constraint failed: products\.user_id|UNIQUE constraint failed: (?:products\.handle|product_previous_handles\.(?:handle|product_id)|product_launches\.product_id))(?::|$)/u;

const OPEN_LAUNCH_VIOLATION_PATTERN =
  /UNIQUE constraint failed: product_launches\.product_id(?::|$)/u;

function violationMatches(error: unknown, pattern: RegExp): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (pattern.test(current.message)) {
      return true;
    }
  }
  return false;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function pairScreenshots(
  fileIds: readonly string[],
  rowIds: readonly string[],
): { readonly id: string; readonly fileId: string }[] {
  if (fileIds.length !== rowIds.length) {
    throw new RangeError(SCREENSHOT_COUNT_MISMATCH);
  }
  return rowIds.map((id, position) => {
    const fileId = fileIds[position];
    if (fileId === undefined) {
      throw new RangeError(SCREENSHOT_COUNT_MISMATCH);
    }
    return { id, fileId };
  });
}

function isTrue(value: unknown): boolean {
  return Number(value) === 1;
}

const SNAPSHOT_COLUMNS = {
  productId: products.id,
  ownerUserId: products.userId,
  handle: products.handle,
  name: products.name,
  tagline: products.tagline,
  websiteUrl: products.websiteUrl,
  descriptionMarkdown: products.descriptionMarkdown,
  logoFileId: products.logoFileId,
  hiddenAt: products.hiddenAt,
  version: products.version,
  categoryId: productCategories.id,
  categoryName: productCategories.name,
  categoryHandle: productCategories.handle,
  categorySystemDefault: productCategories.systemDefault,
  categoryCreatedAt: productCategories.createdAt,
};

interface SnapshotRow {
  readonly productId: string;
  readonly ownerUserId: string;
  readonly handle: string;
  readonly name: string;
  readonly tagline: string;
  readonly websiteUrl: string;
  readonly descriptionMarkdown: string;
  readonly logoFileId: string;
  readonly hiddenAt: Date | null;
  readonly version: number;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly categoryHandle: string;
  readonly categorySystemDefault: boolean;
  readonly categoryCreatedAt: Date;
}

function positionCondition(
  before: ProductListPosition | undefined,
): SQL | undefined {
  if (before === undefined) {
    return undefined;
  }
  return or(
    lt(products.latestLaunchDate, before.latestLaunchDate),
    and(
      eq(products.latestLaunchDate, before.latestLaunchDate),
      lt(products.id, before.id),
    ),
  );
}

@injectable()
export class D1ProductStore implements ProductStore {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(PRODUCT_TYPES.ProductSaveHooks)
    private readonly saveHooks: ProductSaveHooks,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly directory: ProductDirectory,
  ) {}

  async findForOwner(
    ownerUserId: string,
    handle: string,
    now: Date,
  ): Promise<ProductSnapshot | undefined> {
    const rows = await this.selectSnapshotRows()
      .where(
        and(
          eq(products.userId, ownerUserId),
          eq(products.handle, handle),
          guards.notDeleted(),
        ),
      )
      .limit(1);
    const [snapshot] = await this.toSnapshots(rows, now);
    return snapshot;
  }

  async resolveOwnPreviousHandle(
    ownerUserId: string,
    handle: string,
  ): Promise<string | undefined> {
    const [row] = await this.db
      .select({ handle: products.handle })
      .from(productPreviousHandles)
      .innerJoin(products, eq(products.id, productPreviousHandles.ownerId))
      .where(
        and(
          eq(productPreviousHandles.handle, handle),
          isNull(productPreviousHandles.deletedAt),
          eq(products.userId, ownerUserId),
          guards.notDeleted(),
        ),
      )
      .limit(1);
    return row?.handle;
  }

  async listForOwner(input: {
    readonly ownerUserId: string;
    readonly limit: number;
    readonly before: ProductListPosition | undefined;
    readonly now: Date;
  }): Promise<readonly ProductSnapshot[]> {
    const rows = await this.selectSnapshotRows()
      .where(
        and(
          eq(products.userId, input.ownerUserId),
          guards.notDeleted(),
          positionCondition(input.before),
        ),
      )
      .orderBy(desc(products.latestLaunchDate), desc(products.id))
      .limit(input.limit);
    return this.toSnapshots(rows, input.now);
  }

  isHandleOccupied(handle: string, exceptProductId?: string): Promise<boolean> {
    return isHandleOccupied(
      this.db,
      PRODUCT_HANDLE_NAMESPACE,
      handle,
      exceptProductId === undefined ? {} : { exceptOwnerId: exceptProductId },
    );
  }

  async categoryExists(categoryId: string): Promise<boolean> {
    const rows = await this.db
      .select({ one: sql<number>`1` })
      .from(productCategories)
      .where(eq(productCategories.id, categoryId))
      .limit(1);
    return rows.length > 0;
  }

  async insert(
    input: ProductInsertInput,
  ): Promise<'saved' | 'handle-unavailable' | 'account-unavailable'> {
    const screenshots = pairScreenshots(
      input.fields.screenshotFileIds,
      input.screenshotIds,
    );
    const { productId, now } = input;
    const hookStatements = await this.saveHooks.statementsFor(
      { productId, at: now },
      this.db,
    );
    try {
      await this.db.batch([
        this.guardedProductInsert(input),
        previousHandleRelease(this.db, PRODUCT_HANDLE_NAMESPACE, {
          handle: input.fields.handle,
          exceptOwnerId: productId,
        }),
        this.db.insert(productLaunches).values({
          id: input.launchId,
          productId,
          launchDate: input.launchDate,
          createdAt: now,
          updatedAt: now,
        }),
        ...this.screenshotInserts(productId, screenshots, now),
        ...hookStatements,
      ]);
    } catch (error) {
      if (!violationMatches(error, ABORT_VIOLATION_PATTERN)) {
        throw error;
      }
      return this.classifyInsertAbort(input.ownerUserId);
    }
    await this.saveHooks.runAfterCommit({ productId });
    return 'saved';
  }

  async save(input: ProductSaveInput): Promise<ProductSaveResult> {
    const screenshots = pairScreenshots(
      input.fields.screenshotFileIds,
      input.screenshotIds,
    );
    const { productId, now } = input;
    const hookStatements = await this.saveHooks.statementsFor(
      { productId, at: now },
      this.db,
    );
    let changes: number;
    try {
      const [productUpdate] = await this.db.batch([
        this.guardedProductUpdate(input),
        ...this.handleStatements(input),
        this.db
          .delete(productScreenshots)
          .where(eq(productScreenshots.productId, productId)),
        ...this.screenshotInserts(productId, screenshots, now),
        ...this.launchStatements(input),
        ...hookStatements,
      ]);
      changes = productUpdate.meta.changes;
    } catch (error) {
      if (!violationMatches(error, ABORT_VIOLATION_PATTERN)) {
        throw error;
      }
      return this.classifySaveAbort(input, error);
    }
    if (changes === 0) {
      return this.classifySaveAbort(input, undefined);
    }
    await this.saveHooks.runAfterCommit({ productId });
    return 'saved';
  }

  async updateDescription(
    input: ProductDescriptionUpdateInput,
  ): Promise<ProductDescriptionUpdateResult> {
    const { productId, now } = input;
    const hookStatements = await this.saveHooks.statementsFor(
      { productId, at: now },
      this.db,
    );
    const guard = and(
      guards.notDeleted(),
      guards.ownerWritable(products.userId),
      guards.notHidden(),
    );
    let changes: number;
    try {
      const [productUpdate] = await this.db.batch([
        this.db
          .update(products)
          .set({
            userId: sql`CASE WHEN ${guard} THEN ${products.userId} ELSE NULL END`,
            descriptionMarkdown: input.descriptionMarkdown,
            version: sql`${products.version} + 1`,
            updatedAt: now,
          })
          .where(eq(products.id, productId)),
        ...hookStatements,
      ]);
      changes = productUpdate.meta.changes;
    } catch (error) {
      if (!violationMatches(error, ABORT_VIOLATION_PATTERN)) {
        throw error;
      }
      const reason = await this.descriptionAbortReason(productId);
      if (reason === undefined) {
        throw error;
      }
      return reason;
    }
    if (changes === 0) {
      return (await this.descriptionAbortReason(productId)) ?? 'not-found';
    }
    await this.saveHooks.runAfterCommit({ productId });
    return 'saved';
  }

  private selectSnapshotRows() {
    return this.db
      .select(SNAPSHOT_COLUMNS)
      .from(products)
      .innerJoin(
        productCategories,
        eq(productCategories.id, products.categoryId),
      )
      .$dynamic();
  }

  private async toSnapshots(
    rows: readonly SnapshotRow[],
    now: Date,
  ): Promise<ProductSnapshot[]> {
    if (rows.length === 0) {
      return [];
    }
    const ids = rows.map((row) => row.productId);
    const [screenshotRows, previousRows, launches] = await Promise.all([
      this.db
        .select({
          productId: productScreenshots.productId,
          fileId: productScreenshots.fileId,
        })
        .from(productScreenshots)
        .where(inArray(productScreenshots.productId, ids))
        .orderBy(asc(productScreenshots.position)),
      this.db
        .select({
          productId: productPreviousHandles.ownerId,
          handle: productPreviousHandles.handle,
        })
        .from(productPreviousHandles)
        .where(
          and(
            inArray(productPreviousHandles.ownerId, ids),
            isNull(productPreviousHandles.deletedAt),
          ),
        ),
      this.directory.listLaunches(ids, now),
    ]);
    const screenshotsByProduct = Map.groupBy(
      screenshotRows,
      (row) => row.productId,
    );
    const previousByProduct = new Map(
      previousRows.map((row) => [row.productId, row.handle]),
    );
    return rows.map((row) => ({
      productId: row.productId,
      ownerUserId: row.ownerUserId,
      handle: row.handle,
      previousHandle: previousByProduct.get(row.productId) ?? null,
      name: row.name,
      tagline: row.tagline,
      category: {
        id: row.categoryId,
        name: row.categoryName,
        handle: row.categoryHandle,
        systemDefault: row.categorySystemDefault,
        createdAt: row.categoryCreatedAt,
      },
      websiteUrl: row.websiteUrl,
      descriptionMarkdown: row.descriptionMarkdown,
      logoFileId: row.logoFileId,
      screenshotFileIds: (screenshotsByProduct.get(row.productId) ?? []).map(
        (screenshot) => screenshot.fileId,
      ),
      hidden: row.hiddenAt !== null,
      version: row.version,
      launches: launches.get(row.productId) ?? [],
    }));
  }

  // 一括の書き込みの中では前の文の結果で後の文を分けられないため、先頭の文で投稿者の状態とハンドルを条件にする。
  // 満たさなければ投稿者のIDがNULLになり、NOT NULL制約の違反で後続の文を含む全体が取り消される
  private guardedProductInsert(input: ProductInsertInput) {
    const { fields, ownerUserId, now } = input;
    const guard = and(
      guards.ownerVerified(ownerUserId),
      guards.handleFree(fields.handle),
    );
    return this.db.insert(products).values({
      id: input.productId,
      userId: sql`CASE WHEN ${guard} THEN ${ownerUserId} ELSE NULL END`,
      categoryId: fields.categoryId,
      handle: fields.handle,
      name: fields.name,
      tagline: fields.tagline,
      websiteUrl: fields.websiteUrl,
      descriptionMarkdown: fields.descriptionMarkdown,
      logoFileId: fields.logoFileId,
      latestLaunchDate: input.launchDate,
      createdAt: now,
      updatedAt: now,
    });
  }

  private guardedProductUpdate(input: ProductSaveInput) {
    const { fields, plan, productId, now } = input;
    const lockApplies = plan.launch.kind !== 'none' || plan.categoryChanged;
    const guard = and(
      guards.versionMatches(input.expectedVersion),
      guards.notDeleted(),
      guards.ownerWritable(products.userId),
      plan.handle.kind === 'changed'
        ? guards.handleFree(plan.handle.next, productId)
        : undefined,
      lockApplies
        ? guards.qualifierUnlocked(qualifierLockThresholdDate(now))
        : undefined,
      plan.launch.kind === 'reserve' ? guards.notHidden() : undefined,
      plan.launch.kind === 'reschedule'
        ? guards.launchOpen(plan.launch.launchId)
        : undefined,
    );
    return this.db
      .update(products)
      .set({
        userId: sql`CASE WHEN ${guard} THEN ${products.userId} ELSE NULL END`,
        categoryId: fields.categoryId,
        handle: fields.handle,
        name: fields.name,
        tagline: fields.tagline,
        websiteUrl: fields.websiteUrl,
        descriptionMarkdown: fields.descriptionMarkdown,
        logoFileId: fields.logoFileId,
        version: sql`${products.version} + 1`,
        updatedAt: now,
      })
      .where(eq(products.id, productId));
  }

  // 他のプロダクトの旧ハンドルの解放を、自分の変更前のハンドルの置き換えより前に置く
  private handleStatements(input: ProductSaveInput): BatchItem<'sqlite'>[] {
    const { handle } = input.plan;
    if (handle.kind !== 'changed') {
      return [];
    }
    return [
      previousHandleRelease(this.db, PRODUCT_HANDLE_NAMESPACE, {
        handle: handle.next,
        exceptOwnerId: input.productId,
      }),
      previousHandleUpsert(this.db, PRODUCT_HANDLE_NAMESPACE, {
        id: input.previousHandleId,
        ownerId: input.productId,
        handle: handle.previous,
        now: input.now,
      }),
    ];
  }

  private screenshotInserts(
    productId: string,
    screenshots: readonly { readonly id: string; readonly fileId: string }[],
    now: Date,
  ): BatchItem<'sqlite'>[] {
    const rows = screenshots.map(({ id, fileId }, position) => ({
      id,
      productId,
      position,
      fileId,
      createdAt: now,
      updatedAt: now,
    }));
    return chunk(rows, SCREENSHOT_ROWS_PER_STATEMENT).map((part) =>
      this.db.insert(productScreenshots).values(part),
    );
  }

  // 取消のローンチが新しい予約より後の日のこともあるため、最新のローンチ日は取消を含む全ローンチから求める
  private launchStatements(input: ProductSaveInput): BatchItem<'sqlite'>[] {
    const { launch } = input.plan;
    const { productId, now } = input;
    if (launch.kind === 'none') {
      return [];
    }
    const launchStatement =
      launch.kind === 'reserve'
        ? this.db.insert(productLaunches).values({
            id: input.newLaunchId,
            productId,
            launchDate: launch.date,
            createdAt: now,
            updatedAt: now,
          })
        : this.db
            .update(productLaunches)
            .set({ launchDate: launch.date, updatedAt: now })
            .where(
              and(
                eq(productLaunches.id, launch.launchId),
                eq(productLaunches.productId, productId),
                isNull(productLaunches.outcome),
                isNull(productLaunches.cancelledAt),
              ),
            );
    return [
      launchStatement,
      this.db
        .update(products)
        .set({
          latestLaunchDate: sql`(SELECT MAX(${productLaunches.launchDate}) FROM ${productLaunches} WHERE ${eq(productLaunches.productId, productId)})`,
        })
        .where(eq(products.id, productId)),
    ];
  }

  // 取り消された一括の書き込みは何も残さないため、読み直した状態で理由を分ける
  private async classifyInsertAbort(
    ownerUserId: string,
  ): Promise<'handle-unavailable' | 'account-unavailable'> {
    const [row] = await this.db
      .select({ verified: sql<boolean>`${verifiedUsers()}`.mapWith(isTrue) })
      .from(users)
      .where(eq(users.id, ownerUserId));
    return row?.verified === true
      ? 'handle-unavailable'
      : 'account-unavailable';
  }

  private async classifySaveAbort(
    input: ProductSaveInput,
    error: unknown,
  ): Promise<Exclude<ProductSaveResult, 'saved'>> {
    const { plan } = input;
    const [row] = await this.db
      .select({
        deletedAt: products.deletedAt,
        hiddenAt: products.hiddenAt,
        version: products.version,
        ownerWritable:
          sql<boolean>`${guards.ownerWritable(products.userId)}`.mapWith(
            isTrue,
          ),
        unlocked:
          sql<boolean>`${guards.qualifierUnlocked(qualifierLockThresholdDate(input.now))}`.mapWith(
            isTrue,
          ),
        launchOpen: sql<boolean>`${
          plan.launch.kind === 'reschedule'
            ? guards.launchOpen(plan.launch.launchId)
            : sql`1`
        }`.mapWith(isTrue),
      })
      .from(products)
      .where(eq(products.id, input.productId));
    if (row === undefined || row.deletedAt !== null) {
      return 'not-found';
    }
    if (!row.ownerWritable) {
      return 'account-unavailable';
    }
    if (row.version !== input.expectedVersion) {
      return 'conflict';
    }
    if (
      (plan.launch.kind !== 'none' || plan.categoryChanged) &&
      !row.unlocked
    ) {
      return 'locked';
    }
    if (plan.launch.kind === 'reserve' && row.hiddenAt !== null) {
      return 'hidden';
    }
    if (!row.launchOpen) {
      return 'conflict';
    }
    return violationMatches(error, OPEN_LAUNCH_VIOLATION_PATTERN)
      ? 'conflict'
      : 'handle-unavailable';
  }

  // 条件の不成立の後に状態が戻った場合は理由を分けられないためundefinedを返す
  private async descriptionAbortReason(
    productId: string,
  ): Promise<Exclude<ProductDescriptionUpdateResult, 'saved'> | undefined> {
    const [row] = await this.db
      .select({
        deletedAt: products.deletedAt,
        hiddenAt: products.hiddenAt,
        ownerWritable:
          sql<boolean>`${guards.ownerWritable(products.userId)}`.mapWith(
            isTrue,
          ),
      })
      .from(products)
      .where(eq(products.id, productId));
    if (row === undefined || row.deletedAt !== null) {
      return 'not-found';
    }
    if (!row.ownerWritable) {
      return 'account-unavailable';
    }
    return row.hiddenAt === null ? undefined : 'hidden';
  }
}
