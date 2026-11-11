import type { HelpCategoryService } from '../../../../application/help/help-category-service.ts';
import { HELP_TYPES } from '../../../../application/help/help-types.ts';
import type { HelpCategoryRecord } from '../../../../application/help/ports.ts';
import { requireAdmin } from '../../admin-guard.ts';
import type {
  HelpCategory,
  Resolvers,
} from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import {
  CREATE_HELP_CATEGORY_ARGS,
  DELETE_HELP_CATEGORY_ARGS,
  RENAME_HELP_CATEGORY_ARGS,
  REORDER_HELP_CATEGORIES_ARGS,
} from './inputs.ts';
import { adminOnly } from './resolver-support.ts';

const serviceOf = (context: GraphQLContext): HelpCategoryService =>
  context.resolve<HelpCategoryService>(HELP_TYPES.HelpCategoryService);

const toHelpCategory = (record: HelpCategoryRecord): HelpCategory => ({
  id: record.id,
  name: record.name,
  systemDefault: record.systemDefault,
  sortOrder: record.sortOrder,
  articleCount: record.articleCount,
});

// 照会は全ロールの管理者に許し、追加・名前の変更・削除・並べ替えはモデレーター以上に限る
export const adminCategoryResolvers = {
  Query: {
    adminHelpCategories: adminOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        await requireAdmin(context, 'viewer');
        return (await serviceOf(context).list()).map(toHelpCategory);
      },
    ),
  },
  Mutation: {
    createHelpCategory: adminOnly(
      withValidatedArgs(
        CREATE_HELP_CATEGORY_ARGS,
        async (_parent: unknown, input, context) => {
          const current = await requireAdmin(context, 'moderator');
          return toHelpCategory(
            await serviceOf(context).create(current, input),
          );
        },
      ),
    ),
    renameHelpCategory: adminOnly(
      withValidatedArgs(
        RENAME_HELP_CATEGORY_ARGS,
        async (_parent: unknown, input, context) => {
          const current = await requireAdmin(context, 'moderator');
          return toHelpCategory(
            await serviceOf(context).rename(current, input),
          );
        },
      ),
    ),
    deleteHelpCategory: adminOnly(
      withValidatedArgs(
        DELETE_HELP_CATEGORY_ARGS,
        async (_parent: unknown, input, context) => {
          const current = await requireAdmin(context, 'moderator');
          return serviceOf(context).delete(current, input);
        },
      ),
    ),
    reorderHelpCategories: adminOnly(
      withValidatedArgs(
        REORDER_HELP_CATEGORIES_ARGS,
        async (_parent: unknown, input, context) => {
          const current = await requireAdmin(context, 'moderator');
          return (await serviceOf(context).reorder(current, input)).map(
            toHelpCategory,
          );
        },
      ),
    ),
  },
} satisfies Resolvers;
