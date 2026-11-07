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

/** 下書きの破棄 */
export type DiscardLegalDocumentDraftInput = {
  expectedStateVersion: number;
  kind: LegalDocumentKind;
};

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

/** 下書きの公開 */
export type PublishLegalDocumentInput = {
  changeSummary: string;
  expectedStateVersion: number;
  kind: LegalDocumentKind;
};

/** 下書きの保存 */
export type SaveLegalDocumentDraftInput = {
  body: string;
  expectedStateVersion: number;
  kind: LegalDocumentKind;
};

/** 機能フラグの変更の入力 */
export type UpdateUltrasPromotionSettingInput = {
  enabled: boolean;
  /** 照会で読み取った版。最新と一致しなければversion_conflict */
  expectedVersion: number;
  /** 監査ログに残す理由(任意) */
  reason?: string | null | undefined;
};

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

export type AdminSystemStatusQueryVariables = Exact<{ [key: string]: never; }>;


export type AdminSystemStatusQuery = { systemStatus: { serverTime: string, databaseReachable: boolean } };

export type AdminUltrasPromotionSettingQueryVariables = Exact<{ [key: string]: never; }>;


export type AdminUltrasPromotionSettingQuery = { ultrasPromotionSetting: { enabled: boolean, updatedAt: string | null, updatedByNickname: string | null, version: number } };

export type AdminUpdateUltrasPromotionSettingMutationVariables = Exact<{
  input: UpdateUltrasPromotionSettingInput;
}>;


export type AdminUpdateUltrasPromotionSettingMutation = { updateUltrasPromotionSetting: { enabled: boolean, updatedAt: string | null, updatedByNickname: string | null, version: number } };


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
export const AdminDiscardLegalDocumentDraftDocument = {"__meta__":{"hash":"sha256:f620615f9b881fde219c19329207558d9e0a5c1ee9b956440dad46537119d0b5"}} as unknown as DocumentNode<AdminDiscardLegalDocumentDraftMutation, AdminDiscardLegalDocumentDraftMutationVariables>;
export const AdminLegalDocumentVersionDocument = {"__meta__":{"hash":"sha256:3395f8b8763a894c9a0a44dea76d6e4e1defe78d667b1304ac8abebe1d02eef3"}} as unknown as DocumentNode<AdminLegalDocumentVersionQuery, AdminLegalDocumentVersionQueryVariables>;
export const AdminLegalDocumentDocument = {"__meta__":{"hash":"sha256:42121f09a2acd07655238015d1e097883b34ca6d9a603b7fc22271d462f77ee5"}} as unknown as DocumentNode<AdminLegalDocumentQuery, AdminLegalDocumentQueryVariables>;
export const AdminLegalDocumentsDocument = {"__meta__":{"hash":"sha256:2f5f703c05e4c378679abd43badd1cc30062941d402fc1ca4045ed4646c4b5c2"}} as unknown as DocumentNode<AdminLegalDocumentsQuery, AdminLegalDocumentsQueryVariables>;
export const AdminPublishLegalDocumentDocument = {"__meta__":{"hash":"sha256:81c947606fe5b15c429d4107739c5f6696c874eebb73d163bce9f866986aa11c"}} as unknown as DocumentNode<AdminPublishLegalDocumentMutation, AdminPublishLegalDocumentMutationVariables>;
export const AdminSaveLegalDocumentDraftDocument = {"__meta__":{"hash":"sha256:e0ae6b1245545720ebf463ace8663aaaf6b251a968c90992e6b0d4b0ff0b2085"}} as unknown as DocumentNode<AdminSaveLegalDocumentDraftMutation, AdminSaveLegalDocumentDraftMutationVariables>;
export const AdminSystemStatusDocument = {"__meta__":{"hash":"sha256:cfd1cd38df39a20ba4d85b44cdc75b45715595ad92ef45f03d4bc5fd3146590c"}} as unknown as DocumentNode<AdminSystemStatusQuery, AdminSystemStatusQueryVariables>;
export const AdminUltrasPromotionSettingDocument = {"__meta__":{"hash":"sha256:2edd177a6140620bf171c97fd69c0c289130634ffcd31adf626abf21935f6c24"}} as unknown as DocumentNode<AdminUltrasPromotionSettingQuery, AdminUltrasPromotionSettingQueryVariables>;
export const AdminUpdateUltrasPromotionSettingDocument = {"__meta__":{"hash":"sha256:0414939a189f0129ea30b0206151b9cc04ec191ecc0c8cafd7ec3e0ee57b270f"}} as unknown as DocumentNode<AdminUpdateUltrasPromotionSettingMutation, AdminUpdateUltrasPromotionSettingMutationVariables>;