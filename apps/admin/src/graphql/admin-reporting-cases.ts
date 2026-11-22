import type { QueryClient } from '@tanstack/react-query';
import { notFound } from '@tanstack/react-router';

import {
  REPORT_LIST_PAGE_SIZE,
  type ReportCaseStatus,
  type ReportResolution,
} from '../../common-lib/reporting/report-case-rules.ts';
import type { ResponseTimeAlert } from '../../common-lib/reporting/report-labels.ts';
import type {
  ReporterKind,
  ReportTargetKind,
} from '../../common-lib/reporting/report-rules.ts';
import type { RouterContext } from '../../lib/start/router-context.ts';
import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import {
  type GraphQLMutationInput,
  graphqlQueryOptions,
} from '../../lib/start/graphql/graphql-query-options.ts';
import {
  GraphQLClientError,
  requireData,
} from '../../lib/utilities/graphql/graphql-result.ts';
import {
  type DocumentId,
  documentIdOf,
  type PersistedDocument,
} from '../../lib/utilities/graphql/persisted-document.ts';
import {
  type AdminModerationPage,
  toModerationPage,
} from './admin-moderation-shared.ts';
import { adminReportCategoriesQueryOptions } from './admin-reporting-categories.ts';
import {
  AdminChangeReportCaseStatusDocument,
  AdminRejectReportCaseDocument,
  type AdminReportCaseFilter,
  AdminReportCaseDocument,
  type AdminReportCaseQuery,
  AdminReportCasesDocument,
  type AdminReportCasesQuery,
  type AdminReportCasesQueryVariables,
  type AdminReportCaseSummaryFragment,
  AdminResolveReportCaseWithMeasureDocument,
  AdminResolveReportCaseWithoutMeasureDocument,
  AdminSendInfringementInquiryDocument,
  type ReportCaseStatus as GraphQLReportCaseStatus,
  type ReportResolution as GraphQLReportResolution,
  type ReportTargetKind as GraphQLReportTargetKind,
  type ResponseTimeAlert as GraphQLResponseTimeAlert,
} from './generated/graphql.ts';

export interface ReportCaseFilter {
  readonly status?: ReportCaseStatus | undefined;
  readonly targetKind?: ReportTargetKind | undefined;
  readonly categoryId?: string | undefined;
  // 受付日時はreportedFromを含みreportedBeforeを含まない
  readonly reportedFrom?: string | undefined;
  readonly reportedBefore?: string | undefined;
}

export interface ReportCaseListArgs extends ReportCaseFilter {
  readonly after?: string | undefined;
}

export interface ReportTargetView {
  readonly kind: ReportTargetKind;
  // nullは対象への参照を消した案件
  readonly id: string | null;
  readonly detached: boolean;
  // 偽は退会・削除・物理削除で読めない対象と、対象への参照を消した案件
  readonly available: boolean;
  readonly handle: string | null;
  // ユーザーはニックネーム、プロダクトは名称
  readonly label: string | null;
  // コメントの本文の抜粋。マークダウンとして描画しない
  readonly excerpt: string | null;
  readonly productId: string | null;
  readonly productName: string | null;
  readonly productHandle: string | null;
}

export interface ReportCategoryCountView {
  readonly categoryId: string;
  readonly name: string;
  readonly count: number;
}

export interface ReportResponseTimeView {
  readonly startedAt: string;
  readonly completedAt: string | null;
  // nullは完了の日時が得られない完了した案件
  readonly elapsedSeconds: number | null;
  readonly alerts: readonly ResponseTimeAlert[];
}

export interface ReportCaseView {
  readonly id: string;
  readonly target: ReportTargetView;
  readonly status: ReportCaseStatus;
  readonly reportCount: number;
  readonly categoryCounts: readonly ReportCategoryCountView[];
  readonly firstReportedAt: string;
  readonly lastReportedAt: string;
  readonly infringement: boolean;
  // 権利侵害の案件だけが持つ
  readonly responseTime: ReportResponseTimeView | null;
}

export type ReportCasePage = AdminModerationPage<ReportCaseView>;

export interface ReporterView {
  // nullは画面が知らない種類
  readonly kind: ReporterKind | null;
  readonly nickname: string | null;
  readonly handle: string | null;
  readonly hasContact: boolean;
}

export interface ReportView {
  readonly id: string;
  readonly categoryName: string;
  // マークダウンとして描画しない
  readonly reason: string;
  readonly reportedAt: string;
  readonly reporter: ReporterView;
}

export interface ReportInquiryView {
  readonly sentAt: string;
  readonly message: string;
  readonly deadline: string;
  readonly overdue: boolean;
}

export interface ReportCaseDetailView {
  readonly case: ReportCaseView;
  readonly statusChangedAt: string;
  readonly resolution: ReportResolution | null;
  readonly closingReason: string | null;
  readonly closedAt: string | null;
  readonly lastInquiry: ReportInquiryView | null;
  readonly inquiryAvailable: boolean;
  // 受付日時の昇順
  readonly reports: readonly ReportView[];
}

export interface ReportCaseStatusChangeInput {
  readonly caseId: string;
  readonly from: ReportCaseStatus;
  readonly to: ReportCaseStatus;
  readonly reason?: string | undefined;
}

export type ReportCaseClosingOperation =
  'resolve-with-measure' | 'resolve-without-measure' | 'reject';

export interface ReportCaseClosingInput {
  readonly caseId: string;
  readonly reason: string;
}

export interface ReportCaseOutcomeView {
  readonly status: ReportCaseStatus;
}

export interface InfringementInquiryInput {
  readonly caseId: string;
  readonly message: string;
  readonly reason?: string | undefined;
}

export interface InfringementInquiryOutcomeView {
  readonly sentAt: string;
  readonly deadline: string;
}

export interface ReportCaseMutationOptions<TInput, TOutcome> {
  readonly mutationKey: readonly [DocumentId];
  readonly mutationFn: (
    input: GraphQLMutationInput<TInput>,
  ) => Promise<TOutcome>;
}

export const REPORT_CASE_STATUS_OF: Readonly<
  Record<GraphQLReportCaseStatus, ReportCaseStatus>
> = Object.freeze({
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  REJECTED: 'rejected',
});

const GRAPHQL_REPORT_CASE_STATUS_OF: Readonly<
  Record<ReportCaseStatus, GraphQLReportCaseStatus>
> = Object.freeze({
  open: 'OPEN',
  in_progress: 'IN_PROGRESS',
  resolved: 'RESOLVED',
  rejected: 'REJECTED',
});

const TARGET_KIND_OF: Readonly<
  Record<GraphQLReportTargetKind, ReportTargetKind>
> = Object.freeze({ USER: 'user', PRODUCT: 'product', COMMENT: 'comment' });

const GRAPHQL_TARGET_KIND_OF: Readonly<
  Record<ReportTargetKind, GraphQLReportTargetKind>
> = Object.freeze({ user: 'USER', product: 'PRODUCT', comment: 'COMMENT' });

const RESOLUTION_OF: Readonly<
  Record<GraphQLReportResolution, ReportResolution>
> = Object.freeze({
  PRODUCT_HIDE: 'product.hide',
  COMMENT_HIDE: 'comment.hide',
  USER_SUSPEND: 'user.suspend',
  NONE: 'none',
});

const RESPONSE_TIME_ALERT_OF: Readonly<
  Record<GraphQLResponseTimeAlert, ResponseTimeAlert>
> = Object.freeze({
  START_OVERDUE: 'start-overdue',
  DECISION_OVERDUE: 'decision-overdue',
});

const REPORTER_KINDS: readonly string[] = ['member', 'guest'];

// APIは申出者の種類を列挙でなく文字列で返すため、画面が表示名を持つ値だけに絞る
const isReporterKind = (value: string): value is ReporterKind =>
  REPORTER_KINDS.includes(value);

const variablesOf = ({
  status,
  targetKind,
  categoryId,
  reportedFrom,
  reportedBefore,
  after,
}: ReportCaseListArgs): AdminReportCasesQueryVariables => {
  const filter: AdminReportCaseFilter = {
    ...(status !== undefined && {
      status: GRAPHQL_REPORT_CASE_STATUS_OF[status],
    }),
    ...(targetKind !== undefined && {
      targetKind: GRAPHQL_TARGET_KIND_OF[targetKind],
    }),
    ...(categoryId !== undefined && { categoryId }),
    ...(reportedFrom !== undefined && { reportedFrom }),
    ...(reportedBefore !== undefined && { reportedBefore }),
  };
  return {
    filter,
    first: REPORT_LIST_PAGE_SIZE,
    ...(after !== undefined && { after }),
  };
};

export const adminReportCasesQueryOptions = (args: ReportCaseListArgs) =>
  graphqlQueryOptions(AdminReportCasesDocument, variablesOf(args));

export const adminReportCaseQueryOptions = (id: string) =>
  graphqlQueryOptions(AdminReportCaseDocument, { id });

const toReportCase = (
  node: AdminReportCaseSummaryFragment,
): ReportCaseView => ({
  id: node.id,
  target: {
    kind: TARGET_KIND_OF[node.target.kind],
    id: node.target.id,
    detached: node.target.detached,
    available: node.target.available,
    handle: node.target.handle,
    label: node.target.label,
    excerpt: node.target.excerpt,
    productId: node.target.productId,
    productName: node.target.productName,
    productHandle: node.target.productHandle,
  },
  status: REPORT_CASE_STATUS_OF[node.status],
  reportCount: node.reportCount,
  categoryCounts: node.categoryCounts.map(({ categoryId, name, count }) => ({
    categoryId,
    name,
    count,
  })),
  firstReportedAt: node.firstReportedAt,
  lastReportedAt: node.lastReportedAt,
  infringement: node.infringement,
  responseTime:
    node.responseTime === null
      ? null
      : {
          startedAt: node.responseTime.startedAt,
          completedAt: node.responseTime.completedAt,
          elapsedSeconds: node.responseTime.elapsedSeconds,
          alerts: node.responseTime.alerts.map(
            (alert) => RESPONSE_TIME_ALERT_OF[alert],
          ),
        },
});

type GraphQLReport = NonNullable<
  AdminReportCaseQuery['adminReportCase']
>['reports'][number];

const toReport = ({
  id,
  categoryName,
  reason,
  reportedAt,
  reporter,
}: GraphQLReport): ReportView => ({
  id,
  categoryName,
  reason,
  reportedAt,
  reporter: {
    kind: isReporterKind(reporter.kind) ? reporter.kind : null,
    nickname: reporter.nickname,
    handle: reporter.handle,
    hasContact: reporter.hasContact,
  },
});

export const toReportCasePage = ({
  adminReportCases,
}: AdminReportCasesQuery): ReportCasePage =>
  toModerationPage(adminReportCases, toReportCase);

export const toReportCaseDetail = ({
  adminReportCase,
}: AdminReportCaseQuery): ReportCaseDetailView | null =>
  adminReportCase === null
    ? null
    : {
        case: toReportCase(adminReportCase.case),
        statusChangedAt: adminReportCase.statusChangedAt,
        resolution:
          adminReportCase.resolution === null
            ? null
            : RESOLUTION_OF[adminReportCase.resolution],
        closingReason: adminReportCase.closingReason,
        closedAt: adminReportCase.closedAt,
        lastInquiry:
          adminReportCase.lastInquiry === null
            ? null
            : {
                sentAt: adminReportCase.lastInquiry.sentAt,
                message: adminReportCase.lastInquiry.message,
                deadline: adminReportCase.lastInquiry.deadline,
                overdue: adminReportCase.lastInquiry.overdue,
              },
        inquiryAvailable: adminReportCase.inquiryAvailable,
        reports: adminReportCase.reports.map(toReport),
      };

export const changeReportCaseStatusMutationOptions =
  (): ReportCaseMutationOptions<
    ReportCaseStatusChangeInput,
    ReportCaseOutcomeView
  > => ({
    mutationKey: [documentIdOf(AdminChangeReportCaseStatusDocument)],
    mutationFn: async ({ variables: { caseId, from, to, reason } }) => {
      const { changeReportCaseStatus } = requireData(
        await executeGraphQL(AdminChangeReportCaseStatusDocument, {
          id: caseId,
          from: GRAPHQL_REPORT_CASE_STATUS_OF[from],
          to: GRAPHQL_REPORT_CASE_STATUS_OF[to],
          ...(reason !== undefined && { reason }),
        }),
      );
      return { status: REPORT_CASE_STATUS_OF[changeReportCaseStatus.status] };
    },
  });

type ReportCaseClosingOptions = ReportCaseMutationOptions<
  ReportCaseClosingInput,
  ReportCaseOutcomeView
>;

const closingOptionsOf = <TResult>(
  document: PersistedDocument<
    TResult,
    { readonly id: string; readonly reason: string }
  >,
  outcomeOf: (result: TResult) => { readonly status: GraphQLReportCaseStatus },
): ReportCaseClosingOptions => ({
  mutationKey: [documentIdOf(document)],
  mutationFn: async ({ variables: { caseId, reason } }) => ({
    status:
      REPORT_CASE_STATUS_OF[
        outcomeOf(
          requireData(await executeGraphQL(document, { id: caseId, reason })),
        ).status
      ],
  }),
});

const CLOSING_OPTIONS: Readonly<
  Record<ReportCaseClosingOperation, ReportCaseClosingOptions>
> = Object.freeze({
  'resolve-with-measure': closingOptionsOf(
    AdminResolveReportCaseWithMeasureDocument,
    ({ resolveReportCaseWithMeasure }) => resolveReportCaseWithMeasure,
  ),
  'resolve-without-measure': closingOptionsOf(
    AdminResolveReportCaseWithoutMeasureDocument,
    ({ resolveReportCaseWithoutMeasure }) => resolveReportCaseWithoutMeasure,
  ),
  reject: closingOptionsOf(
    AdminRejectReportCaseDocument,
    ({ rejectReportCase }) => rejectReportCase,
  ),
});

// 3つの完了の操作は操作名と結果の項目だけが違うため、画面からは案件と理由の入力と変更後の状態の結果にそろえて呼べるようにする
export const reportCaseClosingMutationOptions = (
  operation: ReportCaseClosingOperation,
): ReportCaseClosingOptions => CLOSING_OPTIONS[operation];

export const sendInfringementInquiryMutationOptions =
  (): ReportCaseMutationOptions<
    InfringementInquiryInput,
    InfringementInquiryOutcomeView
  > => ({
    mutationKey: [documentIdOf(AdminSendInfringementInquiryDocument)],
    mutationFn: async ({ variables: { caseId, message, reason } }) => {
      const { sendInfringementInquiry } = requireData(
        await executeGraphQL(AdminSendInfringementInquiryDocument, {
          id: caseId,
          message,
          ...(reason !== undefined && { reason }),
        }),
      );
      return {
        sentAt: sendInfringementInquiry.sentAt,
        deadline: sendInfringementInquiry.deadline,
      };
    },
  });

// 条件・ページの位置・案件を問わず、案件の一覧と詳細を取り直させる。表示していない照会は古い印が付くだけで取り直さない
export async function invalidateReportCaseQueries(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all(
    [
      documentIdOf(AdminReportCasesDocument),
      documentIdOf(AdminReportCaseDocument),
    ].map((documentId) =>
      queryClient.invalidateQueries({ queryKey: [documentId] }),
    ),
  );
}

// 一覧と絞り込みのカテゴリの選択肢の取得の失敗は、一覧と絞り込みの中で再試行できるよう、例外にせずキャッシュに残す。
// 同じ画面の中の条件の変更とページの移動で待つと、ルーターが前の条件の画面を保ったまま待ち、画面が直前の一覧を残して読み込み中を示せないため、取得を始めるだけにする
export async function loadReportCasesPage({
  context,
  deps,
  cause,
}: {
  readonly context: Pick<RouterContext, 'queryClient'>;
  readonly deps: ReportCaseListArgs;
  readonly cause: 'preload' | 'enter' | 'stay';
}): Promise<void> {
  const loading = Promise.all([
    context.queryClient
      .query(adminReportCasesQueryOptions(deps))
      .catch(() => undefined),
    context.queryClient
      .query(adminReportCategoriesQueryOptions())
      .catch(() => undefined),
  ]);
  if (cause !== 'stay') {
    await loading;
  }
}

const VALIDATION_ERROR = 'validation_error';

const CASE_ID_FIELD = 'id';

// APIサーバーはIDの形式の違反をnullではなく入力の検証の失敗で返すため、不在と同じ見つからない表示にする
const isMalformedCaseId = (error: unknown): boolean =>
  error instanceof GraphQLClientError &&
  error.code === VALIDATION_ERROR &&
  (error.details ?? []).some(({ field }) => field === CASE_ID_FIELD);

// 詳細が無ければページを表示できないため、詳細の取得の失敗はルートのエラーの画面に任せる
export async function loadReportCasePage({
  context,
  params,
}: {
  readonly context: Pick<RouterContext, 'queryClient'>;
  readonly params: { readonly caseId: string };
}): Promise<void> {
  const data = await context.queryClient
    .query(adminReportCaseQueryOptions(params.caseId))
    .catch((error: unknown) => {
      if (isMalformedCaseId(error)) {
        throw notFound();
      }
      throw error;
    });
  if (data.adminReportCase === null) {
    throw notFound();
  }
}
