import type {
  ProductReportSummary,
  ReportCaseReader,
} from '../../../../application/reporting/ports.ts';
import { REPORTING_TYPES } from '../../../../application/reporting/reporting-types.ts';
import { requireAdmin } from '../../admin-guard.ts';
import type {
  AdminProductReportSummary,
  Resolvers,
} from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { graphqlReportCaseStatusOf } from './enums.ts';
import { ADMIN_PRODUCT_REPORT_SUMMARY_ARGS } from './inputs.ts';
import { adminOnly } from './resolver-support.ts';

const caseReaderOf = (context: GraphQLContext): ReportCaseReader =>
  context.resolve<ReportCaseReader>(REPORTING_TYPES.ReportCaseReader);

const toAdminProductReportSummary = ({
  reportCount,
  openCase,
}: ProductReportSummary): AdminProductReportSummary => ({
  reportCount,
  openCase:
    openCase === null
      ? null
      : {
          id: openCase.caseId,
          status: graphqlReportCaseStatusOf(openCase.status),
        },
});

// 件数はダッシュボードのカードとプロダクトの詳細に出すため、全ロールの管理者に許す
export const summaryResolvers = {
  Query: {
    adminUnhandledReportSummary: adminOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        await requireAdmin(context, 'viewer');
        return caseReaderOf(context).unhandledSummary();
      },
    ),
    adminProductReportSummary: adminOnly(
      withValidatedArgs(
        ADMIN_PRODUCT_REPORT_SUMMARY_ARGS,
        async (_parent: unknown, { productId }, context) => {
          await requireAdmin(context, 'viewer');
          return toAdminProductReportSummary(
            await caseReaderOf(context).productSummary(productId),
          );
        },
      ),
    ),
  },
  Mutation: {},
} satisfies Resolvers;
