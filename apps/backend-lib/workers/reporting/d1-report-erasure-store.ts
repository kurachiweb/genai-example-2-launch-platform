import { and, asc, eq, inArray, isNull, lte, type SQL, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { reportCases } from '../../../db/schema/reporting/report-cases.ts';
import { reports } from '../../../db/schema/reporting/reports.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { ReportErasureStore } from '../../core/reporting/ports.ts';
import type { ReportErasureStatements } from './report-erasure-statements.ts';

@injectable()
export class D1ReportErasureStore
  implements ReportErasureStore, ReportErasureStatements
{
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  logicalDeleteByReporterStatement(
    userId: string,
    at: Date,
  ): BatchItem<'sqlite'> {
    return this.db
      .update(reports)
      .set({ deletedAt: at, updatedAt: at })
      .where(
        and(eq(reports.reporterUserId, userId), isNull(reports.deletedAt)),
      );
  }

  async eraseByReporter(
    userId: string,
    limit: number,
  ): Promise<{ readonly remaining: boolean }> {
    const condition = eq(reports.reporterUserId, userId);
    const [, left] = await this.db.batch([
      this.db
        .delete(reports)
        .where(
          inArray(
            reports.id,
            this.db
              .select({ id: reports.id })
              .from(reports)
              .where(condition)
              .limit(limit),
          ),
        ),
      this.db
        .select({ id: reports.id })
        .from(reports)
        .where(condition)
        .limit(1),
    ]);
    return { remaining: left.length > 0 };
  }

  async detachCasesByOwner(
    userId: string,
    at: Date,
    limit: number,
  ): Promise<{ readonly remaining: boolean }> {
    return this.detachMatching(
      eq(reportCases.targetOwnerUserId, userId),
      at,
      limit,
    );
  }

  async detachCasesByProduct(
    productId: string,
    at: Date,
    limit: number,
  ): Promise<{ readonly remaining: boolean }> {
    return this.detachMatching(eq(reportCases.productId, productId), at, limit);
  }

  // 完了から戻した案件はclosed_atを持たないため、再び完了するまで対象にならず、再び完了した日時から数える
  async eraseGuestReportsClosedBefore(
    threshold: Date,
    limit: number,
  ): Promise<number> {
    const result = await this.db.delete(reports).where(
      inArray(
        reports.id,
        this.db
          .select({ id: reports.id })
          .from(reports)
          .where(
            and(
              isNull(reports.reporterUserId),
              inArray(
                reports.caseId,
                this.db
                  .select({ id: reportCases.id })
                  .from(reportCases)
                  .where(lte(reportCases.closedAt, threshold)),
              ),
            ),
          )
          .limit(limit),
      ),
    );
    return result.meta.changes;
  }

  async eraseDetachedCasesBefore(
    threshold: Date,
    limit: number,
  ): Promise<number> {
    // 通報の削除と案件の削除で同じ案件を選ぶよう、並び順を固定した同じ副問い合わせを使う
    const selected = this.db
      .select({ id: reportCases.id })
      .from(reportCases)
      .where(lte(reportCases.targetDetachedAt, threshold))
      .orderBy(asc(reportCases.targetDetachedAt), asc(reportCases.id))
      .limit(limit);
    const [, erased] = await this.db.batch([
      this.db.delete(reports).where(inArray(reports.caseId, selected)),
      this.db.delete(reportCases).where(inArray(reportCases.id, selected)),
    ]);
    return erased.meta.changes;
  }

  // 論理削除済みの通報も行として案件を参照するため、行が1件も無い案件だけを消す
  async eraseEmptyCases(limit: number): Promise<number> {
    const result = await this.db.delete(reportCases).where(
      inArray(
        reportCases.id,
        this.db
          .select({ id: reportCases.id })
          .from(reportCases)
          .where(
            sql`not exists (select 1 from ${reports} where ${reports.caseId} = ${reportCases.id})`,
          )
          .limit(limit),
      ),
    );
    return result.meta.changes;
  }

  // 参照を消すと条件の列がnullになるため、次の実行は参照を消した案件を選ばない
  private async detachMatching(
    condition: SQL,
    at: Date,
    limit: number,
  ): Promise<{ readonly remaining: boolean }> {
    const [, left] = await this.db.batch([
      this.db
        .update(reportCases)
        .set({
          targetId: null,
          targetOwnerUserId: null,
          productId: null,
          targetDetachedAt: at,
          updatedAt: at,
        })
        .where(
          inArray(
            reportCases.id,
            this.db
              .select({ id: reportCases.id })
              .from(reportCases)
              .where(condition)
              .limit(limit),
          ),
        ),
      this.db
        .select({ id: reportCases.id })
        .from(reportCases)
        .where(condition)
        .limit(1),
    ]);
    return { remaining: left.length > 0 };
  }
}
