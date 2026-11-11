import { and, asc, count, eq, type SQL, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import { HELP_CATEGORY_OTHER_ID } from '../../../common-lib/help/help-category-constants.ts';
import type { Database } from '../../../db/client.ts';
import { helpArticles } from '../../../db/schema/help/help-articles.ts';
import { helpCategories } from '../../../db/schema/help/help-categories.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  HelpCategoryRecord,
  HelpCategoryStore,
  HelpReorderResult,
} from '../../application/help/ports.ts';
import {
  buildAuditLogStatements,
  isAuditGuardRejection,
} from '../admin/audit-log-statements.ts';
import { helpOrderGuard, isHelpOrderGuardRejection } from './help-guards.ts';

const NAME_COLUMN = 'help_categories.name';

const UNIQUE_VIOLATION_PATTERN = /UNIQUE constraint failed: ([^:]+)/u;

// 一括の書き込みの失敗はD1のエラーがcauseにSQLiteのエラーを持ち、文の組み立ての失敗はDrizzleQueryErrorが包むため、原因をたどって文言を調べる
function violatesUniqueName(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    const columns = UNIQUE_VIOLATION_PATTERN.exec(current.message)?.[1];
    if (columns !== undefined) {
      return columns.split(',').some((column) => column.trim() === NAME_COLUMN);
    }
  }
  return false;
}

const editableCategory = (id: string): SQL | undefined =>
  and(eq(helpCategories.id, id), eq(helpCategories.systemDefault, false));

// 監査ログの条件は書き込みの時点で評価され、偽なら名前の変更・付け替え・削除も含めて取り消される
const editableCategoryExists = (id: string): SQL =>
  sql`EXISTS (SELECT 1 FROM ${helpCategories} WHERE ${editableCategory(id)})`;

// 更新日時の列は更新の文で自動的に現在時刻になるため、並び順と所属だけを変える文では元の値を明示して保つ
const keepUpdatedAt = sql`${sql.identifier('updated_at')}`;

@injectable()
export class D1HelpCategoryStore implements HelpCategoryStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async list(): Promise<readonly HelpCategoryRecord[]> {
    return this.#selectCategories().orderBy(
      asc(helpCategories.sortOrder),
      asc(helpCategories.createdAt),
      asc(helpCategories.id),
    );
  }

  async findById(id: string): Promise<HelpCategoryRecord | undefined> {
    const [row] = await this.#selectCategories().where(
      eq(helpCategories.id, id),
    );
    return row;
  }

  async create(input: {
    readonly id: string;
    readonly name: string;
    readonly now: Date;
    readonly audit: PreparedAuditEntry;
  }): Promise<'created' | 'name-taken'> {
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, input.audit),
        this.db.insert(helpCategories).values({
          id: input.id,
          name: input.name,
          sortOrder: sql`(SELECT COALESCE(MAX(${helpCategories.sortOrder}), 0) + 1 FROM ${helpCategories})`,
          createdAt: input.now,
          updatedAt: input.now,
        }),
      ]);
      return 'created';
    } catch (error) {
      if (violatesUniqueName(error)) {
        return 'name-taken';
      }
      throw error;
    }
  }

  async rename(input: {
    readonly id: string;
    readonly name: string;
    readonly now: Date;
    readonly audit: PreparedAuditEntry;
  }): Promise<'renamed' | 'name-taken' | 'not-found'> {
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, input.audit, {
          kind: 'condition',
          condition: editableCategoryExists(input.id),
        }),
        this.db
          .update(helpCategories)
          .set({ name: input.name, updatedAt: input.now })
          .where(editableCategory(input.id)),
      ]);
      return 'renamed';
    } catch (error) {
      if (violatesUniqueName(error)) {
        return 'name-taken';
      }
      if (isAuditGuardRejection(error)) {
        return 'not-found';
      }
      throw error;
    }
  }

  // 件数は確認と監査ログの表示用で、付け替えは書き込みの時点で紐付く全ての記事を条件付きの更新で行う
  async deleteAndReassign(input: {
    readonly id: string;
    readonly audit: PreparedAuditEntry;
  }): Promise<'deleted' | 'not-found'> {
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, input.audit, {
          kind: 'condition',
          condition: editableCategoryExists(input.id),
        }),
        // 副問い合わせは更新しない標準カテゴリの記事だけを読むため全ての行に同じ値が足され、元の相対的な順を保って標準カテゴリの末尾へ移る
        this.db
          .update(helpArticles)
          .set({
            sortOrder: sql`${sql.identifier('sort_order')} + (SELECT COALESCE(MAX(${helpArticles.sortOrder}), 0) FROM ${helpArticles} WHERE ${eq(helpArticles.categoryId, HELP_CATEGORY_OTHER_ID)})`,
            updatedAt: keepUpdatedAt,
          })
          .where(eq(helpArticles.categoryId, input.id)),
        // 版は検索の索引の版にも使い、公開の内容が変わらない付け替えでは上げない
        this.db
          .update(helpArticles)
          .set({ categoryId: HELP_CATEGORY_OTHER_ID, updatedAt: keepUpdatedAt })
          .where(eq(helpArticles.categoryId, input.id)),
        this.db.delete(helpCategories).where(editableCategory(input.id)),
      ]);
      return 'deleted';
    } catch (error) {
      if (isAuditGuardRejection(error)) {
        return 'not-found';
      }
      throw error;
    }
  }

  async reorder(input: {
    readonly orderedIds: readonly string[];
    readonly audit: PreparedAuditEntry;
  }): Promise<HelpReorderResult> {
    const ids = JSON.stringify(input.orderedIds);
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, input.audit),
        helpOrderGuard(this.db, {
          kind: 'categories',
          orderedIds: input.orderedIds,
        }),
        // 順序をJSONの配列1つで渡し、件数によらず1文で並び順を配列の位置に揃える
        this.db
          .update(helpCategories)
          .set({
            sortOrder: sql`(SELECT CAST(key AS INTEGER) + 1 FROM json_each(${ids}) WHERE value = ${helpCategories.id})`,
            updatedAt: keepUpdatedAt,
          })
          .where(
            sql`${helpCategories.id} IN (SELECT value FROM json_each(${ids}))`,
          ),
      ]);
      return 'reordered';
    } catch (error) {
      if (isHelpOrderGuardRejection(error)) {
        return 'outdated';
      }
      throw error;
    }
  }

  #selectCategories() {
    return this.db
      .select({
        id: helpCategories.id,
        name: helpCategories.name,
        systemDefault: helpCategories.systemDefault,
        sortOrder: helpCategories.sortOrder,
        articleCount: count(helpArticles.id),
        createdAt: helpCategories.createdAt,
      })
      .from(helpCategories)
      .leftJoin(helpArticles, eq(helpArticles.categoryId, helpCategories.id))
      .groupBy(helpCategories.id)
      .$dynamic();
  }
}
