import type { QueryClient } from '@tanstack/react-query';

import type { ReportCaseStatus } from '../../common-lib/reporting/report-case-rules.ts';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import { REPORT_CASE_STATUS_OF } from './admin-reporting-cases.ts';
import {
  AdminProductReportSummaryDocument,
  type AdminProductReportSummaryQuery,
  AdminUnhandledReportSummaryDocument,
  type AdminUnhandledReportSummaryQuery,
} from './generated/graphql.ts';

export interface UnhandledReportSummaryView {
  readonly open: number;
  // openのうちの権利侵害の案件
  readonly infringementOpen: number;
}

export interface ProductReportSummaryView {
  // 退会で論理削除した通報を除く累計
  readonly reportCount: number;
  // nullは未完了の案件が無い
  readonly openCase: {
    readonly id: string;
    readonly status: ReportCaseStatus;
  } | null;
}

export const adminUnhandledReportSummaryQueryOptions = () =>
  graphqlQueryOptions(AdminUnhandledReportSummaryDocument, {});

export const adminProductReportSummaryQueryOptions = (productId: string) =>
  graphqlQueryOptions(AdminProductReportSummaryDocument, { productId });

export const toUnhandledReportSummary = ({
  adminUnhandledReportSummary,
}: AdminUnhandledReportSummaryQuery): UnhandledReportSummaryView => ({
  open: adminUnhandledReportSummary.open,
  infringementOpen: adminUnhandledReportSummary.infringementOpen,
});

export const toProductReportSummary = ({
  adminProductReportSummary: { reportCount, openCase },
}: AdminProductReportSummaryQuery): ProductReportSummaryView => ({
  reportCount,
  openCase:
    openCase === null
      ? null
      : { id: openCase.id, status: REPORT_CASE_STATUS_OF[openCase.status] },
});

// 案件の状態の変更と完了で件数が変わるため、案件の操作の後にプロダクトを問わず無効にする。表示していない照会は古い印が付くだけで取り直さない
export async function invalidateReportSummaryQueries(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all(
    [
      documentIdOf(AdminUnhandledReportSummaryDocument),
      documentIdOf(AdminProductReportSummaryDocument),
    ].map((documentId) =>
      queryClient.invalidateQueries({ queryKey: [documentId] }),
    ),
  );
}
