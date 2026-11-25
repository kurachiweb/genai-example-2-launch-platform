import type { ReportCategoryService } from '../../../../application/reporting/ports.ts';
import { REPORTING_TYPES } from '../../../../application/reporting/reporting-types.ts';
import { requireAdmin } from '../../admin-guard.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import {
  CREATE_REPORT_CATEGORY_ARGS,
  DELETE_REPORT_CATEGORY_ARGS,
  RENAME_REPORT_CATEGORY_ARGS,
} from './inputs.ts';
import { adminOnly } from './resolver-support.ts';

const categoryServiceOf = (context: GraphQLContext): ReportCategoryService =>
  context.resolve<ReportCategoryService>(REPORTING_TYPES.ReportCategoryService);

// 照会は全ロールの管理者に許し、追加・名前の変更・削除はモデレーター以上に限る
export const categoryResolvers = {
  Query: {
    adminReportCategories: adminOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        await requireAdmin(context, 'viewer');
        return [...(await categoryServiceOf(context).listForAdmin())];
      },
    ),
  },
  Mutation: {
    createReportCategory: adminOnly(
      withValidatedArgs(
        CREATE_REPORT_CATEGORY_ARGS,
        async (_parent: unknown, input, context) => {
          const current = await requireAdmin(context, 'moderator');
          return categoryServiceOf(context).create(current, input);
        },
      ),
    ),
    renameReportCategory: adminOnly(
      withValidatedArgs(
        RENAME_REPORT_CATEGORY_ARGS,
        async (_parent: unknown, input, context) => {
          const current = await requireAdmin(context, 'moderator');
          return categoryServiceOf(context).rename(current, input);
        },
      ),
    ),
    deleteReportCategory: adminOnly(
      withValidatedArgs(
        DELETE_REPORT_CATEGORY_ARGS,
        async (_parent: unknown, input, context) => {
          const current = await requireAdmin(context, 'moderator');
          return categoryServiceOf(context).delete(current, input);
        },
      ),
    ),
  },
} satisfies Resolvers;
