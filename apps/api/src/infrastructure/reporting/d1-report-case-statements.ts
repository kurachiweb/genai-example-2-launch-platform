import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { SQLiteUpdateSetSource } from 'drizzle-orm/sqlite-core';
import { inject, injectable } from 'inversify';

import { manualStatusChangeKind } from '../../../common-lib/reporting/report-case-rules.ts';
import type { Database } from '../../../db/client.ts';
import { reportCases } from '../../../db/schema/reporting/report-cases.ts';
import { reports } from '../../../db/schema/reporting/reports.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  CaseClosing,
  ReportCaseInquiryRecord,
  ReportCaseStatusChange,
} from '../../application/reporting/ports.ts';
import { buildAuditLogStatements } from '../admin/audit-log-statements.ts';

export type ReportCaseBatch = readonly [
  BatchItem<'sqlite'>,
  ...BatchItem<'sqlite'>[],
];

const OPEN_STATUSES = ['open', 'in_progress'] as const;

const EXISTENCE_CHECK_COLUMNS = [
  reportCases.id,
  reportCases.targetKind,
  reportCases.status,
  reportCases.statusChangedAt,
  reportCases.lastReportedAt,
  reportCases.posterNoticeStatus,
  reportCases.createdAt,
  reportCases.updatedAt,
] as const;

// 依頼待ちの通知だけを取りやめ、依頼済み・送らなかった記録は残す
const withdrawPendingPosterNotice = sql`CASE WHEN ${reportCases.posterNoticeStatus} = 'pending' THEN 'none' ELSE ${reportCases.posterNoticeStatus} END`;

// 状態の変更・完了・照会の文を、(1)案件の存在の検査、(2)statusの前進、(3)他の更新、(4)監査ログの順に並べる。前進の文の違反で同時の2回目を止めるため、監査ログにはguardを渡さない
@injectable()
export class D1ReportCaseStatements {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  forStatusChange(input: ReportCaseStatusChange): ReportCaseBatch {
    const kind = manualStatusChangeKind(input.from, input.to);
    const advance = sql`CASE WHEN ${reportCases.status} = ${input.from} THEN ${input.to} ELSE NULL END`;
    const common = {
      status: advance,
      statusChangedAt: input.at,
      updatedAt: input.at,
    };
    if (kind === 'progress') {
      return [
        this.#existenceCheck(input.caseId, input.at),
        this.#updateCase(input.caseId, common),
        ...buildAuditLogStatements(this.db, input.audit),
      ];
    }
    const closing =
      kind === 'close'
        ? {
            closedAt: input.at,
            resolution: input.to === 'resolved' ? ('none' as const) : null,
            closingReason: input.reason ?? null,
          }
        : { closedAt: null, resolution: null, closingReason: null };
    return [
      this.#existenceCheck(input.caseId, input.at),
      this.#updateCase(input.caseId, {
        ...common,
        ...closing,
        resolutionActionId: null,
        posterNoticeStatus: withdrawPendingPosterNotice,
      }),
      this.db
        .update(reports)
        .set({ outcomeNoticeStatus: 'none', updatedAt: input.at })
        .where(
          and(
            eq(reports.caseId, input.caseId),
            eq(reports.outcomeNoticeStatus, 'pending'),
          ),
        ),
      ...buildAuditLogStatements(this.db, input.audit),
    ];
  }

  forClosing(
    input: CaseClosing,
    resolutionActionId: string | null,
  ): ReportCaseBatch {
    return [
      this.#existenceCheck(input.caseId, input.at),
      this.#updateCase(input.caseId, {
        status: sql`CASE WHEN ${inArray(reportCases.status, OPEN_STATUSES)} THEN ${input.to} ELSE NULL END`,
        statusChangedAt: input.at,
        closedAt: input.at,
        resolution: input.resolution,
        resolutionActionId,
        closingReason: input.reason,
        posterNoticeStatus: input.posterNotice,
        updatedAt: input.at,
      }),
      // 再開の後の完了では、前の完了で依頼済み・取りやめた通知も、この完了の通知として依頼待ちに戻す
      this.db
        .update(reports)
        .set({
          outcomeNoticeStatus: sql`CASE WHEN ${reports.reporterUserId} IS NOT NULL OR ${reports.contactEmail} IS NOT NULL THEN ${'pending'} ELSE ${'none'} END`,
          updatedAt: input.at,
        })
        .where(
          and(eq(reports.caseId, input.caseId), isNull(reports.deletedAt)),
        ),
      ...buildAuditLogStatements(this.db, input.audit),
    ];
  }

  forInquiry(input: ReportCaseInquiryRecord): ReportCaseBatch {
    return [
      this.#existenceCheck(input.caseId, input.at),
      this.#updateCase(input.caseId, {
        status: sql`CASE WHEN ${reportCases.status} = ${'in_progress'} THEN ${reportCases.status} ELSE NULL END`,
        lastInquiredAt: input.at,
        lastInquiryMessage: input.message,
        updatedAt: input.at,
      }),
      ...buildAuditLogStatements(this.db, input.audit),
    ];
  }

  // CASE式の更新は行が無いと0件の更新で成功して監査ログだけが残るため、読んだ後に案件が物理削除されていればtarget_kindのNOT NULLの違反で全体を取り消す。SQLiteはNOT NULLを列の定義順にCHECKと一意索引より前に検査するため、他のNOT NULLの列には有効な値を入れて違反の列を取り違えない
  #existenceCheck(caseId: string, at: Date): BatchItem<'sqlite'> {
    const atMs = at.getTime();
    const columns = sql.join(
      EXISTENCE_CHECK_COLUMNS.map((column) => sql.identifier(column.name)),
      sql`, `,
    );
    return this.db.run(
      sql`INSERT INTO ${reportCases} (${columns}) SELECT ${caseId}, NULL, ${'open'}, ${atMs}, ${atMs}, ${'none'}, ${atMs}, ${atMs} WHERE NOT EXISTS (SELECT 1 FROM ${reportCases} WHERE ${reportCases.id} = ${caseId})`,
    );
  }

  #updateCase(
    caseId: string,
    values: SQLiteUpdateSetSource<typeof reportCases>,
  ): BatchItem<'sqlite'> {
    return this.db
      .update(reportCases)
      .set(values)
      .where(eq(reportCases.id, caseId));
  }
}
