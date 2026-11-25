import { and, eq, isNull, type SQL, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { reportCases } from '../../../db/schema/reporting/report-cases.ts';
import { reportCategories } from '../../../db/schema/reporting/report-categories.ts';
import { reports } from '../../../db/schema/reporting/reports.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  ReportSubmissionRecord,
  ReportSubmissionStore,
} from '../../application/reporting/ports.ts';

const CATEGORY_MISSING_PATTERN =
  /NOT NULL constraint failed: reports\.category_name/u;

function excluded(column: SQLiteColumn): SQL {
  return sql`excluded.${sql.identifier(column.name)}`;
}

// 一括の書き込みの失敗はD1のエラーがcauseにSQLiteのエラーを持ち、文の組み立ての失敗はDrizzleQueryErrorが包むため、原因をたどって調べる
function missesCategory(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (CATEGORY_MISSING_PATTERN.test(current.message)) {
      return true;
    }
  }
  return false;
}

@injectable()
export class D1ReportSubmissionStore implements ReportSubmissionStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // カテゴリが同時に削除されていれば、通報の受付時点のカテゴリ名がNULLになってNOT NULLの違反で一括の書き込み全体が取り消される
  async submit(
    record: ReportSubmissionRecord,
  ): Promise<'accepted' | 'category-missing'> {
    try {
      await this.db.batch([
        this.caseUpsertOf(record),
        this.reportInsertOf(record),
      ]);
      return 'accepted';
    } catch (error) {
      if (missesCategory(error)) {
        return 'category-missing';
      }
      throw error;
    }
  }

  // 受付日時は読んでから書き込むまでに対象の確認と回数制限を挟むため、同時の通報で先に時刻を読んだ要求が後で確定し得る。MAXで最後の受付日時を古い時刻へ戻さない
  private caseUpsertOf(record: ReportSubmissionRecord) {
    const { at, target } = record;
    return this.db
      .insert(reportCases)
      .values({
        id: record.newCaseId,
        targetKind: target.kind,
        targetId: target.targetId,
        targetOwnerUserId: target.ownerUserId,
        productId: target.productId,
        statusChangedAt: at,
        lastReportedAt: at,
        infringementReportedAt: record.infringement ? at : null,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: [reportCases.targetKind, reportCases.targetId],
        // 部分一意索引を衝突の対象にするには、索引と同じ条件をバインド変数にせず`sql`で書く
        targetWhere: sql`${reportCases.closedAt} is null`,
        set: {
          lastReportedAt: sql`max(${reportCases.lastReportedAt}, ${excluded(reportCases.lastReportedAt)})`,
          infringementReportedAt: sql`coalesce(${reportCases.infringementReportedAt}, ${excluded(reportCases.infringementReportedAt)})`,
          updatedAt: excluded(reportCases.updatedAt),
        },
      });
  }

  private reportInsertOf(record: ReportSubmissionRecord) {
    const { at, target } = record;
    const openCaseId = this.db
      .select({ id: reportCases.id })
      .from(reportCases)
      .where(
        and(
          eq(reportCases.targetKind, target.kind),
          eq(reportCases.targetId, target.targetId),
          isNull(reportCases.closedAt),
        ),
      );
    const categoryName = this.db
      .select({ name: reportCategories.name })
      .from(reportCategories)
      .where(eq(reportCategories.id, record.categoryId));
    return this.db.insert(reports).values({
      id: record.reportId,
      caseId: sql`(${openCaseId})`,
      reporterUserId: record.reporterUserId,
      contactEmail: record.contactEmail,
      categoryId: record.categoryId,
      categoryName: sql`(${categoryName})`,
      reason: record.reason,
      reportedAt: at,
      createdAt: at,
      updatedAt: at,
    });
  }
}
