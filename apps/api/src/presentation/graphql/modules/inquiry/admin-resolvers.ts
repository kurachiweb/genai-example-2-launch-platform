import type { InquiryAdminService } from '../../../../application/inquiry/inquiry-admin-service.ts';
import type { InquiryCategoryService } from '../../../../application/inquiry/inquiry-category-service.ts';
import { inquiryError } from '../../../../application/inquiry/inquiry-errors.ts';
import type { InquiryReplyService } from '../../../../application/inquiry/inquiry-reply-service.ts';
import type { InquiryStatusService } from '../../../../application/inquiry/inquiry-status-service.ts';
import { INQUIRY_TYPES } from '../../../../application/inquiry/inquiry-types.ts';
import { requireAdmin } from '../../admin-guard.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import {
  ADMIN_INQUIRIES_ARGS,
  ADMIN_INQUIRY_ARGS,
  CHANGE_INQUIRY_STATUS_ARGS,
  CREATE_INQUIRY_CATEGORY_ARGS,
  DELETE_INQUIRY_CATEGORY_ARGS,
  RENAME_INQUIRY_CATEGORY_ARGS,
  REPLY_TO_INQUIRY_ARGS,
} from './inputs.ts';
import {
  type AdminInquiryModel,
  toAdminInquiry,
  toAdminInquiryCategory,
  toAdminInquiryPage,
  toInquiryCategory,
  toInquiryReplyResult,
} from './mappers.ts';
import { adminOnly, avatarOf, categoryOf } from './resolver-support.ts';

const adminServiceOf = (context: GraphQLContext): InquiryAdminService =>
  context.resolve<InquiryAdminService>(INQUIRY_TYPES.InquiryAdminService);

const categoryServiceOf = (context: GraphQLContext): InquiryCategoryService =>
  context.resolve<InquiryCategoryService>(INQUIRY_TYPES.InquiryCategoryService);

const replyServiceOf = (context: GraphQLContext): InquiryReplyService =>
  context.resolve<InquiryReplyService>(INQUIRY_TYPES.InquiryReplyService);

const statusServiceOf = (context: GraphQLContext): InquiryStatusService =>
  context.resolve<InquiryStatusService>(INQUIRY_TYPES.InquiryStatusService);

// ステータスの変更はステータスと変更日時だけを返すため、メッセージと送った利用者を含む詳細を読み直す
async function reloadedInquiry(
  context: GraphQLContext,
  inquiryId: string,
): Promise<AdminInquiryModel> {
  const view = await adminServiceOf(context).detail(inquiryId);
  if (view === undefined) {
    throw inquiryError('inquiry_not_found');
  }
  return toAdminInquiry(view);
}

// 照会は全ロールの管理者に許し、返信・ステータスの変更・カテゴリの変更はモデレーター以上に限る
export const adminResolvers = {
  Query: {
    adminInquiries: adminOnly(
      withValidatedArgs(
        ADMIN_INQUIRIES_ARGS,
        async (_parent: unknown, { filter, after }, context) => {
          await requireAdmin(context, 'viewer');
          return toAdminInquiryPage(
            await adminServiceOf(context).list(filter, after),
          );
        },
      ),
    ),
    adminInquiry: adminOnly(
      withValidatedArgs(
        ADMIN_INQUIRY_ARGS,
        async (_parent: unknown, { id }, context) => {
          await requireAdmin(context, 'viewer');
          const view = await adminServiceOf(context).detail(id);
          return view === undefined ? null : toAdminInquiry(view);
        },
      ),
    ),
    adminUnhandledInquiryCount: adminOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        await requireAdmin(context, 'viewer');
        return adminServiceOf(context).unhandledCount();
      },
    ),
    adminInquiryCategories: adminOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        await requireAdmin(context, 'viewer');
        const categories = await categoryServiceOf(context).listForAdmin();
        return categories.map(toAdminInquiryCategory);
      },
    ),
  },
  Mutation: {
    replyToInquiry: adminOnly(
      withValidatedArgs(
        REPLY_TO_INQUIRY_ARGS,
        async (_parent: unknown, input, context) => {
          const current = await requireAdmin(context, 'moderator');
          return toInquiryReplyResult(
            await replyServiceOf(context).reply(current, input),
          );
        },
      ),
    ),
    changeInquiryStatus: adminOnly(
      withValidatedArgs(
        CHANGE_INQUIRY_STATUS_ARGS,
        async (_parent: unknown, input, context) => {
          const current = await requireAdmin(context, 'moderator');
          const changed = await statusServiceOf(context).change(current, input);
          return reloadedInquiry(context, changed.inquiry.id);
        },
      ),
    ),
    createInquiryCategory: adminOnly(
      withValidatedArgs(
        CREATE_INQUIRY_CATEGORY_ARGS,
        async (_parent: unknown, input, context) => {
          const current = await requireAdmin(context, 'moderator');
          return toInquiryCategory(
            await categoryServiceOf(context).create(current, input),
          );
        },
      ),
    ),
    renameInquiryCategory: adminOnly(
      withValidatedArgs(
        RENAME_INQUIRY_CATEGORY_ARGS,
        async (_parent: unknown, input, context) => {
          const current = await requireAdmin(context, 'moderator');
          return toInquiryCategory(
            await categoryServiceOf(context).rename(current, input),
          );
        },
      ),
    ),
    deleteInquiryCategory: adminOnly(
      withValidatedArgs(
        DELETE_INQUIRY_CATEGORY_ARGS,
        async (_parent: unknown, input, context) => {
          const current = await requireAdmin(context, 'moderator');
          await categoryServiceOf(context).delete(current, input);
          return true;
        },
      ),
    ),
  },
  AdminInquirySummary: {
    category: (inquiry, _args, context) => categoryOf(inquiry, context),
  },
  AdminInquiry: {
    category: (inquiry, _args, context) => categoryOf(inquiry, context),
  },
  AdminInquiryMember: {
    avatar: (member, _args, context) => avatarOf(member, context),
  },
} satisfies Resolvers;
