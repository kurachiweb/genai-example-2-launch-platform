import type { CodegenConfig } from '@graphql-codegen/cli';

const GENERATED_DIR = 'src/presentation/graphql/generated';

const config: CodegenConfig = {
  schema: `${GENERATED_DIR}/schema.graphql`,
  generates: {
    [`${GENERATED_DIR}/resolvers-types.ts`]: {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        useTypeImports: true,
        contextType: '../graphql-context.ts#GraphQLContext',
        scalars: { DateTime: { input: 'number', output: 'number | Date' } },
        strictScalars: true,
        enumsAsTypes: true,
        // 項目のリゾルバが要求されたときだけ読む項目を持たない形を、親の値の型にする
        mappers: {
          Viewer: '../modules/identity/resolver-support.ts#ViewerSource',
          AdminViewer: '../modules/admin/resolver-support.ts#AdminViewerSource',
          AdminAccount:
            '../modules/admin/resolver-support.ts#AdminAccountSource',
          InquiryMessage: '../modules/inquiry/mappers.ts#InquiryMessageModel',
          InquiryReplyAuthor:
            '../modules/inquiry/mappers.ts#InquiryReplyAuthorModel',
          InquiryComposer: '../modules/inquiry/mappers.ts#InquiryComposerModel',
          MemberInquiry: '../modules/inquiry/mappers.ts#MemberInquiryModel',
          MemberInquirySummary:
            '../modules/inquiry/mappers.ts#MemberInquirySummaryModel',
          AdminInquirySummary:
            '../modules/inquiry/mappers.ts#AdminInquirySummaryModel',
          AdminInquiryMember:
            '../modules/inquiry/mappers.ts#AdminInquiryMemberModel',
          AdminInquiry: '../modules/inquiry/mappers.ts#AdminInquiryModel',
          UserSummary: '../modules/profile/user-summary.ts#UserSummarySource',
          PublicProfile: '../modules/profile/mappers.ts#PublicProfileModel',
          PublicProfileRedirect:
            '../modules/profile/mappers.ts#PublicProfileRedirectModel',
          MyProfile: '../modules/profile/mappers.ts#MyProfileModel',
          MyProduct: '../modules/product/mappers.ts#MyProductModel',
          ProductScreenshot:
            '../modules/product/mappers.ts#ProductScreenshotModel',
          Match: '../modules/match/mappers.ts#MatchSource',
          MatchEntry: '../modules/match/mappers.ts#MatchEntrySource',
          MatchProduct: '../modules/match/mappers.ts#MatchProductSource',
          UpvoteHistoryItem:
            '../modules/match/mappers.ts#UpvoteHistoryItemModel',
          DirectoryItem: '../modules/directory/mappers.ts#DirectoryItemModel',
          LaunchHistoryProduct:
            '../modules/product/mappers.ts#LaunchHistoryProductModel',
        },
      },
    },
  },
};

export default config;
