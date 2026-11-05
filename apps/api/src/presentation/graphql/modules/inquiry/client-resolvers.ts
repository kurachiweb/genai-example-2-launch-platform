import type { GuestInquirySubmission } from '../../../../application/inquiry/guest-inquiry-submission.ts';
import type { InquiryCategoryService } from '../../../../application/inquiry/inquiry-category-service.ts';
import type { InquiryChatService } from '../../../../application/inquiry/inquiry-chat-service.ts';
import { inquiryError } from '../../../../application/inquiry/inquiry-errors.ts';
import { INQUIRY_TYPES } from '../../../../application/inquiry/inquiry-types.ts';
import type { MemberInquirySubmission } from '../../../../application/inquiry/member-inquiry-submission.ts';
import type { InquirerProfiles } from '../../../../application/inquiry/ports.ts';
import { withInputPath } from '../../field-paths.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { mediaFileLoader } from '../media/loaders.ts';
import { toMediaAttachment } from '../media/mappers.ts';
import { INPUT_ARGUMENT } from './errors.ts';
import {
  MEMBER_INQUIRY_ARGS,
  MY_INQUIRIES_ARGS,
  POST_INQUIRY_MESSAGE_ARGS,
  SUBMIT_GUEST_INQUIRY_ARGS,
  SUBMIT_MEMBER_INQUIRY_ARGS,
} from './inputs.ts';
import { inquiryCategoryLoader, inquiryReplyAdminLoader } from './loaders.ts';
import {
  type InquiryComposerModel,
  toInquiryCategory,
  toInquiryComposer,
  toInquiryMessage,
  toInquiryReplyAuthor,
  toMemberInquiry,
  toMemberInquiryPage,
} from './mappers.ts';
import {
  accountGuardOf,
  assertAttachmentCount,
  assertHuman,
  avatarOf,
  clientOnly,
  INQUIRY_BOT_ACTIONS,
  inquiryRequestMetaOf,
} from './resolver-support.ts';

const categoryServiceOf = (context: GraphQLContext): InquiryCategoryService =>
  context.resolve<InquiryCategoryService>(INQUIRY_TYPES.InquiryCategoryService);

const chatServiceOf = (context: GraphQLContext): InquiryChatService =>
  context.resolve<InquiryChatService>(INQUIRY_TYPES.InquiryChatService);

const guestSubmissionOf = (context: GraphQLContext): GuestInquirySubmission =>
  context.resolve<GuestInquirySubmission>(INQUIRY_TYPES.GuestInquirySubmission);

const memberSubmissionOf = (context: GraphQLContext): MemberInquirySubmission =>
  context.resolve<MemberInquirySubmission>(
    INQUIRY_TYPES.MemberInquirySubmission,
  );

// 停止中の利用者の送信は未ログインの問い合わせとして受け付け、アカウントの情報を表示しないため、停止していない利用者にだけ値を返す
async function composerOf(
  context: GraphQLContext,
): Promise<InquiryComposerModel | null> {
  const current = await accountGuardOf(context).currentUser(context.session);
  if (current?.user.status !== 'active') {
    return null;
  }
  const { user } = current;
  const profiles = await context
    .resolve<InquirerProfiles>(INQUIRY_TYPES.InquirerProfiles)
    .findMany([user.id]);
  return toInquiryComposer(
    profiles.get(user.id) ?? { nickname: user.nickname, avatarFileId: null },
  );
}

// 送信は入力の検証→利用者の状態の確認→bot判定→ユースケースの順に行い、トークンを使わずに拒否できる要求でトークンを消費させない
export const clientResolvers = {
  Query: {
    inquiryCategories: clientOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) =>
        (await categoryServiceOf(context).list()).map(toInquiryCategory),
    ),
    inquiryComposer: clientOnly(
      (_parent: unknown, _args: unknown, context: GraphQLContext) =>
        composerOf(context),
    ),
    myInquiries: clientOnly(
      withValidatedArgs(
        MY_INQUIRIES_ARGS,
        async (_parent: unknown, { after }, context) =>
          toMemberInquiryPage(
            await chatServiceOf(context).listMine(context.session, after),
          ),
      ),
    ),
    memberInquiry: clientOnly(
      withValidatedArgs(
        MEMBER_INQUIRY_ARGS,
        async (_parent: unknown, { id }, context) => {
          const view = await chatServiceOf(context).view(context.session, id);
          return view === undefined ? null : toMemberInquiry(view);
        },
      ),
    ),
  },
  Mutation: {
    submitGuestInquiry: clientOnly(
      withValidatedArgs(
        SUBMIT_GUEST_INQUIRY_ARGS,
        async (_parent: unknown, { input }, context) => {
          const current = await accountGuardOf(context).currentUser(
            context.session,
          );
          if (current?.user.status === 'active') {
            throw inquiryError('member_inquiry_required');
          }
          await assertHuman(context, INQUIRY_BOT_ACTIONS.guest);
          await withInputPath(INPUT_ARGUMENT, () =>
            guestSubmissionOf(context).submit(
              context.session,
              input,
              inquiryRequestMetaOf(context),
            ),
          );
          return true;
        },
      ),
    ),
    submitMemberInquiry: clientOnly(
      withValidatedArgs(
        SUBMIT_MEMBER_INQUIRY_ARGS,
        async (_parent: unknown, { input }, context) => {
          const { inquiryId } = await withInputPath(
            INPUT_ARGUMENT,
            async () => {
              assertAttachmentCount(input.fileIds);
              await accountGuardOf(context).requireWritableUser(
                context.session,
              );
              await assertHuman(context, INQUIRY_BOT_ACTIONS.member);
              return memberSubmissionOf(context).submit(
                context.session,
                input,
                inquiryRequestMetaOf(context),
              );
            },
          );
          const view = await chatServiceOf(context).view(
            context.session,
            inquiryId,
          );
          if (view === undefined) {
            throw new Error('送信した問い合わせを読み込めませんでした');
          }
          return toMemberInquiry(view);
        },
      ),
    ),
    postInquiryMessage: clientOnly(
      withValidatedArgs(
        POST_INQUIRY_MESSAGE_ARGS,
        async (_parent: unknown, { inquiryId, input }, context) => {
          const { now } = inquiryRequestMetaOf(context);
          const message = await withInputPath(INPUT_ARGUMENT, () => {
            assertAttachmentCount(input.fileIds);
            return chatServiceOf(context).post(
              context.session,
              inquiryId,
              input,
              now,
            );
          });
          return toInquiryMessage(message);
        },
      ),
    ),
  },
  InquiryMessage: {
    attachments: async (message, _args, context) => {
      const files = await context.loaders
        .get(mediaFileLoader)
        .loadMany(message.fileIds);
      return files.flatMap((file) => {
        if (file instanceof Error) {
          throw file;
        }
        return file === null ? [] : [toMediaAttachment(file)];
      });
    },
    admin: async (message, _args, context) =>
      message.adminId === null
        ? null
        : toInquiryReplyAuthor(
            await context.loaders
              .get(inquiryReplyAdminLoader)
              .load(message.adminId),
          ),
  },
  InquiryReplyAuthor: {
    avatar: (author, _args, context) => avatarOf(author, context),
  },
  InquiryComposer: {
    avatar: (composer, _args, context) => avatarOf(composer, context),
  },
  MemberInquiry: {
    category: async (inquiry, _args, context) =>
      toInquiryCategory(
        await context.loaders
          .get(inquiryCategoryLoader)
          .load(inquiry.categoryId),
      ),
  },
  MemberInquirySummary: {
    category: async (inquiry, _args, context) =>
      toInquiryCategory(
        await context.loaders
          .get(inquiryCategoryLoader)
          .load(inquiry.categoryId),
      ),
  },
} satisfies Resolvers;
