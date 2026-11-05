/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
/** 利用者の状態 */
export type AccountStatus =
  | 'ACTIVE'
  | 'SUSPENDED';

export type CompleteSecondFactorLoginInput = {
  challenge: string;
  secondFactor: SecondFactorInput;
};

/** 未ログインの問い合わせの送信 */
export type GuestInquiryInput = {
  body: string;
  categoryId: string | number;
  email: string;
  nickname: string;
};

/** 追加メッセージの送信 */
export type InquiryMessageInput = {
  body: string;
  /** アップロード済みの問い合わせの添付のファイルのID */
  fileIds: Array<string | number>;
};

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

export type LoginInput = {
  email: string;
  password: string;
};

/** AVIF・WebPに非対応のブラウザ向けの形式。原本がJPEGならJPG、SVGならSVG(SVGはこの形式だけで表示する)、それ以外はPNG */
export type MediaImageFallbackFormat =
  | 'JPG'
  | 'PNG'
  | 'SVG';

/** ログインの問い合わせの送信 */
export type MemberInquiryInput = {
  body: string;
  categoryId: string | number;
  /** アップロード済みの問い合わせの添付のファイルのID */
  fileIds: Array<string | number>;
};

/** 重要な操作の本人確認 */
export type ReAuthenticationInput = {
  currentPassword: string;
  /** 多要素認証が有効なときだけ必要 */
  secondFactor?: SecondFactorInput | null | undefined;
};

export type RegisterUserInput = {
  /** 利用規約とプライバシーポリシー(18歳以上であることの表明を含む)への同意 */
  agreedToTerms: boolean;
  email: string;
  nickname: string;
  password: string;
};

export type RequestEmailChangeInput = {
  newEmail: string;
  reAuthentication: ReAuthenticationInput;
};

export type RequestPasswordChangeInput = {
  newPassword: string;
  reAuthentication: ReAuthenticationInput;
};

/** 確認メールの再送の結果 */
export type ResendVerificationResult =
  | 'ALREADY_VERIFIED'
  | 'SENT';

export type ResetPasswordInput = {
  newPassword: string;
  token: string;
};

/** 認証コードかリカバリコードのどちらか一方 */
export type SecondFactorInput = {
  recoveryCode?: string | null | undefined;
  totpCode?: string | null | undefined;
};

export type ClientCompleteSecondFactorLoginMutationVariables = Exact<{
  input: CompleteSecondFactorLoginInput;
}>;


export type ClientCompleteSecondFactorLoginMutation = { completeSecondFactorLogin: { id: string } };

export type ClientConfirmEmailChangeMutationVariables = Exact<{
  token: string;
}>;


export type ClientConfirmEmailChangeMutation = { confirmEmailChange: { viewer: { id: string } | null } };

export type ClientConfirmPasswordChangeMutationVariables = Exact<{
  token: string;
}>;


export type ClientConfirmPasswordChangeMutation = { confirmPasswordChange: { viewer: { id: string } | null } };

export type ClientDisableTotpMutationVariables = Exact<{
  input: ReAuthenticationInput;
}>;


export type ClientDisableTotpMutation = { disableTotp: boolean };

export type ClientEnableTotpMutationVariables = Exact<{
  totpCode: string;
}>;


export type ClientEnableTotpMutation = { enableTotp: { codes: Array<string> } };

export type ClientLoginMutationVariables = Exact<{
  input: LoginInput;
}>;


export type ClientLoginMutation = { login:
    | { __typename: 'LoginSucceeded', viewer: { id: string } }
    | { __typename: 'SecondFactorRequired', challenge: string, expiresAt: string }
   };

export type ClientLogoutMutationVariables = Exact<{ [key: string]: never; }>;


export type ClientLogoutMutation = { logout: boolean };

export type ClientMySessionsQueryVariables = Exact<{ [key: string]: never; }>;


export type ClientMySessionsQuery = { mySessions: Array<{ id: string, browserName: string | null, osName: string | null, createdAt: string, lastUsedAt: string, current: boolean }>, viewer: { id: string, totpEnabled: boolean, remainingRecoveryCodes: number } | null };

export type ClientRegenerateRecoveryCodesMutationVariables = Exact<{
  input: ReAuthenticationInput;
}>;


export type ClientRegenerateRecoveryCodesMutation = { regenerateRecoveryCodes: { codes: Array<string> } };

export type ClientRegisterUserMutationVariables = Exact<{
  input: RegisterUserInput;
}>;


export type ClientRegisterUserMutation = { registerUser: { id: string } };

export type ClientRequestEmailChangeMutationVariables = Exact<{
  input: RequestEmailChangeInput;
}>;


export type ClientRequestEmailChangeMutation = { requestEmailChange: boolean };

export type ClientRequestPasswordChangeMutationVariables = Exact<{
  input: RequestPasswordChangeInput;
}>;


export type ClientRequestPasswordChangeMutation = { requestPasswordChange: boolean };

export type ClientRequestPasswordResetMutationVariables = Exact<{
  email: string;
}>;


export type ClientRequestPasswordResetMutation = { requestPasswordReset: boolean };

export type ClientResendVerificationEmailMutationVariables = Exact<{ [key: string]: never; }>;


export type ClientResendVerificationEmailMutation = { resendVerificationEmail: ResendVerificationResult };

export type ClientResetPasswordMutationVariables = Exact<{
  input: ResetPasswordInput;
}>;


export type ClientResetPasswordMutation = { resetPassword: boolean };

export type ClientRevokeOtherSessionsMutationVariables = Exact<{ [key: string]: never; }>;


export type ClientRevokeOtherSessionsMutation = { revokeOtherSessions: number };

export type ClientRevokeSessionMutationVariables = Exact<{
  id: string | number;
}>;


export type ClientRevokeSessionMutation = { revokeSession: boolean };

export type ClientStartTotpSetupMutationVariables = Exact<{
  input: ReAuthenticationInput;
}>;


export type ClientStartTotpSetupMutation = { startTotpSetup: { otpauthUri: string, secret: string, expiresAt: string } };

export type ClientVerifyEmailMutationVariables = Exact<{
  token: string;
}>;


export type ClientVerifyEmailMutation = { verifyEmail: boolean };

export type ClientViewerQueryVariables = Exact<{ [key: string]: never; }>;


export type ClientViewerQuery = { viewer: { id: string, handle: string, nickname: string, emailVerified: boolean, status: AccountStatus, totpEnabled: boolean } | null };

export type ClientWithdrawMutationVariables = Exact<{
  input: ReAuthenticationInput;
}>;


export type ClientWithdrawMutation = { withdraw: boolean };

export type ClientMemberInquiryQueryVariables = Exact<{
  id: string | number;
}>;


export type ClientMemberInquiryQuery = { memberInquiry: { id: string, status: InquiryStatus, createdAt: string, canPost: boolean, category: { id: string, name: string }, messages: Array<{ id: string, sender: InquirySender, body: string, createdAt: string, attachments: Array<{ id: string, originalFileName: string, contentType: string, byteSize: number }>, admin: { nickname: string | null, deleted: boolean, avatar: { objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null }> } | null };

export type ClientPostInquiryMessageMutationVariables = Exact<{
  inquiryId: string | number;
  input: InquiryMessageInput;
}>;


export type ClientPostInquiryMessageMutation = { postInquiryMessage: { id: string } };

export type ClientInquiryContactFormQueryVariables = Exact<{ [key: string]: never; }>;


export type ClientInquiryContactFormQuery = { inquiryCategories: Array<{ id: string, name: string }>, inquiryComposer: { nickname: string, avatar: { objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null };

export type ClientMyInquiriesQueryVariables = Exact<{
  after?: string | null | undefined;
}>;


export type ClientMyInquiriesQuery = { myInquiries: { nextCursor: string | null, items: Array<{ id: string, status: InquiryStatus, createdAt: string, lastMessageAt: string, category: { id: string, name: string } }> } };

export type ClientSubmitGuestInquiryMutationVariables = Exact<{
  input: GuestInquiryInput;
}>;


export type ClientSubmitGuestInquiryMutation = { submitGuestInquiry: boolean };

export type ClientSubmitMemberInquiryMutationVariables = Exact<{
  input: MemberInquiryInput;
}>;


export type ClientSubmitMemberInquiryMutation = { submitMemberInquiry: { id: string } };

export type ClientLegalDocumentVersionQueryVariables = Exact<{
  kind: LegalDocumentKind;
  versionNumber: number;
}>;


export type ClientLegalDocumentVersionQuery = { legalDocumentVersion: { publishedAt: string, changeSummary: string, body: string, isLatest: boolean } | null };

export type ClientLegalDocumentQueryVariables = Exact<{
  kind: LegalDocumentKind;
}>;


export type ClientLegalDocumentQuery = { legalDocument: { latest: { versionNumber: number, publishedAt: string, body: string } | null, revisions: Array<{ versionNumber: number, publishedAt: string, changeSummary: string }> } };

export type ClientSystemStatusQueryVariables = Exact<{ [key: string]: never; }>;


export type ClientSystemStatusQuery = { systemStatus: { serverTime: string, databaseReachable: boolean } };


export const ClientCompleteSecondFactorLoginDocument = {"__meta__":{"hash":"sha256:2a5e67f3c1b64838df2c0c323fab25ed80f89e0c56f58fd2bcc6ae3e76583218"}} as unknown as DocumentNode<ClientCompleteSecondFactorLoginMutation, ClientCompleteSecondFactorLoginMutationVariables>;
export const ClientConfirmEmailChangeDocument = {"__meta__":{"hash":"sha256:c512d6387b1888f3b40034cad109c27d09c805940a226412e3082c1939225461"}} as unknown as DocumentNode<ClientConfirmEmailChangeMutation, ClientConfirmEmailChangeMutationVariables>;
export const ClientConfirmPasswordChangeDocument = {"__meta__":{"hash":"sha256:2c986aa7e78feaf09e6115e21264cc394141eb5a2aa3595af8198871db50c326"}} as unknown as DocumentNode<ClientConfirmPasswordChangeMutation, ClientConfirmPasswordChangeMutationVariables>;
export const ClientDisableTotpDocument = {"__meta__":{"hash":"sha256:b65e6e4042a3b75bfb066e9d234f1c444e54fc56dffd33c007a64f538e2b7d78"}} as unknown as DocumentNode<ClientDisableTotpMutation, ClientDisableTotpMutationVariables>;
export const ClientEnableTotpDocument = {"__meta__":{"hash":"sha256:c3ff382bd6649afe201477fa49c0c2231d96c1f4eb0cb0bc13bda6a00e1b3eb6"}} as unknown as DocumentNode<ClientEnableTotpMutation, ClientEnableTotpMutationVariables>;
export const ClientLoginDocument = {"__meta__":{"hash":"sha256:73d44df90e35780877350227351941eb4dc14c6e97dccd720a459ac6dc0c1770"}} as unknown as DocumentNode<ClientLoginMutation, ClientLoginMutationVariables>;
export const ClientLogoutDocument = {"__meta__":{"hash":"sha256:4f7994090eddffbc1788cb8a3aec6e1bd95000e48df2a99fd3cec1b439895fd0"}} as unknown as DocumentNode<ClientLogoutMutation, ClientLogoutMutationVariables>;
export const ClientMySessionsDocument = {"__meta__":{"hash":"sha256:f6f1f76727f2eafa7c1667293ee787a38eed2bfaa6c64a7d097877fc8971b4fe"}} as unknown as DocumentNode<ClientMySessionsQuery, ClientMySessionsQueryVariables>;
export const ClientRegenerateRecoveryCodesDocument = {"__meta__":{"hash":"sha256:761ccf299ba6c0026c4fa6cf2737069d7e05f3b010d6efa135da522e39f46683"}} as unknown as DocumentNode<ClientRegenerateRecoveryCodesMutation, ClientRegenerateRecoveryCodesMutationVariables>;
export const ClientRegisterUserDocument = {"__meta__":{"hash":"sha256:4fdf885aed37c5eb154699163a90a1055b6c3fd78d23579358236412f546d8a7"}} as unknown as DocumentNode<ClientRegisterUserMutation, ClientRegisterUserMutationVariables>;
export const ClientRequestEmailChangeDocument = {"__meta__":{"hash":"sha256:81a778d85c35fb6974443bcaf806ac7b5a53b708b93ecef83bb104f734d5ac9b"}} as unknown as DocumentNode<ClientRequestEmailChangeMutation, ClientRequestEmailChangeMutationVariables>;
export const ClientRequestPasswordChangeDocument = {"__meta__":{"hash":"sha256:1c0c3ce746b3576ff81d4b79bad2de8e7f7c897f2bdcefaac5a8ba916b200cc0"}} as unknown as DocumentNode<ClientRequestPasswordChangeMutation, ClientRequestPasswordChangeMutationVariables>;
export const ClientRequestPasswordResetDocument = {"__meta__":{"hash":"sha256:5124beb770970e7732940b9cad373e4dee1744d7370cb3e8e38ee2e48bcd9824"}} as unknown as DocumentNode<ClientRequestPasswordResetMutation, ClientRequestPasswordResetMutationVariables>;
export const ClientResendVerificationEmailDocument = {"__meta__":{"hash":"sha256:371e18ff9b483c33484cc3c73f5663c9633e9ba5d05a9421c3dda336cecac740"}} as unknown as DocumentNode<ClientResendVerificationEmailMutation, ClientResendVerificationEmailMutationVariables>;
export const ClientResetPasswordDocument = {"__meta__":{"hash":"sha256:03aeca165ba3a6acfd34f563fd9edfa3b211d0135ce4a33a3e8dcbd350a2ec22"}} as unknown as DocumentNode<ClientResetPasswordMutation, ClientResetPasswordMutationVariables>;
export const ClientRevokeOtherSessionsDocument = {"__meta__":{"hash":"sha256:a0d030143231c28be3aa38e4f4261d704ce7f809395931bba31a2baca4c61f1c"}} as unknown as DocumentNode<ClientRevokeOtherSessionsMutation, ClientRevokeOtherSessionsMutationVariables>;
export const ClientRevokeSessionDocument = {"__meta__":{"hash":"sha256:cd9a6da8704a99730e3860f7269467f46accf0005a469a672f4d9ab98abb7fe5"}} as unknown as DocumentNode<ClientRevokeSessionMutation, ClientRevokeSessionMutationVariables>;
export const ClientStartTotpSetupDocument = {"__meta__":{"hash":"sha256:efa3bfe8dae005eb0391198d28047918185c37a64f694716c59df95052da9d71"}} as unknown as DocumentNode<ClientStartTotpSetupMutation, ClientStartTotpSetupMutationVariables>;
export const ClientVerifyEmailDocument = {"__meta__":{"hash":"sha256:726a6e9c68fb75fa096211612244937e2b095ff026399cefe872db787e44d0f8"}} as unknown as DocumentNode<ClientVerifyEmailMutation, ClientVerifyEmailMutationVariables>;
export const ClientViewerDocument = {"__meta__":{"hash":"sha256:32c8c75633fc3b433a9cb6cbaac7e135578ea7ab16915864dfa104f8065aa35b"}} as unknown as DocumentNode<ClientViewerQuery, ClientViewerQueryVariables>;
export const ClientWithdrawDocument = {"__meta__":{"hash":"sha256:f42f0084a9747d5145d30bb11beed3b7f668553b0fa146db06147a3dc2b17c48"}} as unknown as DocumentNode<ClientWithdrawMutation, ClientWithdrawMutationVariables>;
export const ClientMemberInquiryDocument = {"__meta__":{"hash":"sha256:1b83ce2c7c2d8074b4c2f42cf113ec2b12156d511ff1aa40670b508eb4d3b247"}} as unknown as DocumentNode<ClientMemberInquiryQuery, ClientMemberInquiryQueryVariables>;
export const ClientPostInquiryMessageDocument = {"__meta__":{"hash":"sha256:852736a708e58fb1cbbbbf5a4db443546610504685f1035b17cb3914152d1266"}} as unknown as DocumentNode<ClientPostInquiryMessageMutation, ClientPostInquiryMessageMutationVariables>;
export const ClientInquiryContactFormDocument = {"__meta__":{"hash":"sha256:d1332020d9d2c52cbafdd7b364120ba4fddc9a30262add6cded937706a20a0b5"}} as unknown as DocumentNode<ClientInquiryContactFormQuery, ClientInquiryContactFormQueryVariables>;
export const ClientMyInquiriesDocument = {"__meta__":{"hash":"sha256:ecb5d90f6b342dd38afc5640c9f219d9236517a7410f7f6e8f97a65fc2ecb00d"}} as unknown as DocumentNode<ClientMyInquiriesQuery, ClientMyInquiriesQueryVariables>;
export const ClientSubmitGuestInquiryDocument = {"__meta__":{"hash":"sha256:c27d183b194e166d931c84f745d97578fb4d98e0cb2256f0a8fcc26d234a8097"}} as unknown as DocumentNode<ClientSubmitGuestInquiryMutation, ClientSubmitGuestInquiryMutationVariables>;
export const ClientSubmitMemberInquiryDocument = {"__meta__":{"hash":"sha256:7ebab58e872b46e2a761386272da3c3445de825ebadc2a5801dd3347924a4f76"}} as unknown as DocumentNode<ClientSubmitMemberInquiryMutation, ClientSubmitMemberInquiryMutationVariables>;
export const ClientLegalDocumentVersionDocument = {"__meta__":{"hash":"sha256:cf73a2a49fc87037feed659bbc7f29a53ac80fac211fc9fc3db3b49e69a0aab0"}} as unknown as DocumentNode<ClientLegalDocumentVersionQuery, ClientLegalDocumentVersionQueryVariables>;
export const ClientLegalDocumentDocument = {"__meta__":{"hash":"sha256:14a871d7ed29487fa12d6b46bf699e04496bef6ee024891e2467fedcdbf634c9"}} as unknown as DocumentNode<ClientLegalDocumentQuery, ClientLegalDocumentQueryVariables>;
export const ClientSystemStatusDocument = {"__meta__":{"hash":"sha256:090cc17cd5d52bd28071adebddfe430cda6b85b3a1d2cfa05b655fc784d4ca9e"}} as unknown as DocumentNode<ClientSystemStatusQuery, ClientSystemStatusQueryVariables>;