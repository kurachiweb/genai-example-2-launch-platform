import { inject, injectable } from 'inversify';

import type { AuditTargetKind } from '../../../common-lib/admin/audit-action.ts';
import {
  REPORT_REJECT_ACTION,
  REPORT_RESOLVE_ACTION,
} from '../../../common-lib/admin/audit-actions/content-reporting.ts';
import {
  isClosedStatus,
  REPORT_LIST_PAGE_SIZE,
} from '../../../common-lib/reporting/report-case-rules.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type { UserContactDirectory } from '../../../lib/core/identity/ports.ts';
import { PROFILE_PLATFORM_TYPES } from '../../../lib/core/profile/identifiers.ts';
import type {
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../../lib/core/profile/ports.ts';
import {
  computeResponseTime,
  inquiryDeadline,
  isInquiryOverdue,
  type ResponseTime,
} from '../../../lib/core/reporting/response-time.ts';
import { ADMIN_TYPES } from '../admin/admin-types.ts';
import type { AuditLogReader } from '../admin/audit-log-reader.ts';
import type {
  ProductReportSummary,
  ReportCaseDetailView,
  ReportCaseFilter,
  ReportCaseInquiryView,
  ReportCaseReader,
  ReportCaseRecord,
  ReportCaseReportRecord,
  ReportCaseReportView,
  ReportCaseStore,
  ReportCaseSummaryView,
  ReportTargetKey,
  ReportTargetResolver,
  ReportTargetView,
  UnhandledReportCount,
} from './ports.ts';
import { inquiryTargetPathOf } from './inquiry-target.ts';
import { REPORTING_TYPES } from './reporting-types.ts';
import {
  reportTargetKeyOf,
  UNAVAILABLE_TARGET_VIEW,
} from './report-target-resolver.ts';

const REPORT_AUDIT_TARGET_KIND: AuditTargetKind = 'report';

const CLOSING_ACTIONS = Object.freeze([
  REPORT_RESOLVE_ACTION.name,
  REPORT_REJECT_ACTION.name,
]);

const targetKeyOf = (record: ReportCaseRecord): ReportTargetKey => ({
  kind: record.targetKind,
  targetId: record.targetId,
  productId: record.productId,
});

// 完了の日時は監査ログから求めるため、照会は対応期間を示す完了した権利侵害の案件に限る
const needsCompletion = (record: ReportCaseRecord): boolean =>
  record.infringementReportedAt !== null && isClosedStatus(record.status);

const latestOf = (dates: readonly (Date | undefined)[]): Date | undefined =>
  dates.reduce<Date | undefined>(
    (latest, date) =>
      date !== undefined &&
      (latest === undefined || date.getTime() > latest.getTime())
        ? date
        : latest,
    undefined,
  );

const responseTimeOf = (
  record: ReportCaseRecord,
  completedAt: Date | undefined,
  now: Date,
): ResponseTime | null =>
  record.infringementReportedAt === null
    ? null
    : computeResponseTime({
        startedAt: record.infringementReportedAt,
        status: record.status,
        completedAt,
        now,
      });

const summaryOf = (
  record: ReportCaseRecord,
  views: ReadonlyMap<string, ReportTargetView>,
  completedAt: Date | undefined,
  now: Date,
): ReportCaseSummaryView => {
  const key = targetKeyOf(record);
  return {
    caseId: record.caseId,
    target: {
      ...key,
      view: views.get(reportTargetKeyOf(key)) ?? UNAVAILABLE_TARGET_VIEW,
    },
    status: record.status,
    reportCount: record.reportCount,
    categoryCounts: record.categoryCounts,
    firstReportedAt: record.firstReportedAt,
    lastReportedAt: record.lastReportedAt,
    infringement: record.infringementReportedAt !== null,
    responseTime: responseTimeOf(record, completedAt, now),
  };
};

const inquiryOf = (
  record: ReportCaseRecord,
  now: Date,
): ReportCaseInquiryView | null => {
  if (record.lastInquiredAt === null || record.lastInquiryMessage === null) {
    return null;
  }
  const sentAt = record.lastInquiredAt;
  return {
    sentAt,
    message: record.lastInquiryMessage,
    deadline: inquiryDeadline(sentAt),
    overdue: record.status === 'in_progress' && isInquiryOverdue(sentAt, now),
  };
};

const reportViewOf = (
  report: ReportCaseReportRecord,
  reporters: ReadonlyMap<string, UserSummaryRecord>,
): ReportCaseReportView => {
  const reporter =
    report.reporterUserId === null
      ? undefined
      : reporters.get(report.reporterUserId);
  return {
    reportId: report.reportId,
    categoryName: report.categoryName,
    reason: report.reason,
    reportedAt: report.reportedAt,
    reporter:
      report.reporterUserId === null
        ? { kind: 'guest', hasContact: report.hasContact }
        : {
            kind: 'member',
            nickname: reporter?.nickname ?? null,
            handle: reporter?.handle ?? null,
          },
  };
};

// 権限の確認と入力の検証は呼び出し側のリゾルバが行う
@injectable()
export class DefaultReportCaseReader implements ReportCaseReader {
  constructor(
    @inject(REPORTING_TYPES.ReportCaseStore)
    private readonly store: ReportCaseStore,
    @inject(REPORTING_TYPES.ReportTargetResolver)
    private readonly targets: ReportTargetResolver,
    @inject(ADMIN_TYPES.AuditLogReader)
    private readonly auditLogs: AuditLogReader,
    @inject(PROFILE_PLATFORM_TYPES.UserProfileDirectory)
    private readonly profiles: UserProfileDirectory,
    @inject(IDENTITY_PLATFORM_TYPES.UserContactDirectory)
    private readonly contacts: UserContactDirectory,
  ) {}

  async list(
    filter: ReportCaseFilter,
    page: { readonly after?: string; readonly first: number },
    now: Date,
  ): Promise<{
    readonly items: readonly ReportCaseSummaryView[];
    readonly nextCursor: string | null;
  }> {
    // カテゴリごとの件数の照会がページの件数だけバインド変数を使うため、上限を超えて引かない
    const { items, nextCursor } = await this.store.search(filter, {
      ...(page.after === undefined ? {} : { after: page.after }),
      limit: Math.min(page.first, REPORT_LIST_PAGE_SIZE),
    });
    const [views, completions] = await Promise.all([
      this.targets.describe(items.map(targetKeyOf)),
      this.#completionsOf(
        items.filter(needsCompletion).map((record) => record.caseId),
      ),
    ]);
    return {
      items: items.map((record) =>
        summaryOf(record, views, completions.get(record.caseId), now),
      ),
      nextCursor,
    };
  }

  async detail(
    caseId: string,
    now: Date,
  ): Promise<ReportCaseDetailView | undefined> {
    const record = await this.store.find(caseId);
    if (record === undefined) {
      return undefined;
    }
    const [reports, views, completedAt, posterReachable] = await Promise.all([
      this.store.listReports(caseId),
      this.targets.describe([targetKeyOf(record)]),
      needsCompletion(record)
        ? this.#completionOf(caseId)
        : Promise.resolve(undefined),
      this.#posterReachable(record),
    ]);
    const targetKey = targetKeyOf(record);
    const inquiryAvailable =
      posterReachable &&
      inquiryTargetPathOf(
        targetKey.kind,
        views.get(reportTargetKeyOf(targetKey)),
      ) !== undefined;
    const reporters = await this.#reportersOf(reports);
    return {
      ...summaryOf(record, views, completedAt, now),
      statusChangedAt: record.statusChangedAt,
      resolution: record.resolution,
      closingReason: record.closingReason,
      closedAt: record.closedAt,
      lastInquiry: inquiryOf(record, now),
      inquiryAvailable,
      reports: reports.map((report) => reportViewOf(report, reporters)),
    };
  }

  unhandledSummary(): Promise<UnhandledReportCount> {
    return this.store.countUnhandled();
  }

  productSummary(productId: string): Promise<ProductReportSummary> {
    return this.store.productSummary(productId);
  }

  // 手での完了も対応済・却下の操作種別で記録されるため、2つの操作種別の新しい方が最後の完了になる
  async #completionsOf(
    caseIds: readonly string[],
  ): Promise<ReadonlyMap<string, Date>> {
    if (caseIds.length === 0) {
      return new Map();
    }
    const perAction = await Promise.all(
      CLOSING_ACTIONS.map((action) =>
        this.auditLogs.latestForMany({
          action,
          targetKind: REPORT_AUDIT_TARGET_KIND,
          targetIds: caseIds,
        }),
      ),
    );
    return new Map(
      caseIds.flatMap((caseId): [string, Date][] => {
        const latest = latestOf(perAction.map((dates) => dates.get(caseId)));
        return latest === undefined ? [] : [[caseId, latest]];
      }),
    );
  }

  async #completionOf(caseId: string): Promise<Date | undefined> {
    const dates = await Promise.all(
      CLOSING_ACTIONS.map((action) =>
        this.auditLogs.latestFor({
          action,
          targetKind: REPORT_AUDIT_TARGET_KIND,
          targetId: caseId,
        }),
      ),
    );
    return latestOf(dates);
  }

  // 照会の送信と同じ条件のうち、対象の表示に依らない条件と投稿者の宛先の有無を判定する
  async #posterReachable(record: ReportCaseRecord): Promise<boolean> {
    if (
      record.infringementReportedAt === null ||
      record.status !== 'in_progress' ||
      record.targetId === null ||
      record.targetOwnerUserId === null
    ) {
      return false;
    }
    return (
      (await this.contacts.findContact(record.targetOwnerUserId)) !== undefined
    );
  }

  async #reportersOf(
    reports: readonly ReportCaseReportRecord[],
  ): Promise<ReadonlyMap<string, UserSummaryRecord>> {
    const ids = [
      ...new Set(
        reports.flatMap((report) =>
          report.reporterUserId === null ? [] : [report.reporterUserId],
        ),
      ),
    ];
    return ids.length === 0
      ? new Map()
      : this.profiles.findSummaries(ids, 'not-withdrawn');
  }
}
