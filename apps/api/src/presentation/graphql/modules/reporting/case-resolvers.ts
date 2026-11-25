import type { ResponseTime } from '../../../../../lib/core/reporting/response-time.ts';
import type {
  InfringementInquiryService,
  ReportCaseCommand,
  ReportCaseDetailView,
  ReportCaseReader,
  ReportCaseReporterView,
  ReportCaseReportView,
  ReportCaseSummaryView,
  ReportCaseWorkflow,
} from '../../../../application/reporting/ports.ts';
import { REPORTING_TYPES } from '../../../../application/reporting/reporting-types.ts';
import { requireAdmin } from '../../admin-guard.ts';
import type {
  AdminReport,
  AdminReportCase,
  AdminReportCaseConnection,
  AdminReportCaseDetail,
  AdminReporter,
  AdminReportResponseTime,
  Resolvers,
} from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import {
  graphqlReportCaseStatusOf,
  graphqlReportResolutionOf,
  graphqlReportTargetKindOf,
  graphqlResponseTimeAlertOf,
} from './enums.ts';
import {
  ADMIN_REPORT_CASE_ARGS,
  ADMIN_REPORT_CASES_ARGS,
  CHANGE_REPORT_CASE_STATUS_ARGS,
  REPORT_CASE_CLOSING_ARGS,
  SEND_INFRINGEMENT_INQUIRY_ARGS,
} from './inputs.ts';
import { adminOnly, clockOf } from './resolver-support.ts';

const MILLISECONDS_PER_SECOND = 1000;

const readerOf = (context: GraphQLContext): ReportCaseReader =>
  context.resolve<ReportCaseReader>(REPORTING_TYPES.ReportCaseReader);

const workflowOf = (context: GraphQLContext): ReportCaseWorkflow =>
  context.resolve<ReportCaseWorkflow>(REPORTING_TYPES.ReportCaseWorkflow);

const inquiryServiceOf = (
  context: GraphQLContext,
): InfringementInquiryService =>
  context.resolve<InfringementInquiryService>(
    REPORTING_TYPES.InfringementInquiryService,
  );

// ロールの確認はユースケースが行わないため、ここで確かめた管理者を操作者として渡す
async function commandOf(
  context: GraphQLContext,
  caseId: string,
): Promise<ReportCaseCommand> {
  const admin = await requireAdmin(context, 'moderator');
  return {
    caseId,
    operator: { adminId: admin.id },
    at: clockOf(context).now(),
  };
}

const toResponseTime = (time: ResponseTime): AdminReportResponseTime => ({
  startedAt: time.startedAt,
  completedAt: time.completedAt,
  elapsedSeconds:
    time.elapsedMs === null
      ? null
      : Math.floor(time.elapsedMs / MILLISECONDS_PER_SECOND),
  alerts: time.alerts.map(graphqlResponseTimeAlertOf),
});

const toAdminReportCase = (view: ReportCaseSummaryView): AdminReportCase => {
  const { target } = view;
  return {
    id: view.caseId,
    target: {
      kind: graphqlReportTargetKindOf(target.kind),
      id: target.targetId,
      detached: target.targetId === null,
      available: target.view.available,
      handle: target.view.handle,
      label: target.view.label,
      excerpt: target.view.excerpt,
      productId: target.productId,
      productName: target.view.productName,
      productHandle: target.view.productHandle,
    },
    status: graphqlReportCaseStatusOf(view.status),
    reportCount: view.reportCount,
    categoryCounts: view.categoryCounts.map(({ categoryId, name, count }) => ({
      categoryId,
      name,
      count,
    })),
    firstReportedAt: view.firstReportedAt,
    lastReportedAt: view.lastReportedAt,
    infringement: view.infringement,
    responseTime:
      view.responseTime === null ? null : toResponseTime(view.responseTime),
  };
};

// 申出者の連絡先は返さず、未ログインの通報だけが連絡先を持つため、利用者の通報は連絡先なしとする
const toReporter = (reporter: ReportCaseReporterView): AdminReporter =>
  reporter.kind === 'member'
    ? {
        kind: reporter.kind,
        nickname: reporter.nickname,
        handle: reporter.handle,
        hasContact: false,
      }
    : {
        kind: reporter.kind,
        nickname: null,
        handle: null,
        hasContact: reporter.hasContact,
      };

const toReport = (report: ReportCaseReportView): AdminReport => ({
  id: report.reportId,
  categoryName: report.categoryName,
  reason: report.reason,
  reportedAt: report.reportedAt,
  reporter: toReporter(report.reporter),
});

const toAdminReportCaseDetail = (
  detail: ReportCaseDetailView,
): AdminReportCaseDetail => ({
  case: toAdminReportCase(detail),
  statusChangedAt: detail.statusChangedAt,
  resolution:
    detail.resolution === null
      ? null
      : graphqlReportResolutionOf(detail.resolution),
  closingReason: detail.closingReason,
  closedAt: detail.closedAt,
  lastInquiry: detail.lastInquiry === null ? null : { ...detail.lastInquiry },
  inquiryAvailable: detail.inquiryAvailable,
  reports: detail.reports.map(toReport),
});

// 案件の一覧・詳細は閲覧のみ以上、状態の変更・完了・照会はモデレーター以上に許す。各リゾルバはadminOnlyで包み、入力の検証より前に管理者側以外の呼び出しを拒否する
export const caseResolvers = {
  Query: {
    adminReportCases: adminOnly(
      withValidatedArgs(
        ADMIN_REPORT_CASES_ARGS,
        async (
          _parent: unknown,
          { filter, first, after },
          context,
        ): Promise<AdminReportCaseConnection> => {
          await requireAdmin(context, 'viewer');
          const page = await readerOf(context).list(
            filter,
            { first, ...(after !== undefined && { after }) },
            clockOf(context).now(),
          );
          return {
            nodes: page.items.map(toAdminReportCase),
            pageInfo: {
              hasNextPage: page.nextCursor !== null,
              endCursor: page.nextCursor,
            },
          };
        },
      ),
    ),
    adminReportCase: adminOnly(
      withValidatedArgs(
        ADMIN_REPORT_CASE_ARGS,
        async (
          _parent: unknown,
          { id },
          context,
        ): Promise<AdminReportCaseDetail | null> => {
          await requireAdmin(context, 'viewer');
          const detail = await readerOf(context).detail(
            id,
            clockOf(context).now(),
          );
          return detail === undefined ? null : toAdminReportCaseDetail(detail);
        },
      ),
    ),
  },
  Mutation: {
    changeReportCaseStatus: adminOnly(
      withValidatedArgs(
        CHANGE_REPORT_CASE_STATUS_ARGS,
        async (_parent: unknown, { id, from, to, reason }, context) => {
          const { status } = await workflowOf(context).changeStatus({
            ...(await commandOf(context, id)),
            from,
            to,
            reason,
          });
          return { status: graphqlReportCaseStatusOf(status) };
        },
      ),
    ),
    resolveReportCaseWithMeasure: adminOnly(
      withValidatedArgs(
        REPORT_CASE_CLOSING_ARGS,
        async (_parent: unknown, { id, reason }, context) => {
          const { status } = await workflowOf(context).resolveWithMeasure({
            ...(await commandOf(context, id)),
            reason,
          });
          return { status: graphqlReportCaseStatusOf(status) };
        },
      ),
    ),
    resolveReportCaseWithoutMeasure: adminOnly(
      withValidatedArgs(
        REPORT_CASE_CLOSING_ARGS,
        async (_parent: unknown, { id, reason }, context) => {
          const { status } = await workflowOf(context).resolveWithoutMeasure({
            ...(await commandOf(context, id)),
            reason,
          });
          return { status: graphqlReportCaseStatusOf(status) };
        },
      ),
    ),
    rejectReportCase: adminOnly(
      withValidatedArgs(
        REPORT_CASE_CLOSING_ARGS,
        async (_parent: unknown, { id, reason }, context) => {
          const { status } = await workflowOf(context).reject({
            ...(await commandOf(context, id)),
            reason,
          });
          return { status: graphqlReportCaseStatusOf(status) };
        },
      ),
    ),
    sendInfringementInquiry: adminOnly(
      withValidatedArgs(
        SEND_INFRINGEMENT_INQUIRY_ARGS,
        async (_parent: unknown, { id, message, reason }, context) =>
          inquiryServiceOf(context).send({
            ...(await commandOf(context, id)),
            message,
            reason,
          }),
      ),
    ),
  },
} satisfies Resolvers;
