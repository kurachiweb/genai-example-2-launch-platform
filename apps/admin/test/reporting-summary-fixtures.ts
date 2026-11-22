import type { Mock } from 'vitest';

import {
  AdminProductReportSummaryDocument,
  type AdminProductReportSummaryQuery,
  AdminUnhandledReportSummaryDocument,
  type AdminUnhandledReportSummaryQuery,
} from '../src/graphql/generated/graphql.ts';
import { success } from './admin-accounts-fixtures.ts';

export type ReportSummaryHandler = (variables: unknown) => Promise<unknown>;

type OpenReportCase = NonNullable<
  AdminProductReportSummaryQuery['adminProductReportSummary']['openCase']
>;

export const unhandledReportSummaryOf = (
  open: number,
  infringementOpen: number,
): AdminUnhandledReportSummaryQuery => ({
  adminUnhandledReportSummary: { open, infringementOpen },
});

export const productReportSummaryOf = (
  reportCount: number,
  openCase: OpenReportCase | null = null,
): AdminProductReportSummaryQuery => ({
  adminProductReportSummary: { reportCount, openCase },
});

// ダッシュボードやプロダクトの詳細を描く他のテストの既定の応答に、通報の件数の照会の応答を足す
export function respondReportSummaries(
  executeGraphQL: Mock,
  {
    unhandled = () => success(unhandledReportSummaryOf(0, 0)),
    product = () => success(productReportSummaryOf(0)),
  }: {
    readonly unhandled?: ReportSummaryHandler;
    readonly product?: ReportSummaryHandler;
  } = {},
): void {
  const fallback = executeGraphQL.getMockImplementation();
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    if (document === AdminUnhandledReportSummaryDocument) {
      return unhandled(variables);
    }
    if (document === AdminProductReportSummaryDocument) {
      return product(variables);
    }
    if (fallback === undefined) {
      throw new Error('想定していない操作が実行されました。');
    }
    return fallback(document, variables) as unknown;
  });
}
