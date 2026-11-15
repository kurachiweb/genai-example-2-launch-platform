import { asc, eq, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { ServiceIdentifier } from 'inversify';

import { productLaunches } from '../../../../db/schema/product/product-launches.ts';
import { productPreviousHandles } from '../../../../db/schema/product/product-previous-handles.ts';
import { productScreenshots } from '../../../../db/schema/product/product-screenshots.ts';
import { products } from '../../../../db/schema/product/products.ts';
import { PRODUCT_CATEGORY_OTHER_ID } from '../../../../common-lib/product/product-category-constants.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
  type BusinessDate,
} from '../../../../lib/core/time/business-time.ts';
import { D1ProductDirectory } from '../../../../lib/workers/product/d1-product-directory.ts';
import {
  db,
  logoFileIdOf,
  productIdOf,
} from '../../../../lib/workers/product/testing/product-fixtures.ts';
import type {
  ProductFieldsInput,
  ProductInsertInput,
  ProductSaveInput,
} from '../../../application/product/ports.ts';
import type { ProductEditPlan } from '../../../domain/product/product-edit-plan.ts';
import { D1ProductStore } from '../d1-product-store.ts';
import {
  createProductSaveHooks,
  type ProductSaveHook,
  type ProductSaveHookRegistration,
} from '../product-save-hooks.ts';

export const TEST_HOOK_NAME = 'spec-test.product-mark';

export const HOOK_MARK = '[印]';

// 業務日付2026-11-10の正午。予定のローンチ(既定は2026-11-20)は固定の期間の外にある
export const NOW = businessAt('2026-11-10', 12, 0);

export function businessDate(value: string): BusinessDate {
  return parseBusinessDate(value);
}

export function businessAt(date: string, hour: number, minute: number): Date {
  return fromBusinessDateTime(parseBusinessDate(date), { hour, minute });
}

export function newIdOf(prefix: string, index: number): string {
  return `01JD0${prefix}${String(index).padStart(17, '0')}`;
}

export function fileIdOf(index: number): string {
  return newIdOf('FILE', index);
}

export interface HookCall {
  readonly phase: 'statements' | 'after-commit';
  readonly productId: string;
}

export interface HookBehavior {
  // 同時の文を返す処理の例外
  readonly statementsError?: Error;
  // 実行時に制約の違反を起こす文を返す
  readonly violating?: boolean;
  readonly afterCommitError?: Error;
}

// プロダクトの名称の末尾に印を足す文を返し、呼び出しを記録する偽の保存の処理
function markingHook(
  calls: HookCall[],
  behavior: HookBehavior,
): ProductSaveHook {
  return {
    statementsFor: (input, database) => {
      calls.push({ phase: 'statements', productId: input.productId });
      if (behavior.statementsError !== undefined) {
        return Promise.reject(behavior.statementsError);
      }
      const statements: BatchItem<'sqlite'>[] = [
        database
          .update(products)
          .set({
            name: sql`${products.name} || ${HOOK_MARK}`,
            updatedAt: sql`${products.updatedAt}`,
          })
          .where(eq(products.id, input.productId)),
      ];
      if (behavior.violating === true) {
        statements.push(
          database.run(
            sql`UPDATE ${products} SET ${sql.identifier(products.websiteUrl.name)} = NULL WHERE ${products.id} = ${input.productId}`,
          ),
        );
      }
      return Promise.resolve(statements);
    },
    afterCommit: (input) => {
      calls.push({ phase: 'after-commit', productId: input.productId });
      return behavior.afterCommitError === undefined
        ? Promise.resolve()
        : Promise.reject(behavior.afterCommitError);
    },
  };
}

const TEST_HOOK_IDENTIFIER: ServiceIdentifier<ProductSaveHook> = Symbol.for(
  'test.product-store.save-hook',
);

export function createTestStore(behavior: HookBehavior = {}): {
  readonly store: D1ProductStore;
  readonly calls: HookCall[];
} {
  const calls: HookCall[] = [];
  const hook = markingHook(calls, behavior);
  const registrations: ProductSaveHookRegistration[] = [
    { name: TEST_HOOK_NAME, hook: TEST_HOOK_IDENTIFIER },
  ];
  const hooks = createProductSaveHooks(
    registrations,
    <T>(identifier: ServiceIdentifier<T>) => {
      if (identifier !== TEST_HOOK_IDENTIFIER) {
        throw new Error('未登録の識別子です');
      }
      return hook as T;
    },
  );
  return {
    store: new D1ProductStore(db, hooks, new D1ProductDirectory(db)),
    calls,
  };
}

export function fieldsOf(
  index: number,
  overrides: Partial<ProductFieldsInput> = {},
): ProductFieldsInput {
  return {
    name: `プロダクト${String(index)}`,
    tagline: `タグライン${String(index)}`,
    categoryId: PRODUCT_CATEGORY_OTHER_ID,
    handle: `product${String(index)}`,
    websiteUrl: `https://product${String(index)}.example/`,
    descriptionMarkdown: `説明文${String(index)}`,
    logoFileId: logoFileIdOf(index),
    screenshotFileIds: [],
    ...overrides,
  };
}

export function planOf(
  overrides: Partial<ProductEditPlan> = {},
): ProductEditPlan {
  return {
    handle: { kind: 'none' },
    logo: { kind: 'keep' },
    screenshots: { added: [], removed: [], order: [] },
    categoryChanged: false,
    launch: { kind: 'none' },
    ...overrides,
  };
}

export function insertInputOf(
  index: number,
  ownerUserId: string,
  overrides: Partial<ProductInsertInput> = {},
): ProductInsertInput {
  const fields = overrides.fields ?? fieldsOf(index);
  return {
    productId: productIdOf(index),
    launchId: newIdOf('NLNC', index),
    ownerUserId,
    fields,
    launchDate: businessDate('2026-11-20'),
    screenshotIds: fields.screenshotFileIds.map((_, position) =>
      newIdOf('NSCR', index * 100 + position),
    ),
    now: NOW,
    ...overrides,
  };
}

export function saveInputOf(
  index: number,
  overrides: Partial<ProductSaveInput> = {},
): ProductSaveInput {
  const fields = overrides.fields ?? fieldsOf(index);
  return {
    productId: productIdOf(index),
    expectedVersion: 0,
    fields,
    plan: planOf(),
    previousHandleId: newIdOf('NPRV', index),
    newLaunchId: newIdOf('NLNC', index),
    screenshotIds: fields.screenshotFileIds.map((_, position) =>
      newIdOf('NSCR', index * 100 + position),
    ),
    now: NOW,
    ...overrides,
  };
}

export async function readProductRow(index: number) {
  const [row] = await db
    .select()
    .from(products)
    .where(eq(products.id, productIdOf(index)));
  return row;
}

export async function readScreenshotFileIds(index: number): Promise<string[]> {
  const rows = await db
    .select({ fileId: productScreenshots.fileId })
    .from(productScreenshots)
    .where(eq(productScreenshots.productId, productIdOf(index)))
    .orderBy(asc(productScreenshots.position));
  return rows.map((row) => row.fileId);
}

export async function readLaunchRows(index: number) {
  return db
    .select({
      id: productLaunches.id,
      launchDate: productLaunches.launchDate,
      outcome: productLaunches.outcome,
      cancelledAt: productLaunches.cancelledAt,
    })
    .from(productLaunches)
    .where(eq(productLaunches.productId, productIdOf(index)))
    .orderBy(asc(productLaunches.launchDate), asc(productLaunches.id));
}

export async function readPreviousHandles() {
  return db
    .select({
      ownerId: productPreviousHandles.ownerId,
      handle: productPreviousHandles.handle,
      deletedAt: productPreviousHandles.deletedAt,
    })
    .from(productPreviousHandles)
    .orderBy(asc(productPreviousHandles.ownerId));
}

// 取り消された書き込みでどの行も変わらないことを比べるため、プロダクトの全テーブルの行を読む
export async function readAllProductRows() {
  const [productRows, launchRows, screenshotRows, previousRows] =
    await Promise.all([
      db.select().from(products).orderBy(asc(products.id)),
      db.select().from(productLaunches).orderBy(asc(productLaunches.id)),
      db.select().from(productScreenshots).orderBy(asc(productScreenshots.id)),
      db
        .select()
        .from(productPreviousHandles)
        .orderBy(asc(productPreviousHandles.id)),
    ]);
  return { productRows, launchRows, screenshotRows, previousRows };
}
