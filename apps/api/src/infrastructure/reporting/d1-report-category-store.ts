import { and, asc, count, eq, type SQL, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import { REPORT_CATEGORY_OTHER_ID } from '../../../common-lib/reporting/report-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import type { Database } from '../../../db/client.ts';
import { reportCategories } from '../../../db/schema/reporting/report-categories.ts';
import { reports } from '../../../db/schema/reporting/reports.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  ReportCategoryRecord,
  ReportCategoryStore,
} from '../../application/reporting/ports.ts';
import {
  buildAuditLogStatements,
  isAuditGuardRejection,
} from '../admin/audit-log-statements.ts';

const CATEGORY_RECORD_COLUMNS = {
  id: reportCategories.id,
  name: reportCategories.name,
  systemDefault: reportCategories.systemDefault,
  createdAt: reportCategories.createdAt,
};

const NAME_COLUMN = 'report_categories.name';

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
  and(eq(reportCategories.id, id), eq(reportCategories.systemDefault, false));

// 監査ログの条件は書き込みの時点で評価され、偽なら名前の変更・付け替え・削除も含めて取り消される
const editableCategoryExists = (id: string): SQL =>
  sql`EXISTS (SELECT 1 FROM ${reportCategories} WHERE ${editableCategory(id)})`;

@injectable()
export class D1ReportCategoryStore implements ReportCategoryStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // 付け替えと削除の確認の件数と同じ範囲で数えるため、論理削除した通報も含める
  async list(): Promise<
    readonly (ReportCategoryRecord & { readonly reportCount: number })[]
  > {
    return this.db
      .select({ ...CATEGORY_RECORD_COLUMNS, reportCount: count(reports.id) })
      .from(reportCategories)
      .leftJoin(reports, eq(reports.categoryId, reportCategories.id))
      .groupBy(reportCategories.id)
      .orderBy(asc(reportCategories.createdAt), asc(reportCategories.id));
  }

  async find(id: string): Promise<ReportCategoryRecord | undefined> {
    const [row] = await this.db
      .select(CATEGORY_RECORD_COLUMNS)
      .from(reportCategories)
      .where(eq(reportCategories.id, id));
    return row;
  }

  async countReports(id: string): Promise<number> {
    return this.db.$count(reports, eq(reports.categoryId, id));
  }

  // 名前の一意索引は大文字小文字だけを区別しないため、前後の空白を除いてから保存して空白だけが異なる名前も重複にする
  async insert(
    category: { readonly id: string; readonly name: string; readonly at: Date },
    audit: PreparedAuditEntry,
  ): Promise<'created' | 'name-taken'> {
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, audit),
        this.db.insert(reportCategories).values({
          id: category.id,
          name: trimWhiteSpace(category.name),
          createdAt: category.at,
          updatedAt: category.at,
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

  async rename(
    id: string,
    name: string,
    at: Date,
    audit: PreparedAuditEntry,
  ): Promise<'renamed' | 'name-taken' | 'not-found'> {
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, audit, {
          kind: 'condition',
          condition: editableCategoryExists(id),
        }),
        this.db
          .update(reportCategories)
          .set({ name: trimWhiteSpace(name), updatedAt: at })
          .where(editableCategory(id)),
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

  // 外部キーにより紐付く通報が1件でも残るとカテゴリを消せないため、論理削除した通報も付け替える。受付時点のカテゴリ名の列は変えない
  async deleteAndReassign(
    id: string,
    at: Date,
    audit: PreparedAuditEntry,
  ): Promise<'deleted' | 'not-found'> {
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, audit, {
          kind: 'condition',
          condition: editableCategoryExists(id),
        }),
        this.db
          .update(reports)
          .set({ categoryId: REPORT_CATEGORY_OTHER_ID, updatedAt: at })
          .where(eq(reports.categoryId, id)),
        this.db.delete(reportCategories).where(editableCategory(id)),
      ]);
      return 'deleted';
    } catch (error) {
      if (isAuditGuardRejection(error)) {
        return 'not-found';
      }
      throw error;
    }
  }
}
