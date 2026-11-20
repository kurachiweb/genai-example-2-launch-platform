/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
/** 管理者の一覧に示す状態 */
export type AdminAccountStatus =
  | 'ACTIVE'
  | 'INVITATION_EXPIRED'
  | 'INVITED';

/** コメントの一覧の絞り込み。投稿日時はpostedFromを含みpostedBeforeを含まない */
export type AdminCommentFilter = {
  authorHandle?: string | null | undefined;
  postedBefore?: string | null | undefined;
  postedFrom?: string | null | undefined;
  productHandle?: string | null | undefined;
  state?: AdminCommentState | null | undefined;
};

/** 管理画面のコメントの状態 */
export type AdminCommentState =
  | 'ANONYMIZED'
  | 'AUTHOR_UNAVAILABLE'
  | 'DELETED'
  | 'HIDDEN'
  | 'SHOWN';

/** 管理画面の問い合わせの一覧の絞り込み */
export type AdminInquiryFilterInput = {
  categoryId?: string | number | null | undefined;
  kind?: InquiryKind | null | undefined;
  /** この日時を含まない以前の受付 */
  receivedBefore?: string | null | undefined;
  /** この日時を含む以降の受付 */
  receivedFrom?: string | null | undefined;
  status?: InquiryStatus | null | undefined;
};

/** プロダクトの一覧の絞り込み。指定した条件を全て満たすプロダクトを返す */
export type AdminProductFilter = {
  categoryId?: string | number | null | undefined;
  handle?: string | null | undefined;
  launchState?: AdminProductLaunchState | null | undefined;
  name?: string | null | undefined;
  ownerHandle?: string | null | undefined;
  visibility?: AdminProductVisibility | null | undefined;
};

/** プロダクトの最新のローンチの状態 */
export type AdminProductLaunchState =
  | 'CANCELED'
  | 'IN_PROGRESS'
  | 'LOST'
  | 'SCHEDULED'
  | 'WON';

/** プロダクトの公開状態 */
export type AdminProductVisibility =
  | 'HIDDEN'
  | 'OWNER_SUSPENDED'
  | 'VISIBLE';

/** 評価の一覧の絞り込み */
export type AdminRatingFilter = {
  productHandle?: string | null | undefined;
  raterHandle?: string | null | undefined;
  state?: AdminRatingState | null | undefined;
};

/** 管理画面の評価の状態 */
export type AdminRatingState =
  | 'INVALIDATED'
  | 'VALID';

/** 重要な操作の本人確認 */
export type AdminReAuthenticationInput = {
  /** 本人確認に使う現在のパスワード */
  currentPassword: string;
  secondFactor: AdminSecondFactorInput;
};

/** 管理者のロール */
export type AdminRole =
  | 'MODERATOR'
  | 'SUPER_ADMIN'
  | 'VIEWER';

/** 認証コードかリカバリコードのどちらか一方 */
export type AdminSecondFactorInput = {
  recoveryCode?: string | null | undefined;
  totpCode?: string | null | undefined;
};

/** 管理画面の一覧の絞り込み。省略した条件は絞り込まない */
export type AdminSponsorshipFilter = {
  status?: AdminSponsorshipStatusFilter | null | undefined;
  tier?: SponsorshipTier | null | undefined;
};

/** 管理画面の一覧の掲載状況の絞り込み。表示停止中は掲載予定・掲載中に含む */
export type AdminSponsorshipStatusFilter =
  | 'ACTIVE'
  | 'ENDED'
  | 'PENDING_PAYMENT'
  | 'SCHEDULED'
  | 'TERMINATED';

/** ユーザーの一覧の絞り込み。指定した条件を全て満たす利用者を返す */
export type AdminUserFilter = {
  /** 大文字小文字を区別しない完全一致 */
  email?: string | null | undefined;
  /** 大文字小文字を区別しない部分一致 */
  handle?: string | null | undefined;
  /** 大文字小文字を区別しない部分一致 */
  nickname?: string | null | undefined;
  status?: AdminUserStatus | null | undefined;
};

/** 管理画面の利用者の停止状態 */
export type AdminUserStatus =
  | 'ACTIVE'
  | 'SUSPENDED';

/** 代理の退会の入力 */
export type AdministrativeWithdrawalInput = {
  reason: string;
  userId: string | number;
};

/** 監査ログの絞り込みの条件。指定した条件をすべて満たすものだけを返す */
export type AuditLogFilterInput = {
  action?: string | null | undefined;
  /** この日時を含まない */
  occurredBefore?: string | null | undefined;
  /** この日時を含む */
  occurredFrom?: string | null | undefined;
  operatorId?: string | number | null | undefined;
  targetId?: string | null | undefined;
};

export type CreateHelpArticleInput = {
  fields: HelpArticleFields;
  reason?: string | null | undefined;
};

/** 下書きの破棄 */
export type DiscardLegalDocumentDraftInput = {
  expectedStateVersion: number;
  kind: LegalDocumentKind;
};

/** 使い捨てメールアドレスの判定結果。UNVERIFIEDはメールアドレスの確認を済ませていない利用者 */
export type DisposableEmailCheck =
  | 'DISPOSABLE'
  | 'REGULAR'
  | 'UNDETERMINED'
  | 'UNVERIFIED';

export type HelpArticleFields = {
  body: string;
  categoryId: string | number;
  handle: string;
  pinned: boolean;
  status: HelpArticleStatus;
  subtitle: string;
  title: string;
};

export type HelpArticleHandleAvailability =
  | 'AVAILABLE'
  /** 他の記事の旧ハンドルと一致する。保存するとその記事の旧URLの転送が無くなる */
  | 'AVAILABLE_RELEASES_PREVIOUS'
  | 'INVALID'
  | 'UNAVAILABLE';

export type HelpArticleStatus =
  | 'DRAFT'
  | 'PUBLISHED';

/** 問い合わせの種別 */
export type InquiryKind =
  | 'GUEST'
  | 'MEMBER';

/** メッセージの送信者の種類 */
export type InquirySender =
  | 'ADMIN'
  | 'USER';

/** 対応ステータス */
export type InquiryStatus =
  | 'IN_PROGRESS'
  | 'OPEN'
  | 'REJECTED'
  | 'RESOLVED';

/** 法務文書の種類 */
export type LegalDocumentKind =
  | 'LEGAL_NOTICE'
  | 'PRIVACY'
  | 'TERMS';

/** AVIF・WebPに非対応のブラウザ向けの形式。原本がJPEGならJPG、SVGならSVG(SVGはこの形式だけで表示する)、それ以外はPNG */
export type MediaImageFallbackFormat =
  | 'JPG'
  | 'PNG'
  | 'SVG';

/** プロダクトカテゴリの追加・変更の項目 */
export type ProductCategoryInput = {
  /** プロダクトのハンドルと同じ形式で50文字以内 */
  handle: string;
  /** 前後の空白を除いて1〜30文字 */
  name: string;
};

/** 下書きの公開 */
export type PublishLegalDocumentInput = {
  changeSummary: string;
  expectedStateVersion: number;
  kind: LegalDocumentKind;
};

/** 画像の隔離理由 */
export type QuarantineReason =
  | 'ADMIN_ACTION'
  | 'AUTO'
  | 'PRODUCT_HIDDEN'
  | 'USER_SUSPENDED';

/** 下書きの保存 */
export type SaveLegalDocumentDraftInput = {
  body: string;
  expectedStateVersion: number;
  kind: LegalDocumentKind;
};

/** 依頼した返金の状態。REQUESTEDは依頼済み、ALREADY_REFUNDEDは返金できる残りが無く返金済み、REJECTEDは拒否 */
export type SponsorshipRefundStatus =
  | 'ALREADY_REFUNDED'
  | 'REJECTED'
  | 'REQUESTED';

/** 掲載状況。PAUSEDはプロダクトの非公開化か投稿者の停止による表示停止中 */
export type SponsorshipStatus =
  | 'ACTIVE'
  | 'ENDED'
  | 'PAUSED'
  | 'PENDING_PAYMENT'
  | 'SCHEDULED'
  | 'TERMINATED';

/** スポンサー広告のティア */
export type SponsorshipTier =
  | 'GOLD'
  | 'LEGEND'
  | 'SILVER';

export type UpdateHelpArticleInput = {
  expectedRevision: number;
  fields: HelpArticleFields;
  id: string | number;
  reason?: string | null | undefined;
};

/** 送信者情報の保存の入力 */
export type UpdateNotificationSenderInfoInput = {
  businessName: string;
  contactEmail: string;
  /** 照会で読み取った版。最新と一致しなければversion_conflict */
  expectedVersion: number;
  postalAddress: string;
  /** 監査ログに残す理由(任意) */
  reason?: string | null | undefined;
};

/** 機能フラグの変更の入力 */
export type UpdateUltrasPromotionSettingInput = {
  enabled: boolean;
  /** 照会で読み取った版。最新と一致しなければversion_conflict */
  expectedVersion: number;
  /** 監査ログに残す理由(任意) */
  reason?: string | null | undefined;
};

/** 決勝実施日の保存の入力 */
export type UpdateYearFinalDateInput = {
  /** 照会で読み取った版 */
  expectedVersion: number;
  /** 決勝実施日(業務日付のYYYY-MM-DD) */
  finalDate: string;
  /** 監査ログに残す理由(500文字以内、任意) */
  reason?: string | null | undefined;
  /** 対象年(現在の年か翌年) */
  year: number;
};

/** 決勝実施日の決まり方。EXPLICITは最上位管理者が設定した日、DEFAULTは対象年5月の最終日曜日 */
export type YearFinalDateSource =
  | 'DEFAULT'
  | 'EXPLICIT';

export type AdminHelpArticleRowFragment = { id: string, handle: string, title: string, categoryId: string, categoryName: string, status: HelpArticleStatus, pinned: boolean, sortOrder: number, creatorAdminId: string, createdAt: string, updatedAt: string, creator: { nickname: string, title: string | null, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null };

export type AdminHelpArticleFragment = { id: string, handle: string, previousHandle: string | null, title: string, subtitle: string, body: string, categoryId: string, categoryName: string, status: HelpArticleStatus, pinned: boolean, revision: number, createdAt: string, updatedAt: string, creator: { nickname: string, title: string | null, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null };

export type HelpCategoryFragment = { id: string, name: string, systemDefault: boolean, sortOrder: number, articleCount: number };

export type AdminModerationMediaFileFragment = { id: string, path: string, quarantined: boolean, quarantineReasons: Array<QuarantineReason> };

export type AdminModerationNoteFragment = { reason: string | null, occurredAt: string };

export type AdminModerationProductFragment = { id: string, handle: string, name: string, latestLaunchDate: string | null, latestLaunchState: AdminProductLaunchState | null, visibility: AdminProductVisibility, logo: { id: string, path: string, quarantined: boolean, quarantineReasons: Array<QuarantineReason> } | null, owner: { id: string, handle: string, nickname: string, suspended: boolean } | null, category: { id: string, name: string } };

export type AdminModerationRatingFragment = { id: string, productName: string | null, productId: string, score: number, createdAt: string, updatedAt: string, state: AdminRatingState, rater: { id: string, handle: string, nickname: string, suspended: boolean } | null, latestInvalidation: { reason: string | null, occurredAt: string } | null };

export type AdminModerationUserSummaryFragment = { id: string, handle: string, nickname: string, suspended: boolean };

export type AdminAccountsQueryVariables = Exact<{ [key: string]: never; }>;


export type AdminAccountsQuery = { adminAccounts: Array<{ id: string, email: string, nickname: string | null, title: string | null, role: AdminRole, status: AdminAccountStatus, createdAt: string, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null }> };

export type AdminChangeRoleMutationVariables = Exact<{
  id: string | number;
  role: AdminRole;
  reason?: string | null | undefined;
}>;


export type AdminChangeRoleMutation = { changeAdminRole: { id: string, email: string, nickname: string | null, title: string | null, role: AdminRole, status: AdminAccountStatus, createdAt: string, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } };

export type AdminDeleteMutationVariables = Exact<{
  id: string | number;
  reason?: string | null | undefined;
}>;


export type AdminDeleteMutation = { deleteAdmin: boolean };

export type AdminInviteMutationVariables = Exact<{
  email: string;
  reason?: string | null | undefined;
}>;


export type AdminInviteMutation = { inviteAdmin: { id: string, email: string, nickname: string | null, title: string | null, role: AdminRole, status: AdminAccountStatus, createdAt: string, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } };

export type AdminResendInvitationMutationVariables = Exact<{
  id: string | number;
  reason?: string | null | undefined;
}>;


export type AdminResendInvitationMutation = { resendAdminInvitation: { id: string, email: string, nickname: string | null, title: string | null, role: AdminRole, status: AdminAccountStatus, createdAt: string, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } };

export type AdminUpdateProfileMutationVariables = Exact<{
  id: string | number;
  nickname: string;
  title?: string | null | undefined;
  avatarFileId?: string | number | null | undefined;
}>;


export type AdminUpdateProfileMutation = { updateAdminProfile: { id: string, email: string, nickname: string | null, title: string | null, role: AdminRole, status: AdminAccountStatus, createdAt: string, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } };

export type AdminAuditLogsQueryVariables = Exact<{
  filter?: AuditLogFilterInput | null | undefined;
  after?: string | null | undefined;
}>;


export type AdminAuditLogsQuery = { auditLogs: { nextCursor: string | null, entries: Array<{ id: string, occurredAt: string, action: string, actionLabel: string, targetKind: string | null, targetIds: Array<string>, reason: string | null, operator: { id: string, nickname: string | null }, detail: Array<{ key: string, value: string }> }> } };

export type AdminCompleteInvitationMutationVariables = Exact<{
  token: string;
  totpCode: string;
}>;


export type AdminCompleteInvitationMutation = { completeAdminInvitation: { codes: Array<string> } };

export type AdminCompleteSecondFactorLoginMutationVariables = Exact<{
  challenge: string;
  secondFactor: AdminSecondFactorInput;
}>;


export type AdminCompleteSecondFactorLoginMutation = { completeAdminSecondFactorLogin: { id: string, nickname: string, title: string | null, email: string, role: AdminRole, remainingRecoveryCodes: number, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } };

export type AdminConfirmEmailChangeMutationVariables = Exact<{
  token: string;
}>;


export type AdminConfirmEmailChangeMutation = { confirmAdminEmailChange: { viewer: { id: string, nickname: string, title: string | null, email: string, role: AdminRole, remainingRecoveryCodes: number, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null } };

export type AdminLoginMutationVariables = Exact<{
  email: string;
  password: string;
}>;


export type AdminLoginMutation = { adminLogin: { challenge: string, expiresAt: string } };

export type AdminLogoutMutationVariables = Exact<{ [key: string]: never; }>;


export type AdminLogoutMutation = { adminLogout: boolean };

export type AdminRequestPasswordResetMutationVariables = Exact<{
  email: string;
}>;


export type AdminRequestPasswordResetMutation = { requestAdminPasswordReset: boolean };

export type AdminResetPasswordMutationVariables = Exact<{
  token: string;
  newPassword: string;
}>;


export type AdminResetPasswordMutation = { resetAdminPassword: boolean };

export type AdminStartInvitationMutationVariables = Exact<{
  token: string;
  nickname: string;
  password: string;
}>;


export type AdminStartInvitationMutation = { startAdminInvitation: { otpauthUri: string, secret: string, expiresAt: string } };

export type AdminInquiryCategoriesQueryVariables = Exact<{ [key: string]: never; }>;


export type AdminInquiryCategoriesQuery = { adminInquiryCategories: Array<{ id: string, name: string, systemDefault: boolean, linkedCount: number }> };

export type AdminCreateInquiryCategoryMutationVariables = Exact<{
  name: string;
}>;


export type AdminCreateInquiryCategoryMutation = { createInquiryCategory: { id: string } };

export type AdminDeleteInquiryCategoryMutationVariables = Exact<{
  id: string | number;
}>;


export type AdminDeleteInquiryCategoryMutation = { deleteInquiryCategory: boolean };

export type AdminRenameInquiryCategoryMutationVariables = Exact<{
  id: string | number;
  name: string;
}>;


export type AdminRenameInquiryCategoryMutation = { renameInquiryCategory: { id: string } };

export type AdminInquiryCategoryOptionsQueryVariables = Exact<{ [key: string]: never; }>;


export type AdminInquiryCategoryOptionsQuery = { adminInquiryCategories: Array<{ id: string, name: string }> };

export type AdminChangeInquiryStatusMutationVariables = Exact<{
  inquiryId: string | number;
  status: InquiryStatus;
  reason?: string | null | undefined;
}>;


export type AdminChangeInquiryStatusMutation = { changeInquiryStatus: { id: string, status: InquiryStatus, statusChangedAt: string } };

export type AdminInquiriesQueryVariables = Exact<{
  filter?: AdminInquiryFilterInput | null | undefined;
  after?: string | null | undefined;
}>;


export type AdminInquiriesQuery = { adminInquiries: { nextCursor: string | null, entries: Array<{ id: string, kind: InquiryKind, status: InquiryStatus, senderName: string, withdrawn: boolean, createdAt: string, lastMessageAt: string, category: { id: string, name: string } }> } };

export type AdminInquiryQueryVariables = Exact<{
  id: string | number;
}>;


export type AdminInquiryQuery = { adminInquiry: { id: string, kind: InquiryKind, status: InquiryStatus, statusChangedAt: string, withdrawn: boolean, createdAt: string, lastMessageAt: string, category: { id: string, name: string }, member: { userId: string, nickname: string, handle: string, avatar: { objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null, guest: { nickname: string, email: string, body: string } | null, messages: Array<{ id: string, sender: InquirySender, body: string, createdAt: string, attachments: Array<{ id: string, originalFileName: string, contentType: string, byteSize: number }>, admin: { nickname: string | null, deleted: boolean, avatar: { objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null }> } | null };

export type AdminReplyToInquiryMutationVariables = Exact<{
  inquiryId: string | number;
  body: string;
  reason?: string | null | undefined;
}>;


export type AdminReplyToInquiryMutation = { replyToInquiry: { notificationQueued: boolean, message: { id: string } } };

export type AdminUnhandledInquiryCountQueryVariables = Exact<{ [key: string]: never; }>;


export type AdminUnhandledInquiryCountQuery = { adminUnhandledInquiryCount: number };

export type AdminChangePasswordMutationVariables = Exact<{
  newPassword: string;
  reAuthentication: AdminReAuthenticationInput;
}>;


export type AdminChangePasswordMutation = { changeAdminPassword: boolean };

export type AdminCompleteTotpResetMutationVariables = Exact<{
  totpCode: string;
}>;


export type AdminCompleteTotpResetMutation = { completeAdminTotpReset: { codes: Array<string> } };

export type AdminRegenerateRecoveryCodesMutationVariables = Exact<{
  reAuthentication: AdminReAuthenticationInput;
}>;


export type AdminRegenerateRecoveryCodesMutation = { regenerateAdminRecoveryCodes: { codes: Array<string> } };

export type AdminRequestEmailChangeMutationVariables = Exact<{
  newEmail: string;
  reAuthentication: AdminReAuthenticationInput;
}>;


export type AdminRequestEmailChangeMutation = { requestAdminEmailChange: boolean };

export type AdminStartTotpResetMutationVariables = Exact<{
  reAuthentication: AdminReAuthenticationInput;
}>;


export type AdminStartTotpResetMutation = { startAdminTotpReset: { otpauthUri: string, secret: string, expiresAt: string } };

export type AdminViewerQueryVariables = Exact<{ [key: string]: never; }>;


export type AdminViewerQuery = { adminViewer: { id: string, nickname: string, title: string | null, email: string, role: AdminRole, remainingRecoveryCodes: number, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null };

export type AdminHelpArticleQueryVariables = Exact<{
  id: string | number;
}>;


export type AdminHelpArticleQuery = { adminHelpArticle: { id: string, handle: string, previousHandle: string | null, title: string, subtitle: string, body: string, categoryId: string, categoryName: string, status: HelpArticleStatus, pinned: boolean, revision: number, createdAt: string, updatedAt: string, creator: { nickname: string, title: string | null, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null } | null };

export type AdminHelpArticlesQueryVariables = Exact<{ [key: string]: never; }>;


export type AdminHelpArticlesQuery = { adminHelpArticles: Array<{ id: string, handle: string, title: string, categoryId: string, categoryName: string, status: HelpArticleStatus, pinned: boolean, sortOrder: number, creatorAdminId: string, createdAt: string, updatedAt: string, creator: { nickname: string, title: string | null, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null }> };

export type AdminCreateHelpArticleMutationVariables = Exact<{
  input: CreateHelpArticleInput;
}>;


export type AdminCreateHelpArticleMutation = { createHelpArticle: { id: string, handle: string, previousHandle: string | null, title: string, subtitle: string, body: string, categoryId: string, categoryName: string, status: HelpArticleStatus, pinned: boolean, revision: number, createdAt: string, updatedAt: string, creator: { nickname: string, title: string | null, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null } };

export type AdminDeleteHelpArticleMutationVariables = Exact<{
  id: string | number;
  reason?: string | null | undefined;
}>;


export type AdminDeleteHelpArticleMutation = { deleteHelpArticle: { id: string } };

export type AdminHelpArticleHandleAvailabilityQueryVariables = Exact<{
  handle: string;
  articleId?: string | number | null | undefined;
}>;


export type AdminHelpArticleHandleAvailabilityQuery = { helpArticleHandleAvailability: HelpArticleHandleAvailability };

export type AdminReorderHelpArticlesMutationVariables = Exact<{
  categoryId: string | number;
  orderedIds: Array<string | number> | string | number;
}>;


export type AdminReorderHelpArticlesMutation = { reorderHelpArticles: Array<{ id: string, handle: string, title: string, categoryId: string, categoryName: string, status: HelpArticleStatus, pinned: boolean, sortOrder: number, creatorAdminId: string, createdAt: string, updatedAt: string, creator: { nickname: string, title: string | null, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null }> };

export type AdminUpdateHelpArticleMutationVariables = Exact<{
  input: UpdateHelpArticleInput;
}>;


export type AdminUpdateHelpArticleMutation = { updateHelpArticle: { id: string, handle: string, previousHandle: string | null, title: string, subtitle: string, body: string, categoryId: string, categoryName: string, status: HelpArticleStatus, pinned: boolean, revision: number, createdAt: string, updatedAt: string, creator: { nickname: string, title: string | null, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null } };

export type AdminHelpCategoriesQueryVariables = Exact<{ [key: string]: never; }>;


export type AdminHelpCategoriesQuery = { adminHelpCategories: Array<{ id: string, name: string, systemDefault: boolean, sortOrder: number, articleCount: number }> };

export type AdminCreateHelpCategoryMutationVariables = Exact<{
  name: string;
}>;


export type AdminCreateHelpCategoryMutation = { createHelpCategory: { id: string, name: string, systemDefault: boolean, sortOrder: number, articleCount: number } };

export type AdminDeleteHelpCategoryMutationVariables = Exact<{
  id: string | number;
}>;


export type AdminDeleteHelpCategoryMutation = { deleteHelpCategory: { id: string, reassignedCount: number } };

export type AdminRenameHelpCategoryMutationVariables = Exact<{
  id: string | number;
  name: string;
}>;


export type AdminRenameHelpCategoryMutation = { renameHelpCategory: { id: string, name: string, systemDefault: boolean, sortOrder: number, articleCount: number } };

export type AdminReorderHelpCategoriesMutationVariables = Exact<{
  orderedIds: Array<string | number> | string | number;
}>;


export type AdminReorderHelpCategoriesMutation = { reorderHelpCategories: Array<{ id: string, name: string, systemDefault: boolean, sortOrder: number, articleCount: number }> };

export type AdminDiscardLegalDocumentDraftMutationVariables = Exact<{
  input: DiscardLegalDocumentDraftInput;
}>;


export type AdminDiscardLegalDocumentDraftMutation = { discardLegalDocumentDraft: { kind: LegalDocumentKind, stateVersion: number, latestBody: string | null, draft: { body: string, savedAt: string, savedBy: { id: string, nickname: string | null } } | null, revisions: Array<{ versionNumber: number, publishedAt: string, changeSummary: string, publishedBy: { id: string, nickname: string | null } }> } };

export type AdminLegalDocumentVersionQueryVariables = Exact<{
  kind: LegalDocumentKind;
  versionNumber: number;
}>;


export type AdminLegalDocumentVersionQuery = { adminLegalDocumentVersion: { kind: LegalDocumentKind, versionNumber: number, publishedAt: string, changeSummary: string, body: string, isLatest: boolean, publishedBy: { id: string, nickname: string | null } } | null };

export type AdminLegalDocumentQueryVariables = Exact<{
  kind: LegalDocumentKind;
}>;


export type AdminLegalDocumentQuery = { adminLegalDocument: { kind: LegalDocumentKind, stateVersion: number, latestBody: string | null, draft: { body: string, savedAt: string, savedBy: { id: string, nickname: string | null } } | null, revisions: Array<{ versionNumber: number, publishedAt: string, changeSummary: string, publishedBy: { id: string, nickname: string | null } }> } };

export type AdminLegalDocumentsQueryVariables = Exact<{ [key: string]: never; }>;


export type AdminLegalDocumentsQuery = { adminLegalDocuments: Array<{ kind: LegalDocumentKind, latestVersionNumber: number | null, latestPublishedAt: string | null, hasDraft: boolean }> };

export type AdminPublishLegalDocumentMutationVariables = Exact<{
  input: PublishLegalDocumentInput;
}>;


export type AdminPublishLegalDocumentMutation = { publishLegalDocument: { kind: LegalDocumentKind, stateVersion: number, latestBody: string | null, draft: { body: string, savedAt: string, savedBy: { id: string, nickname: string | null } } | null, revisions: Array<{ versionNumber: number, publishedAt: string, changeSummary: string, publishedBy: { id: string, nickname: string | null } }> } };

export type AdminSaveLegalDocumentDraftMutationVariables = Exact<{
  input: SaveLegalDocumentDraftInput;
}>;


export type AdminSaveLegalDocumentDraftMutation = { saveLegalDocumentDraft: { kind: LegalDocumentKind, stateVersion: number, latestBody: string | null, draft: { body: string, savedAt: string, savedBy: { id: string, nickname: string | null } } | null, revisions: Array<{ versionNumber: number, publishedAt: string, changeSummary: string, publishedBy: { id: string, nickname: string | null } }> } };

export type AdminApproveQuarantinedImageMutationVariables = Exact<{
  fileId: string | number;
  reason?: string | null | undefined;
}>;


export type AdminApproveQuarantinedImageMutation = { approveQuarantinedImage: { changed: boolean } };

export type AdminCommentsQueryVariables = Exact<{
  filter?: AdminCommentFilter | null | undefined;
  first: number;
  after?: string | null | undefined;
}>;


export type AdminCommentsQuery = { adminComments: { nodes: Array<{ id: string, excerpt: string, productName: string | null, productId: string, launchId: string, launchNumber: number | null, createdAt: string, state: AdminCommentState, author: { id: string, handle: string, nickname: string, suspended: boolean } | null, latestHide: { reason: string | null, occurredAt: string } | null }>, pageInfo: { hasNextPage: boolean, endCursor: string | null } } };

export type AdminDeleteQuarantinedImageMutationVariables = Exact<{
  fileId: string | number;
  reason?: string | null | undefined;
}>;


export type AdminDeleteQuarantinedImageMutation = { deleteQuarantinedImage: { changed: boolean } };

export type AdminHideCommentMutationVariables = Exact<{
  id: string | number;
  reason: string;
}>;


export type AdminHideCommentMutation = { hideComment: { changed: boolean } };

export type AdminHideProductMutationVariables = Exact<{
  id: string | number;
  reason: string;
}>;


export type AdminHideProductMutation = { hideProduct: { changed: boolean } };

export type AdminInvalidateRatingMutationVariables = Exact<{
  id: string | number;
  reason: string;
}>;


export type AdminInvalidateRatingMutation = { invalidateRating: { changed: boolean } };

export type AdminModerationCategoryOptionsQueryVariables = Exact<{ [key: string]: never; }>;


export type AdminModerationCategoryOptionsQuery = { adminModerationCategoryOptions: Array<{ id: string, name: string }> };

export type AdminProductRatingsQueryVariables = Exact<{
  productId: string | number;
  first: number;
  after?: string | null | undefined;
}>;


export type AdminProductRatingsQuery = { adminProductRatings: { nodes: Array<{ id: string, productName: string | null, productId: string, score: number, createdAt: string, updatedAt: string, state: AdminRatingState, rater: { id: string, handle: string, nickname: string, suspended: boolean } | null, latestInvalidation: { reason: string | null, occurredAt: string } | null }>, pageInfo: { hasNextPage: boolean, endCursor: string | null } } };

export type AdminProductQueryVariables = Exact<{
  id: string | number;
}>;


export type AdminProductQuery = { adminProduct: { tagline: string, descriptionMarkdown: string, websiteUrl: string, hiddenAt: string | null, product: { id: string, handle: string, name: string, latestLaunchDate: string | null, latestLaunchState: AdminProductLaunchState | null, visibility: AdminProductVisibility, logo: { id: string, path: string, quarantined: boolean, quarantineReasons: Array<QuarantineReason> } | null, owner: { id: string, handle: string, nickname: string, suspended: boolean } | null, category: { id: string, name: string } }, screenshots: Array<{ id: string, path: string, quarantined: boolean, quarantineReasons: Array<QuarantineReason> }>, latestHide: { reason: string | null, occurredAt: string } | null, ratingSummary: { average: number | null, count: number }, launches: Array<{ id: string, number: number, launchDate: string, status: string, matches: Array<{ id: string, kind: string, round: number | null, stage: string | null, matchDate: string, upvoteCount: number, result: string | null, opponentName: string | null }> }> } | null };

export type AdminProductsQueryVariables = Exact<{
  filter?: AdminProductFilter | null | undefined;
  first: number;
  after?: string | null | undefined;
}>;


export type AdminProductsQuery = { adminProducts: { nodes: Array<{ id: string, handle: string, name: string, latestLaunchDate: string | null, latestLaunchState: AdminProductLaunchState | null, visibility: AdminProductVisibility, logo: { id: string, path: string, quarantined: boolean, quarantineReasons: Array<QuarantineReason> } | null, owner: { id: string, handle: string, nickname: string, suspended: boolean } | null, category: { id: string, name: string } }>, pageInfo: { hasNextPage: boolean, endCursor: string | null } } };

export type AdminQuarantineImageMutationVariables = Exact<{
  fileId: string | number;
  reason?: string | null | undefined;
}>;


export type AdminQuarantineImageMutation = { quarantineImage: { changed: boolean } };

export type AdminQuarantinedImagesQueryVariables = Exact<{
  reason: QuarantineReason;
  after?: string | null | undefined;
}>;


export type AdminQuarantinedImagesQuery = { adminQuarantinedImages: { nextCursor: string | null, items: Array<{ purpose: string, quarantinedAt: string, findings: Array<string>, file: { id: string, path: string, quarantined: boolean, quarantineReasons: Array<QuarantineReason> }, owner: { kind: string, id: string, nickname: string | null, handle: string | null } | null }> } };

export type AdminRatingsQueryVariables = Exact<{
  filter?: AdminRatingFilter | null | undefined;
  first: number;
  after?: string | null | undefined;
}>;


export type AdminRatingsQuery = { adminRatings: { nodes: Array<{ id: string, productName: string | null, productId: string, score: number, createdAt: string, updatedAt: string, state: AdminRatingState, rater: { id: string, handle: string, nickname: string, suspended: boolean } | null, latestInvalidation: { reason: string | null, occurredAt: string } | null }>, pageInfo: { hasNextPage: boolean, endCursor: string | null } } };

export type AdminReleaseQuarantinedImageMutationVariables = Exact<{
  fileId: string | number;
  reason?: string | null | undefined;
}>;


export type AdminReleaseQuarantinedImageMutation = { releaseQuarantinedImage: { changed: boolean } };

export type AdminRevalidateRatingMutationVariables = Exact<{
  id: string | number;
  reason: string;
}>;


export type AdminRevalidateRatingMutation = { revalidateRating: { changed: boolean } };

export type AdminSuspendUserMutationVariables = Exact<{
  id: string | number;
  reason: string;
}>;


export type AdminSuspendUserMutation = { suspendUser: { changed: boolean } };

export type AdminUnhideCommentMutationVariables = Exact<{
  id: string | number;
  reason: string;
}>;


export type AdminUnhideCommentMutation = { unhideComment: { changed: boolean } };

export type AdminUnhideProductMutationVariables = Exact<{
  id: string | number;
  reason: string;
}>;


export type AdminUnhideProductMutation = { unhideProduct: { changed: boolean } };

export type AdminUnsuspendUserMutationVariables = Exact<{
  id: string | number;
  reason: string;
}>;


export type AdminUnsuspendUserMutation = { unsuspendUser: { changed: boolean } };

export type AdminUsersQueryVariables = Exact<{
  filter?: AdminUserFilter | null | undefined;
  first: number;
  after?: string | null | undefined;
}>;


export type AdminUsersQuery = { adminUsers: { nodes: Array<{ id: string, handle: string, nickname: string, registeredAt: string, disposableEmail: DisposableEmailCheck, status: AdminUserStatus, suspendedAt: string | null, avatar: { id: string, path: string, quarantined: boolean, quarantineReasons: Array<QuarantineReason> } | null, latestSuspension: { reason: string | null, occurredAt: string } | null }>, pageInfo: { hasNextPage: boolean, endCursor: string | null } } };

export type AdminWithdrawUserByAdministratorMutationVariables = Exact<{
  input: AdministrativeWithdrawalInput;
}>;


export type AdminWithdrawUserByAdministratorMutation = { withdrawUserByAdministrator: { changed: boolean } };

export type AdminNotificationSenderInfoQueryVariables = Exact<{ [key: string]: never; }>;


export type AdminNotificationSenderInfoQuery = { notificationSenderInfo: { version: number, updatedAt: string | null, updatedByNickname: string | null, info: { businessName: string, contactEmail: string, postalAddress: string } | null } };

export type AdminUpdateNotificationSenderInfoMutationVariables = Exact<{
  input: UpdateNotificationSenderInfoInput;
}>;


export type AdminUpdateNotificationSenderInfoMutation = { updateNotificationSenderInfo: { version: number, updatedAt: string | null, updatedByNickname: string | null, info: { businessName: string, contactEmail: string, postalAddress: string } | null } };

export type AdminProductCategoriesQueryVariables = Exact<{ [key: string]: never; }>;


export type AdminProductCategoriesQuery = { adminProductCategories: Array<{ id: string, name: string, handle: string, systemDefault: boolean }> };

export type AdminCreateProductCategoryMutationVariables = Exact<{
  input: ProductCategoryInput;
}>;


export type AdminCreateProductCategoryMutation = { createProductCategory: { id: string } };

export type AdminDeleteProductCategoryMutationVariables = Exact<{
  id: string | number;
}>;


export type AdminDeleteProductCategoryMutation = { deleteProductCategory: boolean };

export type AdminUpdateProductCategoryMutationVariables = Exact<{
  id: string | number;
  input: ProductCategoryInput;
}>;


export type AdminUpdateProductCategoryMutation = { updateProductCategory: { id: string } };

export type AdminSponsorshipsQueryVariables = Exact<{
  filter?: AdminSponsorshipFilter | null | undefined;
  first: number;
  after?: string | null | undefined;
}>;


export type AdminSponsorshipsQuery = { adminSponsorships: { nodes: Array<{ id: string, productName: string | null, productHandle: string | null, productDeleted: boolean, applicantNickname: string | null, tier: SponsorshipTier, startsOn: string, endsOn: string, days: number, status: SponsorshipStatus, terminable: boolean, purchaseId: string | null, createdAt: string, amountPaid: { amount: number, currency: string } | null }>, pageInfo: { hasNextPage: boolean, endCursor: string | null } } };

export type AdminSponsorshipTerminationPreviewQueryVariables = Exact<{
  id: string | number;
}>;


export type AdminSponsorshipTerminationPreviewQuery = { sponsorshipTerminationPreview: { id: string, days: number, unexposedDays: number, stoppedDays: number, amountPaid: { amount: number, currency: string }, refundEstimate: { amount: number, currency: string }, stopRefundAmount: { amount: number, currency: string } } };

export type AdminTerminateSponsorshipMutationVariables = Exact<{
  id: string | number;
  reason: string;
}>;


export type AdminTerminateSponsorshipMutation = { terminateSponsorship: { id: string, days: number, unexposedDays: number, stoppedDays: number, terminatedOn: string, terminationRefundStatus: SponsorshipRefundStatus | null, stopRefundStatus: SponsorshipRefundStatus | null, purchaseId: string, amountPaid: { amount: number, currency: string }, refundEstimate: { amount: number, currency: string }, stopRefundAmount: { amount: number, currency: string }, terminationRefundRequested: { amount: number, currency: string } | null, stopRefundRequested: { amount: number, currency: string } | null } };

export type AdminSystemStatusQueryVariables = Exact<{ [key: string]: never; }>;


export type AdminSystemStatusQuery = { systemStatus: { serverTime: string, databaseReachable: boolean } };

export type AdminUltrasPromotionSettingQueryVariables = Exact<{ [key: string]: never; }>;


export type AdminUltrasPromotionSettingQuery = { ultrasPromotionSetting: { enabled: boolean, updatedAt: string | null, updatedByNickname: string | null, version: number } };

export type AdminUpdateUltrasPromotionSettingMutationVariables = Exact<{
  input: UpdateUltrasPromotionSettingInput;
}>;


export type AdminUpdateUltrasPromotionSettingMutation = { updateUltrasPromotionSetting: { enabled: boolean, updatedAt: string | null, updatedByNickname: string | null, version: number } };

export type AdminUpdateYearFinalDateMutationVariables = Exact<{
  input: UpdateYearFinalDateInput;
}>;


export type AdminUpdateYearFinalDateMutation = { updateYearFinalDate: { year: number, finalDate: string, source: YearFinalDateSource, acceptUntil: string, deadlineAt: string, drawAt: string, changeLockAt: string, changeable: boolean, choices: Array<string>, previousYearFinalDate: string | null, nextYearFinalDate: string | null, nextYearSource: YearFinalDateSource | null, nextYearGapWarningDate: string | null, version: number, updatedAt: string | null, updatedBy: { nickname: string | null } | null } };

export type AdminYearFinalDateSettingsQueryVariables = Exact<{ [key: string]: never; }>;


export type AdminYearFinalDateSettingsQuery = { yearFinalDateSettings: { serverTime: string, settings: Array<{ year: number, finalDate: string, source: YearFinalDateSource, acceptUntil: string, deadlineAt: string, drawAt: string, changeLockAt: string, changeable: boolean, choices: Array<string>, previousYearFinalDate: string | null, nextYearFinalDate: string | null, nextYearSource: YearFinalDateSource | null, nextYearGapWarningDate: string | null, version: number, updatedAt: string | null, updatedBy: { nickname: string | null } | null }> } };

export const AdminHelpArticleRowFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminHelpArticleRow"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminHelpArticleRow"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"handle"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"categoryId"}},{"kind":"Field","name":{"kind":"Name","value":"categoryName"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"pinned"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"creatorAdminId"}},{"kind":"Field","name":{"kind":"Name","value":"creator"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nickname"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"avatar"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"objectKey"}},{"kind":"Field","name":{"kind":"Name","value":"fallbackFormat"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<AdminHelpArticleRowFragment, unknown>;
export const AdminHelpArticleFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminHelpArticle"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminHelpArticle"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"handle"}},{"kind":"Field","name":{"kind":"Name","value":"previousHandle"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"subtitle"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"categoryId"}},{"kind":"Field","name":{"kind":"Name","value":"categoryName"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"pinned"}},{"kind":"Field","name":{"kind":"Name","value":"creator"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nickname"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"avatar"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"objectKey"}},{"kind":"Field","name":{"kind":"Name","value":"fallbackFormat"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"revision"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<AdminHelpArticleFragment, unknown>;
export const HelpCategoryFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"HelpCategory"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"HelpCategory"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"systemDefault"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}},{"kind":"Field","name":{"kind":"Name","value":"articleCount"}}]}}]} as unknown as DocumentNode<HelpCategoryFragment, unknown>;
export const AdminModerationMediaFileFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminModerationMediaFile"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminMediaFile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"quarantined"}},{"kind":"Field","name":{"kind":"Name","value":"quarantineReasons"}}]}}]} as unknown as DocumentNode<AdminModerationMediaFileFragment, unknown>;
export const AdminModerationUserSummaryFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminModerationUserSummary"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserSummary"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"handle"}},{"kind":"Field","name":{"kind":"Name","value":"nickname"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}}]}}]} as unknown as DocumentNode<AdminModerationUserSummaryFragment, unknown>;
export const AdminModerationProductFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminModerationProduct"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminProduct"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"handle"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"logo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminModerationMediaFile"}}]}},{"kind":"Field","name":{"kind":"Name","value":"owner"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminModerationUserSummary"}}]}},{"kind":"Field","name":{"kind":"Name","value":"category"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"latestLaunchDate"}},{"kind":"Field","name":{"kind":"Name","value":"latestLaunchState"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminModerationMediaFile"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminMediaFile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"quarantined"}},{"kind":"Field","name":{"kind":"Name","value":"quarantineReasons"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminModerationUserSummary"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserSummary"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"handle"}},{"kind":"Field","name":{"kind":"Name","value":"nickname"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}}]}}]} as unknown as DocumentNode<AdminModerationProductFragment, unknown>;
export const AdminModerationNoteFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminModerationNote"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ModerationNote"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}}]}}]} as unknown as DocumentNode<AdminModerationNoteFragment, unknown>;
export const AdminModerationRatingFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminModerationRating"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminRating"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"rater"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminModerationUserSummary"}}]}},{"kind":"Field","name":{"kind":"Name","value":"productName"}},{"kind":"Field","name":{"kind":"Name","value":"productId"}},{"kind":"Field","name":{"kind":"Name","value":"score"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"latestInvalidation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminModerationNote"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminModerationUserSummary"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserSummary"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"handle"}},{"kind":"Field","name":{"kind":"Name","value":"nickname"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminModerationNote"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ModerationNote"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}}]}}]} as unknown as DocumentNode<AdminModerationRatingFragment, unknown>;
export const AdminAccountsDocument = {"__meta__":{"hash":"sha256:00f33554081a88503d14f773be600ba93677eb9075e14f59cc2ed39a06cbc377"}} as unknown as DocumentNode<AdminAccountsQuery, AdminAccountsQueryVariables>;
export const AdminChangeRoleDocument = {"__meta__":{"hash":"sha256:f1f88bf3b8b20cf0bc4c9098f0f1c85d00b64194ca28a5b18014c203a7517871"}} as unknown as DocumentNode<AdminChangeRoleMutation, AdminChangeRoleMutationVariables>;
export const AdminDeleteDocument = {"__meta__":{"hash":"sha256:29852b285441f9a321526e46f4d625ef1052e2f0b438cacdd40f7d4ca70daaaa"}} as unknown as DocumentNode<AdminDeleteMutation, AdminDeleteMutationVariables>;
export const AdminInviteDocument = {"__meta__":{"hash":"sha256:3add519bc3a435cbf2285b5c2ff24bf0f2cd5ee6ab87a119737b02c45dfe8424"}} as unknown as DocumentNode<AdminInviteMutation, AdminInviteMutationVariables>;
export const AdminResendInvitationDocument = {"__meta__":{"hash":"sha256:0d12649c1a9fd47a14dd6085af559ca7cd3b0b32a1efe9c96f2520c57b93f805"}} as unknown as DocumentNode<AdminResendInvitationMutation, AdminResendInvitationMutationVariables>;
export const AdminUpdateProfileDocument = {"__meta__":{"hash":"sha256:8cef82af57f604371bf26cfbd0583e48f706865b71d1580f88a88641d9076efd"}} as unknown as DocumentNode<AdminUpdateProfileMutation, AdminUpdateProfileMutationVariables>;
export const AdminAuditLogsDocument = {"__meta__":{"hash":"sha256:9f5c229c36cd32370959106088c02d1f36c189c4bffa5f592a1cb1f9aa662246"}} as unknown as DocumentNode<AdminAuditLogsQuery, AdminAuditLogsQueryVariables>;
export const AdminCompleteInvitationDocument = {"__meta__":{"hash":"sha256:aee00f5710f33f0c82436aced2745ddf12c7a5a0da806a8763626280a6049373"}} as unknown as DocumentNode<AdminCompleteInvitationMutation, AdminCompleteInvitationMutationVariables>;
export const AdminCompleteSecondFactorLoginDocument = {"__meta__":{"hash":"sha256:f17a54a52720fdb06c90578c9c73f164cb0d6669a49827a63c764c61b1ecd03d"}} as unknown as DocumentNode<AdminCompleteSecondFactorLoginMutation, AdminCompleteSecondFactorLoginMutationVariables>;
export const AdminConfirmEmailChangeDocument = {"__meta__":{"hash":"sha256:67b7886416976143208526fd2097e2105fc70dfe53072b43646de65bfffc5046"}} as unknown as DocumentNode<AdminConfirmEmailChangeMutation, AdminConfirmEmailChangeMutationVariables>;
export const AdminLoginDocument = {"__meta__":{"hash":"sha256:2b3db74ff8d9cf57c3fd301c72c6ac49f26bb115769cfa3e4664be219a5795e4"}} as unknown as DocumentNode<AdminLoginMutation, AdminLoginMutationVariables>;
export const AdminLogoutDocument = {"__meta__":{"hash":"sha256:a5c867644440dfae94541ecdc6378418d089707d3ba11adf60c7a71e468381e7"}} as unknown as DocumentNode<AdminLogoutMutation, AdminLogoutMutationVariables>;
export const AdminRequestPasswordResetDocument = {"__meta__":{"hash":"sha256:d48da8ed350eab28a04a32ad2e03d56182ea6236f37ec0c7c41de8410902b93a"}} as unknown as DocumentNode<AdminRequestPasswordResetMutation, AdminRequestPasswordResetMutationVariables>;
export const AdminResetPasswordDocument = {"__meta__":{"hash":"sha256:94a7f69084274f48fee34f654308b27d9de7d19b619f518a3c6169c092a487d9"}} as unknown as DocumentNode<AdminResetPasswordMutation, AdminResetPasswordMutationVariables>;
export const AdminStartInvitationDocument = {"__meta__":{"hash":"sha256:3b39d0738def23c218abff35936b48becafa4622b7b5fbfdce5362c2f67209b8"}} as unknown as DocumentNode<AdminStartInvitationMutation, AdminStartInvitationMutationVariables>;
export const AdminInquiryCategoriesDocument = {"__meta__":{"hash":"sha256:d1768d02f7ce8797066541794d26e91ae700f639b166ac8f4c98f09a9be0ec50"}} as unknown as DocumentNode<AdminInquiryCategoriesQuery, AdminInquiryCategoriesQueryVariables>;
export const AdminCreateInquiryCategoryDocument = {"__meta__":{"hash":"sha256:a457695edc6d76d1b6992cb3de5d5307c652d4164bd416155f86848f66cca47d"}} as unknown as DocumentNode<AdminCreateInquiryCategoryMutation, AdminCreateInquiryCategoryMutationVariables>;
export const AdminDeleteInquiryCategoryDocument = {"__meta__":{"hash":"sha256:aabdd80bc829c70a67be582b15e51ef742fcafd29eb48c78ada32ccb4c0aff4d"}} as unknown as DocumentNode<AdminDeleteInquiryCategoryMutation, AdminDeleteInquiryCategoryMutationVariables>;
export const AdminRenameInquiryCategoryDocument = {"__meta__":{"hash":"sha256:b1e8cf9dd8266f96cfa3bd32afe1a6a51ff2f8896d43b0138edeb814f17da548"}} as unknown as DocumentNode<AdminRenameInquiryCategoryMutation, AdminRenameInquiryCategoryMutationVariables>;
export const AdminInquiryCategoryOptionsDocument = {"__meta__":{"hash":"sha256:286888e8999338219195044b284dbcbdfeff601cdc07844787cee9b0b5b201b0"}} as unknown as DocumentNode<AdminInquiryCategoryOptionsQuery, AdminInquiryCategoryOptionsQueryVariables>;
export const AdminChangeInquiryStatusDocument = {"__meta__":{"hash":"sha256:77acdb3a5d8f2c2f239e034b9b81b451496c52a489ef30c3102e80a61a42784d"}} as unknown as DocumentNode<AdminChangeInquiryStatusMutation, AdminChangeInquiryStatusMutationVariables>;
export const AdminInquiriesDocument = {"__meta__":{"hash":"sha256:1180cc781646ce77b6d765a061ca2f387daecefac756f9cb61356ff83b9d8c48"}} as unknown as DocumentNode<AdminInquiriesQuery, AdminInquiriesQueryVariables>;
export const AdminInquiryDocument = {"__meta__":{"hash":"sha256:6fdbef74d44962f7508001c8dc27b20234f686682d880ef0ed7f3a6eb38487be"}} as unknown as DocumentNode<AdminInquiryQuery, AdminInquiryQueryVariables>;
export const AdminReplyToInquiryDocument = {"__meta__":{"hash":"sha256:5870c5fb94dcec2d93b9affe5857370a5644e573d61c55c3adcb588cb193bec6"}} as unknown as DocumentNode<AdminReplyToInquiryMutation, AdminReplyToInquiryMutationVariables>;
export const AdminUnhandledInquiryCountDocument = {"__meta__":{"hash":"sha256:108661b168cf905473967bf90e4d747d5153aa793bd63edf89090941ba382a49"}} as unknown as DocumentNode<AdminUnhandledInquiryCountQuery, AdminUnhandledInquiryCountQueryVariables>;
export const AdminChangePasswordDocument = {"__meta__":{"hash":"sha256:8cff11b0bf017aef90706d2c18d28aa70380c5274662c90e82d1b510e292d966"}} as unknown as DocumentNode<AdminChangePasswordMutation, AdminChangePasswordMutationVariables>;
export const AdminCompleteTotpResetDocument = {"__meta__":{"hash":"sha256:2b90b8513d1ac71cfb0dc044f17589283d69ea157ef05ed2c506b12888550711"}} as unknown as DocumentNode<AdminCompleteTotpResetMutation, AdminCompleteTotpResetMutationVariables>;
export const AdminRegenerateRecoveryCodesDocument = {"__meta__":{"hash":"sha256:70c6ef86ce4fff5d6a81767859ab1e2d31d7cfd6be13e9a3183b7e1ac51bd7a9"}} as unknown as DocumentNode<AdminRegenerateRecoveryCodesMutation, AdminRegenerateRecoveryCodesMutationVariables>;
export const AdminRequestEmailChangeDocument = {"__meta__":{"hash":"sha256:001d16267154b69081040699d102aa02a3daeb4b080daccf3fb4375ff43da5a7"}} as unknown as DocumentNode<AdminRequestEmailChangeMutation, AdminRequestEmailChangeMutationVariables>;
export const AdminStartTotpResetDocument = {"__meta__":{"hash":"sha256:1b3ca75cae779b59323f5f62c21ed237e938f4ff28d99a975406ee2d754b21ff"}} as unknown as DocumentNode<AdminStartTotpResetMutation, AdminStartTotpResetMutationVariables>;
export const AdminViewerDocument = {"__meta__":{"hash":"sha256:1ac496453595a8382b39f19b1b1f5772167f686970c6f4d851c2939d063f20bc"}} as unknown as DocumentNode<AdminViewerQuery, AdminViewerQueryVariables>;
export const AdminHelpArticleDocument = {"__meta__":{"hash":"sha256:17e1f66462d29a5db66e46056f430dcf92ed9b141e0d38c638345e2062741853"}} as unknown as DocumentNode<AdminHelpArticleQuery, AdminHelpArticleQueryVariables>;
export const AdminHelpArticlesDocument = {"__meta__":{"hash":"sha256:5e0c9f0e344b4ea887ea4747fc84b218ccfae74f9868b929f046b448edbf420c"}} as unknown as DocumentNode<AdminHelpArticlesQuery, AdminHelpArticlesQueryVariables>;
export const AdminCreateHelpArticleDocument = {"__meta__":{"hash":"sha256:a30cc1e04293ac7c0ff17f2982d7a828917419996351da6ebca755792bc152d4"}} as unknown as DocumentNode<AdminCreateHelpArticleMutation, AdminCreateHelpArticleMutationVariables>;
export const AdminDeleteHelpArticleDocument = {"__meta__":{"hash":"sha256:3e701c63ea41ad56a81c2df72284b8f965c003896cd97b5358c51028b18334b0"}} as unknown as DocumentNode<AdminDeleteHelpArticleMutation, AdminDeleteHelpArticleMutationVariables>;
export const AdminHelpArticleHandleAvailabilityDocument = {"__meta__":{"hash":"sha256:212e727808d4b3a04e50325acf3f1225336c293ad102c4cf4a8064a8c5272e6d"}} as unknown as DocumentNode<AdminHelpArticleHandleAvailabilityQuery, AdminHelpArticleHandleAvailabilityQueryVariables>;
export const AdminReorderHelpArticlesDocument = {"__meta__":{"hash":"sha256:5b86256e52b86bed503da58bfc4afbc1da27d1abd387f33d16e4184bfcb2941a"}} as unknown as DocumentNode<AdminReorderHelpArticlesMutation, AdminReorderHelpArticlesMutationVariables>;
export const AdminUpdateHelpArticleDocument = {"__meta__":{"hash":"sha256:b514b57fb3c78edd6354c5e3cecc25ec9604f4209df4b5e44810d9a68b7af8e9"}} as unknown as DocumentNode<AdminUpdateHelpArticleMutation, AdminUpdateHelpArticleMutationVariables>;
export const AdminHelpCategoriesDocument = {"__meta__":{"hash":"sha256:42a6810d6265ef58f65c2c90a222c3c9f8691021ebd197f803ef21fb98378024"}} as unknown as DocumentNode<AdminHelpCategoriesQuery, AdminHelpCategoriesQueryVariables>;
export const AdminCreateHelpCategoryDocument = {"__meta__":{"hash":"sha256:c6750424174d4eb134db72d41d21c41f44aac0cc53b3edb7858a62362a698dad"}} as unknown as DocumentNode<AdminCreateHelpCategoryMutation, AdminCreateHelpCategoryMutationVariables>;
export const AdminDeleteHelpCategoryDocument = {"__meta__":{"hash":"sha256:7b7c923c68ec88fcfeda47e496533d2c0ccbc751a78e62f6b80f1b742489fdf9"}} as unknown as DocumentNode<AdminDeleteHelpCategoryMutation, AdminDeleteHelpCategoryMutationVariables>;
export const AdminRenameHelpCategoryDocument = {"__meta__":{"hash":"sha256:fb1aca59949159ce35be582766a6e3407c0fbc5da15d633aa08693a04c6ec199"}} as unknown as DocumentNode<AdminRenameHelpCategoryMutation, AdminRenameHelpCategoryMutationVariables>;
export const AdminReorderHelpCategoriesDocument = {"__meta__":{"hash":"sha256:528771d24f2e37f4979e24e96876bba2ea14575f202f09d181098373a80c4c53"}} as unknown as DocumentNode<AdminReorderHelpCategoriesMutation, AdminReorderHelpCategoriesMutationVariables>;
export const AdminDiscardLegalDocumentDraftDocument = {"__meta__":{"hash":"sha256:f620615f9b881fde219c19329207558d9e0a5c1ee9b956440dad46537119d0b5"}} as unknown as DocumentNode<AdminDiscardLegalDocumentDraftMutation, AdminDiscardLegalDocumentDraftMutationVariables>;
export const AdminLegalDocumentVersionDocument = {"__meta__":{"hash":"sha256:3395f8b8763a894c9a0a44dea76d6e4e1defe78d667b1304ac8abebe1d02eef3"}} as unknown as DocumentNode<AdminLegalDocumentVersionQuery, AdminLegalDocumentVersionQueryVariables>;
export const AdminLegalDocumentDocument = {"__meta__":{"hash":"sha256:42121f09a2acd07655238015d1e097883b34ca6d9a603b7fc22271d462f77ee5"}} as unknown as DocumentNode<AdminLegalDocumentQuery, AdminLegalDocumentQueryVariables>;
export const AdminLegalDocumentsDocument = {"__meta__":{"hash":"sha256:2f5f703c05e4c378679abd43badd1cc30062941d402fc1ca4045ed4646c4b5c2"}} as unknown as DocumentNode<AdminLegalDocumentsQuery, AdminLegalDocumentsQueryVariables>;
export const AdminPublishLegalDocumentDocument = {"__meta__":{"hash":"sha256:81c947606fe5b15c429d4107739c5f6696c874eebb73d163bce9f866986aa11c"}} as unknown as DocumentNode<AdminPublishLegalDocumentMutation, AdminPublishLegalDocumentMutationVariables>;
export const AdminSaveLegalDocumentDraftDocument = {"__meta__":{"hash":"sha256:e0ae6b1245545720ebf463ace8663aaaf6b251a968c90992e6b0d4b0ff0b2085"}} as unknown as DocumentNode<AdminSaveLegalDocumentDraftMutation, AdminSaveLegalDocumentDraftMutationVariables>;
export const AdminApproveQuarantinedImageDocument = {"__meta__":{"hash":"sha256:94c6812fdbd8558480dc2ac417b66e3045691a9a113dba1fe7f38b6d9068cdab"}} as unknown as DocumentNode<AdminApproveQuarantinedImageMutation, AdminApproveQuarantinedImageMutationVariables>;
export const AdminCommentsDocument = {"__meta__":{"hash":"sha256:34c210fc9306c2ed52a64721cf2ccd3d1575eff8f75e8e9e77b0df410d167ddb"}} as unknown as DocumentNode<AdminCommentsQuery, AdminCommentsQueryVariables>;
export const AdminDeleteQuarantinedImageDocument = {"__meta__":{"hash":"sha256:1597575db798a6f0591863d9617f34b202695e7e527161a53393b0dba4afddfe"}} as unknown as DocumentNode<AdminDeleteQuarantinedImageMutation, AdminDeleteQuarantinedImageMutationVariables>;
export const AdminHideCommentDocument = {"__meta__":{"hash":"sha256:50013a15d49381edb067fc060a223a535d967e8681a6950fddee9b82e6853810"}} as unknown as DocumentNode<AdminHideCommentMutation, AdminHideCommentMutationVariables>;
export const AdminHideProductDocument = {"__meta__":{"hash":"sha256:da97afdfe5b0cbb3812262e4b32ec4adecea3ca82f36567b1c82d3a82ff17e9e"}} as unknown as DocumentNode<AdminHideProductMutation, AdminHideProductMutationVariables>;
export const AdminInvalidateRatingDocument = {"__meta__":{"hash":"sha256:221e85534733b2d7f292923907609b3d53bcca8bc2fe008cb65541e7b65958c9"}} as unknown as DocumentNode<AdminInvalidateRatingMutation, AdminInvalidateRatingMutationVariables>;
export const AdminModerationCategoryOptionsDocument = {"__meta__":{"hash":"sha256:4783c18a56f0a6a9c75118d463f7896aa27e0d893cf935402246c74456dbbc94"}} as unknown as DocumentNode<AdminModerationCategoryOptionsQuery, AdminModerationCategoryOptionsQueryVariables>;
export const AdminProductRatingsDocument = {"__meta__":{"hash":"sha256:e2acc61fdda5c731b2a95eb3a4b5d67c52b656c6370827e00f9932a4b83b7d4b"}} as unknown as DocumentNode<AdminProductRatingsQuery, AdminProductRatingsQueryVariables>;
export const AdminProductDocument = {"__meta__":{"hash":"sha256:8d905226ec867927408ab1a64fb5e66f74e73b8f3cace05bf248ba6f3887449d"}} as unknown as DocumentNode<AdminProductQuery, AdminProductQueryVariables>;
export const AdminProductsDocument = {"__meta__":{"hash":"sha256:2dfc71d8d469e6e647426ac9bbe9264e8934a58834b145fad6ede03dd00967d1"}} as unknown as DocumentNode<AdminProductsQuery, AdminProductsQueryVariables>;
export const AdminQuarantineImageDocument = {"__meta__":{"hash":"sha256:49299da2602a188b9005a2e3f8e34816fbc24cb632ffeab172c4df720467e179"}} as unknown as DocumentNode<AdminQuarantineImageMutation, AdminQuarantineImageMutationVariables>;
export const AdminQuarantinedImagesDocument = {"__meta__":{"hash":"sha256:0e47672604c3f2a5771fba2f6df50f62611d8e18a064788f4a4c0aafb1be8443"}} as unknown as DocumentNode<AdminQuarantinedImagesQuery, AdminQuarantinedImagesQueryVariables>;
export const AdminRatingsDocument = {"__meta__":{"hash":"sha256:973edbdc95b0bdb7a2ab7f67611de63520199022be5d68c6897c2017b6048a20"}} as unknown as DocumentNode<AdminRatingsQuery, AdminRatingsQueryVariables>;
export const AdminReleaseQuarantinedImageDocument = {"__meta__":{"hash":"sha256:b12a9d64f0c28c98a6ce4037248c27a4ce8a6f744bb3768068218137b902ab5f"}} as unknown as DocumentNode<AdminReleaseQuarantinedImageMutation, AdminReleaseQuarantinedImageMutationVariables>;
export const AdminRevalidateRatingDocument = {"__meta__":{"hash":"sha256:b63ae956b210ddbb8aff63fdb8bf1ae2594ed3ace9b14e2fdd8be167b3b28649"}} as unknown as DocumentNode<AdminRevalidateRatingMutation, AdminRevalidateRatingMutationVariables>;
export const AdminSuspendUserDocument = {"__meta__":{"hash":"sha256:5fdd42b93a6bcc8b0ca3e2fc2b8f2c74d205835b76f4ea2a92832127dae55eb0"}} as unknown as DocumentNode<AdminSuspendUserMutation, AdminSuspendUserMutationVariables>;
export const AdminUnhideCommentDocument = {"__meta__":{"hash":"sha256:fa239025763edbc0e3465873c33f433768b5a10f393e8ddd02ba0055f314b6d0"}} as unknown as DocumentNode<AdminUnhideCommentMutation, AdminUnhideCommentMutationVariables>;
export const AdminUnhideProductDocument = {"__meta__":{"hash":"sha256:6b77403ab598196eaf89a2b868c2a91f5bb873cd0409273df5bb6fef67c9a5d9"}} as unknown as DocumentNode<AdminUnhideProductMutation, AdminUnhideProductMutationVariables>;
export const AdminUnsuspendUserDocument = {"__meta__":{"hash":"sha256:0c44a6aa3d0c8e8b535890953ddbb700b0195f78d0fd190c2e8153e1e59b12e7"}} as unknown as DocumentNode<AdminUnsuspendUserMutation, AdminUnsuspendUserMutationVariables>;
export const AdminUsersDocument = {"__meta__":{"hash":"sha256:675528b3264a275cfbff442c9f6be4f09d483f2414fd6c1842993016251e47af"}} as unknown as DocumentNode<AdminUsersQuery, AdminUsersQueryVariables>;
export const AdminWithdrawUserByAdministratorDocument = {"__meta__":{"hash":"sha256:d7446c7d501e4b294c6d206eec375b3dcdff717b0e4285f482c9340c31426846"}} as unknown as DocumentNode<AdminWithdrawUserByAdministratorMutation, AdminWithdrawUserByAdministratorMutationVariables>;
export const AdminNotificationSenderInfoDocument = {"__meta__":{"hash":"sha256:d055b6e60c8152dac9299688ec506b92302c4be2ba07230a977ecd362787299f"}} as unknown as DocumentNode<AdminNotificationSenderInfoQuery, AdminNotificationSenderInfoQueryVariables>;
export const AdminUpdateNotificationSenderInfoDocument = {"__meta__":{"hash":"sha256:897840cedcc642bf6bead9772339ff5763a1ce65bcbe9f78d1abf85e73e28fac"}} as unknown as DocumentNode<AdminUpdateNotificationSenderInfoMutation, AdminUpdateNotificationSenderInfoMutationVariables>;
export const AdminProductCategoriesDocument = {"__meta__":{"hash":"sha256:da18b6862587d95df8093c5e6b74398899fa4d1420e5011466ca671aed9a19a5"}} as unknown as DocumentNode<AdminProductCategoriesQuery, AdminProductCategoriesQueryVariables>;
export const AdminCreateProductCategoryDocument = {"__meta__":{"hash":"sha256:e0f1015c3d9281d12b8a93a04fd52222e396bcb9b5c7304e18297297605f5238"}} as unknown as DocumentNode<AdminCreateProductCategoryMutation, AdminCreateProductCategoryMutationVariables>;
export const AdminDeleteProductCategoryDocument = {"__meta__":{"hash":"sha256:416fe8b1adab0808e5e87e5ef61f4de669a7058f9d0823a52190bfc290dc9904"}} as unknown as DocumentNode<AdminDeleteProductCategoryMutation, AdminDeleteProductCategoryMutationVariables>;
export const AdminUpdateProductCategoryDocument = {"__meta__":{"hash":"sha256:be16568665cb19771f99ba5a2a07896166f243af3357d62ce762b520c267ca51"}} as unknown as DocumentNode<AdminUpdateProductCategoryMutation, AdminUpdateProductCategoryMutationVariables>;
export const AdminSponsorshipsDocument = {"__meta__":{"hash":"sha256:5900d001f11c79fe9980f749cb103cd8002a99f51ea7b95de168cac065e7b286"}} as unknown as DocumentNode<AdminSponsorshipsQuery, AdminSponsorshipsQueryVariables>;
export const AdminSponsorshipTerminationPreviewDocument = {"__meta__":{"hash":"sha256:849b82ae23246d5e9acd510d1102cf83215fa61a4a48582fd8dd10dc8311fdc1"}} as unknown as DocumentNode<AdminSponsorshipTerminationPreviewQuery, AdminSponsorshipTerminationPreviewQueryVariables>;
export const AdminTerminateSponsorshipDocument = {"__meta__":{"hash":"sha256:7d365ad65a441610a574b759038fad5f15363c13d3b511155e43bd48a9c24efd"}} as unknown as DocumentNode<AdminTerminateSponsorshipMutation, AdminTerminateSponsorshipMutationVariables>;
export const AdminSystemStatusDocument = {"__meta__":{"hash":"sha256:cfd1cd38df39a20ba4d85b44cdc75b45715595ad92ef45f03d4bc5fd3146590c"}} as unknown as DocumentNode<AdminSystemStatusQuery, AdminSystemStatusQueryVariables>;
export const AdminUltrasPromotionSettingDocument = {"__meta__":{"hash":"sha256:2edd177a6140620bf171c97fd69c0c289130634ffcd31adf626abf21935f6c24"}} as unknown as DocumentNode<AdminUltrasPromotionSettingQuery, AdminUltrasPromotionSettingQueryVariables>;
export const AdminUpdateUltrasPromotionSettingDocument = {"__meta__":{"hash":"sha256:0414939a189f0129ea30b0206151b9cc04ec191ecc0c8cafd7ec3e0ee57b270f"}} as unknown as DocumentNode<AdminUpdateUltrasPromotionSettingMutation, AdminUpdateUltrasPromotionSettingMutationVariables>;
export const AdminUpdateYearFinalDateDocument = {"__meta__":{"hash":"sha256:5271a6772d537ccb6faa843e035b9a424e666d168f0b9584f416bc2a6998a30f"}} as unknown as DocumentNode<AdminUpdateYearFinalDateMutation, AdminUpdateYearFinalDateMutationVariables>;
export const AdminYearFinalDateSettingsDocument = {"__meta__":{"hash":"sha256:459543dcdf5f207fc911ad17d4292649a096459a24f6a78c6f2eb12ab5ee94b2"}} as unknown as DocumentNode<AdminYearFinalDateSettingsQuery, AdminYearFinalDateSettingsQueryVariables>;