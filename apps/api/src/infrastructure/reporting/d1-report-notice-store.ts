import { and, asc, eq, exists, isNotNull, lte, or, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { reportCases } from '../../../db/schema/reporting/report-cases.ts';
import { reports } from '../../../db/schema/reporting/reports.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  PendingOutcomeNotice,
  ReportNoticeStore,
} from '../../application/reporting/ports.ts';

// 論理削除した通報も退会した申出者として送らなかった記録へ進めるため、依頼待ちの照会は論理削除を除かない
@injectable()
export class D1ReportNoticeStore implements ReportNoticeStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async listPendingOutcome(
    caseId: string,
  ): Promise<readonly PendingOutcomeNotice[]> {
    return this.db
      .select({
        reportId: reports.id,
        reporterUserId: reports.reporterUserId,
        contactEmail: reports.contactEmail,
      })
      .from(reports)
      .where(
        and(
          eq(reports.caseId, caseId),
          eq(reports.outcomeNoticeStatus, 'pending'),
        ),
      )
      .orderBy(asc(reports.id));
  }

  // 冪等のキーに使う最小の通報のIDを送り直しで変えないよう、宛先のまとまりを一部だけ進めず、IDの一覧を1つのバインド変数で渡して1文で更新する
  async markOutcome(
    reportIds: readonly string[],
    to: 'requested' | 'skipped',
    at: Date,
  ): Promise<number> {
    if (reportIds.length === 0) {
      return 0;
    }
    const result = await this.db
      .update(reports)
      .set({
        outcomeNoticeStatus: to,
        outcomeNoticeRequestedAt: to === 'requested' ? at : null,
        updatedAt: at,
      })
      .where(
        and(
          sql`${reports.id} IN (SELECT value FROM json_each(${JSON.stringify(reportIds)}))`,
          eq(reports.outcomeNoticeStatus, 'pending'),
        ),
      );
    return result.meta.changes;
  }

  async markPoster(
    caseId: string,
    to: 'requested' | 'skipped',
    at: Date,
  ): Promise<boolean> {
    const result = await this.db
      .update(reportCases)
      .set({
        posterNoticeStatus: to,
        posterNoticeRequestedAt: to === 'requested' ? at : null,
        updatedAt: at,
      })
      .where(
        and(
          eq(reportCases.id, caseId),
          eq(reportCases.posterNoticeStatus, 'pending'),
        ),
      );
    return result.meta.changes > 0;
  }

  async posterNoticePending(caseId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ status: reportCases.posterNoticeStatus })
      .from(reportCases)
      .where(eq(reportCases.id, caseId));
    return row?.status === 'pending';
  }

  async listCasesWithPendingNotices(input: {
    readonly closedBefore: Date;
    readonly limit: number;
  }): Promise<readonly string[]> {
    const pendingOutcome = this.db
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.caseId, reportCases.id),
          eq(reports.outcomeNoticeStatus, 'pending'),
        ),
      );
    const rows = await this.db
      .select({ id: reportCases.id })
      .from(reportCases)
      .where(
        and(
          isNotNull(reportCases.closedAt),
          lte(reportCases.closedAt, input.closedBefore),
          or(
            eq(reportCases.posterNoticeStatus, 'pending'),
            exists(pendingOutcome),
          ),
        ),
      )
      .orderBy(asc(reportCases.closedAt), asc(reportCases.id))
      .limit(input.limit);
    return rows.map(({ id }) => id);
  }
}
