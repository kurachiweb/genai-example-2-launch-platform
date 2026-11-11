import type { HelpArticleStatus } from '../../../../../common-lib/help/help-article-status.ts';
import type {
  AdminHelpArticleRowView,
  AdminHelpArticleView,
  HelpArticleAdminReader,
  HelpHandleAvailabilityResult,
} from '../../../../application/help/help-article-admin-reader.ts';
import type { HelpArticleEditor } from '../../../../application/help/help-article-editor.ts';
import type {
  HelpAuthorLookup,
  HelpAuthorView,
} from '../../../../application/help/help-authors.ts';
import { HELP_TYPES } from '../../../../application/help/help-types.ts';
import type { HelpArticleRecord } from '../../../../application/help/ports.ts';
import { requireAdmin } from '../../admin-guard.ts';
import { withInputPath } from '../../field-paths.ts';
import type {
  HelpArticleHandleAvailability,
  HelpArticleStatus as GraphQLHelpArticleStatus,
  ResolversTypes,
  Resolvers,
} from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { INPUT_FIELDS_PATH } from './errors.ts';
import {
  ADMIN_HELP_ARTICLE_ARGS,
  CREATE_HELP_ARTICLE_ARGS,
  DELETE_HELP_ARTICLE_ARGS,
  HELP_ARTICLE_HANDLE_AVAILABILITY_ARGS,
  REORDER_HELP_ARTICLES_ARGS,
  UPDATE_HELP_ARTICLE_ARGS,
} from './inputs.ts';
import { adminOnly } from './resolver-support.ts';

type AdminHelpArticleModel = ResolversTypes['AdminHelpArticle'];

type AdminHelpArticleRowModel = ResolversTypes['AdminHelpArticleRow'];

const STATUS_TO_GRAPHQL = Object.freeze({
  draft: 'DRAFT',
  published: 'PUBLISHED',
} as const satisfies Record<HelpArticleStatus, GraphQLHelpArticleStatus>);

const AVAILABILITY_TO_GRAPHQL = Object.freeze({
  available: 'AVAILABLE',
  'available-releases-previous': 'AVAILABLE_RELEASES_PREVIOUS',
  unavailable: 'UNAVAILABLE',
  invalid: 'INVALID',
} as const satisfies Record<
  HelpHandleAvailabilityResult,
  HelpArticleHandleAvailability
>);

const editorOf = (context: GraphQLContext): HelpArticleEditor =>
  context.resolve<HelpArticleEditor>(HELP_TYPES.HelpArticleEditor);

const readerOf = (context: GraphQLContext): HelpArticleAdminReader =>
  context.resolve<HelpArticleAdminReader>(HELP_TYPES.HelpArticleAdminReader);

const toAdminHelpArticle = (
  view: AdminHelpArticleView,
): AdminHelpArticleModel => ({
  id: view.id,
  handle: view.handle,
  previousHandle: view.previousHandle,
  title: view.title,
  subtitle: view.subtitle,
  body: view.bodyMarkdown,
  categoryId: view.categoryId,
  categoryName: view.categoryName,
  status: STATUS_TO_GRAPHQL[view.status],
  pinned: view.pinned,
  creator: view.creator,
  revision: view.revision,
  createdAt: view.createdAt,
  updatedAt: view.updatedAt,
});

const toAdminHelpArticleRow = (
  view: AdminHelpArticleRowView,
): AdminHelpArticleRowModel => ({
  id: view.id,
  handle: view.handle,
  title: view.title,
  categoryId: view.categoryId,
  categoryName: view.categoryName,
  status: STATUS_TO_GRAPHQL[view.status],
  pinned: view.pinned,
  sortOrder: view.sortOrder,
  creatorAdminId: view.createdByAdminId,
  creator: view.creator,
  createdAt: view.createdAt,
  updatedAt: view.updatedAt,
});

// 保存と並べ替えのユースケースは作成者の表示を持たないため、照会の結果と同じく作成者の照会口で補う。照会口が返さない管理者は削除済み
async function withCreators<T extends { readonly createdByAdminId: string }>(
  records: readonly T[],
  context: GraphQLContext,
): Promise<(T & { readonly creator: HelpAuthorView | null })[]> {
  const authors = await context
    .resolve<HelpAuthorLookup>(HELP_TYPES.HelpAuthorLookup)
    .find(records.map((record) => record.createdByAdminId));
  return records.map((record) => ({
    ...record,
    creator: authors.get(record.createdByAdminId) ?? null,
  }));
}

async function toSavedArticle(
  record: HelpArticleRecord,
  context: GraphQLContext,
): Promise<AdminHelpArticleModel> {
  const [view] = await withCreators([record], context);
  return toAdminHelpArticle(view ?? { ...record, creator: null });
}

// 照会は全ロールの管理者に許し、作成・編集・削除・並べ替えはモデレーター以上に限る
export const adminArticleResolvers = {
  Query: {
    adminHelpArticles: adminOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        await requireAdmin(context, 'viewer');
        return (await readerOf(context).listAll()).map(toAdminHelpArticleRow);
      },
    ),
    adminHelpArticle: adminOnly(
      withValidatedArgs(
        ADMIN_HELP_ARTICLE_ARGS,
        async (_parent: unknown, { id }, context) => {
          await requireAdmin(context, 'viewer');
          const view = await readerOf(context).find(id);
          return view === undefined ? null : toAdminHelpArticle(view);
        },
      ),
    ),
    helpArticleHandleAvailability: adminOnly(
      withValidatedArgs(
        HELP_ARTICLE_HANDLE_AVAILABILITY_ARGS,
        async (_parent: unknown, { handle, articleId }, context) => {
          await requireAdmin(context, 'viewer');
          return AVAILABILITY_TO_GRAPHQL[
            await readerOf(context).checkHandle(handle, articleId)
          ];
        },
      ),
    ),
  },
  Mutation: {
    createHelpArticle: adminOnly(
      withValidatedArgs(
        CREATE_HELP_ARTICLE_ARGS,
        async (_parent: unknown, { input }, context) => {
          const current = await requireAdmin(context, 'moderator');
          const record = await withInputPath(INPUT_FIELDS_PATH, () =>
            editorOf(context).create(current, input.fields, input.reason),
          );
          return toSavedArticle(record, context);
        },
      ),
    ),
    updateHelpArticle: adminOnly(
      withValidatedArgs(
        UPDATE_HELP_ARTICLE_ARGS,
        async (_parent: unknown, { input }, context) => {
          const current = await requireAdmin(context, 'moderator');
          const record = await withInputPath(INPUT_FIELDS_PATH, () =>
            editorOf(context).update(
              current,
              {
                ...input.fields,
                id: input.id,
                expectedRevision: input.expectedRevision,
              },
              input.reason,
            ),
          );
          return toSavedArticle(record, context);
        },
      ),
    ),
    deleteHelpArticle: adminOnly(
      withValidatedArgs(
        DELETE_HELP_ARTICLE_ARGS,
        async (_parent: unknown, input, context) => {
          const current = await requireAdmin(context, 'moderator');
          await editorOf(context).delete(current, input);
          return { id: input.id };
        },
      ),
    ),
    reorderHelpArticles: adminOnly(
      withValidatedArgs(
        REORDER_HELP_ARTICLES_ARGS,
        async (_parent: unknown, input, context) => {
          const current = await requireAdmin(context, 'moderator');
          const articles = await editorOf(context).reorder(current, input);
          return (await withCreators(articles, context)).map(
            toAdminHelpArticleRow,
          );
        },
      ),
    ),
  },
} satisfies Resolvers;
