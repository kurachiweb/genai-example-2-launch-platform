import { and, asc, eq, type SQL, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { productCategories } from '../../../db/schema/product/product-categories.ts';
import { products } from '../../../db/schema/product/products.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { ProductCategoryRecord } from '../../../lib/core/product/ports.ts';
import type {
  ProductCategoryDeleteResult,
  ProductCategoryInsertResult,
  ProductCategoryStore,
  ProductCategoryUpdateResult,
  ProductCategoryWriteInput,
} from '../../application/product/ports.ts';
import {
  buildAuditLogStatements,
  isAuditGuardRejection,
} from '../admin/audit-log-statements.ts';

const CATEGORY_RECORD_COLUMNS = {
  id: productCategories.id,
  name: productCategories.name,
  handle: productCategories.handle,
  systemDefault: productCategories.systemDefault,
  createdAt: productCategories.createdAt,
};

const UNIQUE_VIOLATION_PATTERN = /UNIQUE constraint failed: ([^:]+)/u;

const TAKEN_OF_COLUMN: Readonly<Record<string, 'name-taken' | 'handle-taken'>> =
  Object.freeze({
    'product_categories.name': 'name-taken',
    'product_categories.handle': 'handle-taken',
  });

// 一括の書き込みの失敗はD1のエラーがcauseにSQLiteのエラーを持つため、原因をたどって違反した一意索引の列を調べる
function takenOf(error: unknown): 'name-taken' | 'handle-taken' | undefined {
  for (let current = error; current instanceof Error; current = current.cause) {
    const columns = UNIQUE_VIOLATION_PATTERN.exec(current.message)?.[1];
    if (columns !== undefined) {
      return columns
        .split(',')
        .map((column) => TAKEN_OF_COLUMN[column.trim()])
        .find((taken) => taken !== undefined);
    }
  }
  return undefined;
}

const editableCategory = (id: string): SQL | undefined =>
  and(eq(productCategories.id, id), eq(productCategories.systemDefault, false));

// 論理削除後に物理削除されていないプロダクトも外部キーでカテゴリを参照するため、deleted_atで絞らずに数える
const linkedProductExists = (id: string): SQL =>
  sql`EXISTS (SELECT 1 FROM ${products} WHERE ${products.categoryId} = ${id})`;

// 監査ログの条件は書き込みの時点で評価され、偽なら続く変更・削除も含めて取り消される
const editableCategoryExists = (id: string): SQL =>
  sql`EXISTS (SELECT 1 FROM ${productCategories} WHERE ${editableCategory(id)})`;

const deletableCategoryExists = (id: string): SQL =>
  sql`(${editableCategoryExists(id)} AND NOT ${linkedProductExists(id)})`;

@injectable()
export class D1ProductCategoryStore implements ProductCategoryStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async list(): Promise<readonly ProductCategoryRecord[]> {
    return this.db
      .select(CATEGORY_RECORD_COLUMNS)
      .from(productCategories)
      .orderBy(
        asc(productCategories.systemDefault),
        asc(productCategories.createdAt),
        asc(productCategories.id),
      );
  }

  async findById(id: string): Promise<ProductCategoryRecord | undefined> {
    const [row] = await this.db
      .select(CATEGORY_RECORD_COLUMNS)
      .from(productCategories)
      .where(eq(productCategories.id, id));
    return row;
  }

  async insert(
    input: ProductCategoryWriteInput,
    audit: PreparedAuditEntry,
  ): Promise<ProductCategoryInsertResult> {
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, audit),
        this.db.insert(productCategories).values({
          id: input.id,
          name: input.name,
          handle: input.handle,
          createdAt: input.at,
          updatedAt: input.at,
        }),
      ]);
      return 'created';
    } catch (error) {
      const taken = takenOf(error);
      if (taken !== undefined) {
        return taken;
      }
      throw error;
    }
  }

  async update(
    input: ProductCategoryWriteInput,
    audit: PreparedAuditEntry,
  ): Promise<ProductCategoryUpdateResult> {
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, audit, {
          kind: 'condition',
          condition: editableCategoryExists(input.id),
        }),
        this.db
          .update(productCategories)
          .set({ name: input.name, handle: input.handle, updatedAt: input.at })
          .where(editableCategory(input.id)),
      ]);
      return 'updated';
    } catch (error) {
      const taken = takenOf(error);
      if (taken !== undefined) {
        return taken;
      }
      if (!isAuditGuardRejection(error)) {
        throw error;
      }
      const state = await this.#stateOf(input.id);
      // 標準かどうかは変わらないため、変更できるカテゴリでの取り消しは条件の誤りとして投げ直す
      if (state === 'editable') {
        throw error;
      }
      return state;
    }
  }

  async delete(
    id: string,
    audit: PreparedAuditEntry,
  ): Promise<ProductCategoryDeleteResult> {
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, audit, {
          kind: 'condition',
          condition: deletableCategoryExists(id),
        }),
        this.db.delete(productCategories).where(editableCategory(id)),
      ]);
      return 'deleted';
    } catch (error) {
      if (!isAuditGuardRejection(error)) {
        throw error;
      }
      const state = await this.#stateOf(id);
      return state === 'editable' ? 'in-use' : state;
    }
  }

  // 取り消された書き込みは何も残さないため、読み直した状態で原因を分ける
  async #stateOf(id: string): Promise<'not-found' | 'protected' | 'editable'> {
    const category = await this.findById(id);
    if (category === undefined) {
      return 'not-found';
    }
    return category.systemDefault ? 'protected' : 'editable';
  }
}
