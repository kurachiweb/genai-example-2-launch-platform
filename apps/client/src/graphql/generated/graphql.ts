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

/** 不戦勝の理由。ABSENTは対戦相手なし、FORFEITはマッチ直前の相手の該当、EARLYはマッチ中の即時の終了 */
export type ByeReason =
  | 'ABSENT'
  | 'EARLY'
  | 'FORFEIT';

/** 権利を付与できなかった理由 */
export type CheckoutRejectionReason =
  /** 同じ対象の二重の支払い */
  | 'DUPLICATE'
  /** 購入の条件を満たさない */
  | 'INELIGIBLE'
  /** 受付期限の後の支払い */
  | 'LATE';

/** 決済画面に示す購入の状態 */
export type CheckoutStatus =
  /** 完了 */
  | 'COMPLETED'
  /** 失効 */
  | 'EXPIRED'
  /** 支払える */
  | 'OPEN'
  /** 支払いの確認中 */
  | 'PROCESSING'
  /** 権利を付与できず全額返金を依頼した */
  | 'REFUNDING'
  /** Stripeに到達できず支払いの準備ができない */
  | 'UNAVAILABLE';

export type CompleteSecondFactorLoginInput = {
  challenge: string;
  secondFactor: SecondFactorInput;
};

/** URLのクエリと同じ条件。不正な値はエラーにせず既定の値として扱う */
export type DirectoryInput = {
  /** カテゴリのハンドル(大文字小文字を区別しない) */
  category?: string | null | undefined;
  /** 業務日付(YYYY-MM-DD) */
  from?: string | null | undefined;
  /** 2以上の10進の整数 */
  page?: string | null | undefined;
  q?: string | null | undefined;
  /** relevance・newest・oldest・upvotes */
  sort?: string | null | undefined;
  /** 業務日付(YYYY-MM-DD) */
  to?: string | null | undefined;
};

/** ディレクトリの並び順。RELEVANCEは検索語があるときだけ選べる */
export type DirectorySort =
  | 'NEWEST'
  | 'OLDEST'
  | 'RELEVANCE'
  | 'UPVOTES';

/** 基準勝利の種類。VICTORYは勝敗の付いた勝利、BYEは対戦相手なし・マッチ直前の相手の該当による不戦勝、EARLYはマッチ中の相手の該当による即時の終了 */
export type DirectoryWinKind =
  | 'BYE'
  | 'EARLY'
  | 'VICTORY';

/** 未ログインの問い合わせの送信 */
export type GuestInquiryInput = {
  body: string;
  categoryId: string | number;
  email: string;
  nickname: string;
};

/** ハンドルの使用可否。INVALIDは形式の違反 */
export type HandleAvailability =
  | 'AVAILABLE'
  | 'INVALID'
  | 'UNAVAILABLE';

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

/** ローンチ日を選べない理由 */
export type LaunchDateUnavailableReason =
  | 'OUT_OF_RANGE'
  | 'PAIRING_DEADLINE'
  | 'RELAUNCH_INTERVAL';

/** 次回のローンチの計画。NEWは新しいローンチの予約、RESCHEDULEは予定のローンチの日の変更、BLOCKEDは予約できない、UNKNOWNは判定できない */
export type LaunchPlanMode =
  | 'BLOCKED'
  | 'NEW'
  | 'RESCHEDULE'
  | 'UNKNOWN';

/** ローンチの状態。照会の時点の時刻から導く */
export type LaunchStatus =
  | 'CANCELED'
  | 'FINISHED'
  | 'IN_PROGRESS'
  | 'PAIRED'
  | 'SCHEDULED';

/** 法務文書の種類 */
export type LegalDocumentKind =
  | 'LEGAL_NOTICE'
  | 'PRIVACY'
  | 'TERMS';

export type LoginInput = {
  email: string;
  password: string;
};

/** マッチの決着。VOTESはUpvote数、LAST_UPVOTEは同数での最終Upvote時間、NO_VOTESは両者0票の両者敗北、BOTH_FORFEITEDは両方の側の該当による両者敗北 */
export type MatchDecision =
  | 'BOTH_FORFEITED'
  | 'BYE'
  | 'LAST_UPVOTE'
  | 'NO_VOTES'
  | 'VOTES'
  | 'WALKOVER';

/** 側の結果。BYEは対戦相手なしの不戦勝、WALKOVERは相手の該当(退会・停止・非公開化など)による勝利 */
export type MatchEntryResult =
  | 'BYE'
  | 'LOST'
  | 'WALKOVER'
  | 'WON';

/** マッチの種別 */
export type MatchKind =
  | 'QUALIFIER'
  | 'WEEK'
  | 'YEAR';

/** マッチの状態。照会の時点の時刻から導く。SCHEDULEDは開始前、LIVEはマッチ中、TALLYINGは終了の日時を過ぎて確定の前、FINISHEDは結果の確定の後 */
export type MatchPhase =
  | 'FINISHED'
  | 'LIVE'
  | 'SCHEDULED'
  | 'TALLYING';

/** トーナメントの段階。予選と段階の名前を持たないラウンドはnull */
export type MatchStage =
  | 'FINAL'
  | 'QUARTERFINAL'
  | 'SEMIFINAL';

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

/** 決済履歴の種類 */
export type PaymentRecordKind =
  | 'DISPUTE'
  | 'ONE_TIME'
  | 'REFUND'
  | 'SUBSCRIPTION';

/** 決済履歴の状態 */
export type PaymentRecordStatus =
  | 'DISPUTED'
  | 'DISPUTE_LOST'
  | 'DISPUTE_WON'
  | 'FAILED'
  | 'PENDING'
  | 'SUCCEEDED';

export type ProductAwardKind =
  | 'WEEK'
  | 'YEAR';

/** プロダクトの登録・編集で全件を送る項目 */
export type ProductFieldsInput = {
  categoryId: string | number;
  /** マークダウンの説明文(1〜20,000文字) */
  description: string;
  handle: string;
  /** 本人がアップロードしたロゴの画像 */
  logoFileId: string | number;
  /** 前後の空白を除いて1〜50文字 */
  name: string;
  /** 表示順。0〜20件で重複なし */
  screenshotFileIds: Array<string | number>;
  /** 前後の空白を除いて1〜100文字 */
  tagline: string;
  /** httpかhttpsの2,048文字以内の絶対URL */
  websiteUrl: string;
};

/** マッチ履歴の対戦相手の見え方。NONEは対戦相手なし、PRIVATEは非公開化・投稿者の退会や停止・論理削除・紐付けの解除・不戦勝の相手、UNLISTEDは可視だが未掲載、LISTEDは掲載中 */
export type ProductPageOpponentKind =
  | 'LISTED'
  | 'NONE'
  | 'PRIVATE'
  | 'UNLISTED';

/** 公開プロフィールの閲覧者と表示される利用者の関係 */
export type ProfileViewerRelation =
  | 'FOLLOWING'
  | 'GUEST'
  | 'NOT_FOLLOWING'
  | 'OWNER';

export type ProfileWebsiteInput = {
  name?: string | null | undefined;
  url: string;
};

/** 購入種別 */
export type PurchaseKind =
  | 'PAYMENTS_SMOKE'
  | 'SPONSORSHIP'
  | 'ULTRAS'
  | 'WEEK_TOURNAMENT_ENTRY'
  | 'YEAR_TOURNAMENT_ENTRY';

/** トップページの予選の表示。LIVEは終了の時刻(23:40)の前、RESULTはその後の結果の表示 */
export type QualifierBoardPhase =
  | 'LIVE'
  | 'RESULT';

export type QualifierOutcome =
  | 'LOST'
  | 'WON';

/** 重要な操作の本人確認 */
export type ReAuthenticationInput = {
  currentPassword: string;
  /** 多要素認証が有効なときだけ必要 */
  secondFactor?: SecondFactorInput | null | undefined;
};

export type RegisterProductInput = {
  fields: ProductFieldsInput;
  /** 最初のローンチのローンチ日(YYYY-MM-DD) */
  launchDate: string;
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

/** Ultrasの加入状態 */
export type UltrasPlanStatus =
  /** 有効 */
  | 'ACTIVE'
  /** 解約済み(特典の終了日時まで特典が続く) */
  | 'CANCELED'
  /** 終了 */
  | 'ENDED'
  /** 支払いの再試行中 */
  | 'PAST_DUE';

export type UpdateMyProfileInput = {
  /** 保存後の画像。現在の画像のIDなら維持し、nullなら削除する */
  avatarFileId?: string | number | null | undefined;
  bio?: string | null | undefined;
  /** 画面を開いた時点のハンドル。保存の間に変更されていれば保存しない */
  expectedHandle: string;
  handle: string;
  headline?: string | null | undefined;
  nickname: string;
  websites: Array<ProfileWebsiteInput>;
};

export type UpdateProductInput = {
  /** 編集画面を開いたときの版 */
  expectedVersion: number;
  fields: ProductFieldsInput;
  /** 予定のローンチの日の変更か次回のローンチの予約のローンチ日(YYYY-MM-DD)。nullはローンチを変えない */
  launchDate?: string | null | undefined;
  /** 編集画面を開いたときの現在のハンドル */
  productHandle: string;
};

/** Upvoteする側 */
export type UpvoteInput = {
  entryId: string | number;
  matchId: string | number;
};

/** 閲覧者がUpvoteできない理由 */
export type UpvoteRestriction =
  | 'ACCOUNT_UNAVAILABLE'
  | 'EMAIL_NOT_VERIFIED'
  | 'GUEST'
  | 'NOT_ACCEPTING'
  | 'OWN_MATCH';

export type MatchByeFragment = { reason: ByeReason, match: { id: string, kind: MatchKind, round: number | null, stage: MatchStage | null, endedEarly: boolean }, entry: { id: string, colorIndex: number, isViewerOwn: boolean, upvoteCount: number, result: MatchEntryResult | null, product: { handle: string, name: string, tagline: string, websiteUrl: string, listed: boolean, category: { id: string, name: string, handle: string }, logo: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null } };

export type MatchFragment = { id: string, kind: MatchKind, round: number | null, stage: MatchStage | null, phase: MatchPhase, decision: MatchDecision | null, endedEarly: boolean, viewerRestriction: UpvoteRestriction | null, viewerUpvotedEntryId: string | null, entries: Array<{ id: string, colorIndex: number, isViewerOwn: boolean, upvoteCount: number, result: MatchEntryResult | null, product: { handle: string, name: string, tagline: string, websiteUrl: string, listed: boolean, category: { id: string, name: string, handle: string }, logo: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null }> };

export type ClientDirectoryCategoriesQueryVariables = Exact<{ [key: string]: never; }>;


export type ClientDirectoryCategoriesQuery = { directoryCategories: Array<{ id: string, name: string, handle: string }> };

export type ClientDirectoryQueryVariables = Exact<{
  input: DirectoryInput;
}>;


export type ClientDirectoryQuery = { directory: { businessToday: string, page: number, pageCount: number, totalCount: number, searchTerms: Array<string>, applied: { q: string | null, category: string | null, from: string | null, to: string | null, sort: DirectorySort | null, page: number | null }, items: Array<{ handle: string, name: string, tagline: string, websiteUrl: string, isViewerOwn: boolean, category: { id: string, name: string, handle: string }, logo: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null, owner: { handle: string, nickname: string, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null, win: { kind: DirectoryWinKind, launchDate: string, upvoteCount: number | null }, awards: Array<{ kind: ProductAwardKind, count: number, labels: Array<string> }>, metrics: Array<{ key: string, value: number }> }> } };

export type ClientMatchSupportersQueryVariables = Exact<{
  productHandle: string;
  matchId: string | number;
  entryId: string | number;
  first: number;
  after?: string | null | undefined;
}>;


export type ClientMatchSupportersQuery = { matchSupporters: { nodes: Array<{ handle: string, nickname: string, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null }>, pageInfo: { hasNextPage: boolean, endCursor: string | null } } | null };

export type ClientOwnerFollowStatusQueryVariables = Exact<{
  handle: string;
}>;


export type ClientOwnerFollowStatusQuery = { publicProfile:
    | { __typename: 'PublicProfile', viewerRelation: ProfileViewerRelation }
    | { __typename: 'PublicProfileRedirect' }
   | null };

export type ClientProductLiveMatchQueryVariables = Exact<{
  productHandle: string;
}>;


export type ClientProductLiveMatchQuery = { productLiveMatch: { serverTime: string, awaitingChange: boolean, match: { endsAt: string, id: string, kind: MatchKind, round: number | null, stage: MatchStage | null, phase: MatchPhase, decision: MatchDecision | null, endedEarly: boolean, viewerRestriction: UpvoteRestriction | null, viewerUpvotedEntryId: string | null, entries: Array<{ id: string, colorIndex: number, isViewerOwn: boolean, upvoteCount: number, result: MatchEntryResult | null, product: { handle: string, name: string, tagline: string, websiteUrl: string, listed: boolean, category: { id: string, name: string, handle: string }, logo: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null }> } | null } | null };

export type ClientProductOwnerStatusQueryVariables = Exact<{
  productHandle: string;
}>;


export type ClientProductOwnerStatusQuery = { productOwnerStatus: { latestLaunch: { id: string, number: number, launchDate: string, kickoffAt: string, status: LaunchStatus, outcome: QualifierOutcome | null, summary: { label: string, inMatch: boolean } } | null, plan: { mode: LaunchPlanMode, currentLaunchDate: string | null, locked: boolean, lockUnknown: boolean, ultrasEntitled: boolean, window: { earliest: string, latest: string, relaunchIntervalDays: number | null, unavailable: Array<{ from: string, to: string, reason: LaunchDateUnavailableReason }> } | null, blocks: Array<{ code: string, message: string, releaseAt: string | null }>, locks: Array<{ code: string, message: string }> } } | null };

export type ClientProductPageQueryVariables = Exact<{
  handle: string;
}>;


export type ClientProductPageQuery = { productPage:
    | { __typename: 'ProductPage', id: string, handle: string, name: string, tagline: string, websiteUrl: string, description: string, viewerIsOwner: boolean, listed: boolean, category: { id: string, name: string, handle: string }, logo: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null, screenshots: Array<{ fileId: string, image: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null }>, owner: { handle: string, nickname: string, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null }, awards: Array<{ kind: ProductAwardKind, count: number, labels: Array<string> }>, record: { firstLaunchDate: string | null, launchCount: number, wins: number, losses: number }, launches: Array<{ id: string, number: number, launchDate: string, kickoffAt: string, status: LaunchStatus, kickedOff: boolean, latestKickedOff: boolean, summary: { label: string, inMatch: boolean }, matches: Array<{ id: string, entryId: string, kind: MatchKind, round: number | null, stage: MatchStage | null, date: string, result: MatchEntryResult, decision: MatchDecision, endedEarly: boolean, ownUpvoteCount: number, opponentUpvoteCount: number | null, opponent: { kind: ProductPageOpponentKind, handle: string | null, name: string | null, logo: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } }> }> }
    | { __typename: 'ProductPageRedirect', handle: string }
   | null };

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

export type ClientCancelUpvoteMutationVariables = Exact<{
  matchId: string | number;
}>;


export type ClientCancelUpvoteMutation = { cancelUpvote: { id: string, kind: MatchKind, round: number | null, stage: MatchStage | null, phase: MatchPhase, decision: MatchDecision | null, endedEarly: boolean, viewerRestriction: UpvoteRestriction | null, viewerUpvotedEntryId: string | null, entries: Array<{ id: string, colorIndex: number, isViewerOwn: boolean, upvoteCount: number, result: MatchEntryResult | null, product: { handle: string, name: string, tagline: string, websiteUrl: string, listed: boolean, category: { id: string, name: string, handle: string }, logo: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null }> } };

export type ClientQualifierBoardQueryVariables = Exact<{ [key: string]: never; }>;


export type ClientQualifierBoardQuery = { qualifierBoard: { date: string, serverTime: string, phase: QualifierBoardPhase, fullTimeAt: string, nextKickoffAt: string, awaitingKickoff: boolean, heldCount: number, matches: Array<{ id: string, kind: MatchKind, round: number | null, stage: MatchStage | null, phase: MatchPhase, decision: MatchDecision | null, endedEarly: boolean, viewerRestriction: UpvoteRestriction | null, viewerUpvotedEntryId: string | null, entries: Array<{ id: string, colorIndex: number, isViewerOwn: boolean, upvoteCount: number, result: MatchEntryResult | null, product: { handle: string, name: string, tagline: string, websiteUrl: string, listed: boolean, category: { id: string, name: string, handle: string }, logo: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null }> }>, byes: Array<{ reason: ByeReason, match: { id: string, kind: MatchKind, round: number | null, stage: MatchStage | null, endedEarly: boolean }, entry: { id: string, colorIndex: number, isViewerOwn: boolean, upvoteCount: number, result: MatchEntryResult | null, product: { handle: string, name: string, tagline: string, websiteUrl: string, listed: boolean, category: { id: string, name: string, handle: string }, logo: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null } }> } };

export type ClientUpvoteHistoryQueryVariables = Exact<{
  userHandle: string;
  first: number;
  after?: string | null | undefined;
}>;


export type ClientUpvoteHistoryQuery = { upvoteHistory: { totalCount: number, dateTotals: Array<{ date: string, count: number }>, nodes: Array<{ id: string, date: string, kind: MatchKind, round: number | null, stage: MatchStage | null, live: boolean, product: { handle: string, name: string, listed: boolean, logo: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null }, owner: { handle: string, nickname: string, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null }>, pageInfo: { endCursor: string | null, hasNextPage: boolean } } | null };

export type ClientUpvoteMutationVariables = Exact<{
  input: UpvoteInput;
}>;


export type ClientUpvoteMutation = { upvote: { id: string, kind: MatchKind, round: number | null, stage: MatchStage | null, phase: MatchPhase, decision: MatchDecision | null, endedEarly: boolean, viewerRestriction: UpvoteRestriction | null, viewerUpvotedEntryId: string | null, entries: Array<{ id: string, colorIndex: number, isViewerOwn: boolean, upvoteCount: number, result: MatchEntryResult | null, product: { handle: string, name: string, tagline: string, websiteUrl: string, listed: boolean, category: { id: string, name: string, handle: string }, logo: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } | null }> } };

export type ClientCheckoutQueryVariables = Exact<{
  purchaseId: string | number;
}>;


export type ClientCheckoutQuery = { checkout: { purchaseId: string, kind: PurchaseKind, status: CheckoutStatus, rejectionReason: CheckoutRejectionReason | null, clientSecret: string | null, quantity: number, acceptUntil: string | null, expiresAt: string, consentVersion: string, canRestart: boolean, unitPrice: { amount: number, currency: string }, total: { amount: number, currency: string }, summary: { itemName: string, quantityLabel: string, serviceTiming: string, additionalNotes: Array<string>, isSubscription: boolean } } };

export type ClientConfirmCheckoutReturnMutationVariables = Exact<{
  sessionId: string;
}>;


export type ClientConfirmCheckoutReturnMutation = { confirmCheckoutReturn: { checkout: { purchaseId: string, kind: PurchaseKind, status: CheckoutStatus, rejectionReason: CheckoutRejectionReason | null, quantity: number, acceptUntil: string | null, expiresAt: string, canRestart: boolean, unitPrice: { amount: number, currency: string }, total: { amount: number, currency: string }, summary: { itemName: string, quantityLabel: string, serviceTiming: string, additionalNotes: Array<string>, isSubscription: boolean } } } };

export type ClientPaymentHistoryQueryVariables = Exact<{
  first?: number | null | undefined;
  after?: string | null | undefined;
}>;


export type ClientPaymentHistoryQuery = { paymentHistory: { nodes: Array<{ id: string, kind: PaymentRecordKind, purpose: PurchaseKind, quantity: number | null, status: PaymentRecordStatus, occurredAt: string, amount: { amount: number, currency: string } }>, pageInfo: { endCursor: string | null, hasNextPage: boolean } } };

export type ClientRecordCheckoutConsentMutationVariables = Exact<{
  purchaseId: string | number;
}>;


export type ClientRecordCheckoutConsentMutation = { recordCheckoutConsent: { purchaseId: string, kind: PurchaseKind, status: CheckoutStatus, rejectionReason: CheckoutRejectionReason | null, clientSecret: string | null, quantity: number, acceptUntil: string | null, expiresAt: string, consentVersion: string, canRestart: boolean, unitPrice: { amount: number, currency: string }, total: { amount: number, currency: string }, summary: { itemName: string, quantityLabel: string, serviceTiming: string, additionalNotes: Array<string>, isSubscription: boolean } } };

export type ClientStartSmokeCheckoutMutationVariables = Exact<{ [key: string]: never; }>;


export type ClientStartSmokeCheckoutMutation = { startSmokeCheckout: { purchaseId: string } };

export type ClientLaunchHistoryQueryVariables = Exact<{
  userHandle: string;
  first: number;
  after?: string | null | undefined;
}>;


export type ClientLaunchHistoryQuery = { launchHistory: { viewerIsOwner: boolean, ownerSuspended: boolean, totalCount: number, nodes: Array<{ product: { handle: string, name: string, tagline: string, websiteUrl: string, listed: boolean, category: { id: string, name: string, handle: string }, logo: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null }, launches: Array<{ id: string, number: number, launchDate: string, kickoffAt: string, status: LaunchStatus, outcome: QualifierOutcome | null, summary: { label: string, inMatch: boolean } }>, awards: Array<{ kind: ProductAwardKind, count: number, labels: Array<string> }> }>, pageInfo: { endCursor: string | null, hasNextPage: boolean } } | null };

export type ClientProfileAwardsQueryVariables = Exact<{
  userHandle: string;
}>;


export type ClientProfileAwardsQuery = { profileAwards: Array<{ kind: ProductAwardKind, count: number, labels: Array<string> }> | null };

export type ClientMyProductQueryVariables = Exact<{
  handle: string;
}>;


export type ClientMyProductQuery = { myProduct:
    | { __typename: 'MyProduct', handle: string, previousHandle: string | null, name: string, tagline: string, websiteUrl: string, description: string, logoFileId: string, hidden: boolean, listed: boolean, version: number, category: { id: string, name: string, handle: string, systemDefault: boolean }, logo: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null, screenshots: Array<{ fileId: string, byteSize: number, image: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null }>, latestLaunch: { id: string, number: number, launchDate: string, kickoffAt: string, status: LaunchStatus, outcome: QualifierOutcome | null, summary: { label: string, inMatch: boolean } } | null, plan: { mode: LaunchPlanMode, currentLaunchDate: string | null, locked: boolean, lockUnknown: boolean, ultrasEntitled: boolean, window: { earliest: string, latest: string, relaunchIntervalDays: number | null, unavailable: Array<{ from: string, to: string, reason: LaunchDateUnavailableReason }> } | null, blocks: Array<{ code: string, message: string, releaseAt: string | null }>, locks: Array<{ code: string, message: string }> } }
    | { __typename: 'MyProductRedirect', handle: string }
   | null };

export type ClientMyProductsQueryVariables = Exact<{
  first: number;
  after?: string | null | undefined;
}>;


export type ClientMyProductsQuery = { myProducts: { nodes: Array<{ handle: string, name: string, hidden: boolean, listed: boolean, category: { id: string, name: string, handle: string, systemDefault: boolean }, logo: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null, latestLaunch: { id: string, number: number, launchDate: string, kickoffAt: string, status: LaunchStatus, outcome: QualifierOutcome | null, summary: { label: string, inMatch: boolean } } | null, plan: { mode: LaunchPlanMode, currentLaunchDate: string | null, locked: boolean, lockUnknown: boolean, ultrasEntitled: boolean, window: { earliest: string, latest: string, relaunchIntervalDays: number | null, unavailable: Array<{ from: string, to: string, reason: LaunchDateUnavailableReason }> } | null, blocks: Array<{ code: string, message: string, releaseAt: string | null }>, locks: Array<{ code: string, message: string }> } }>, pageInfo: { endCursor: string | null, hasNextPage: boolean } } };

export type ClientNewProductLaunchWindowQueryVariables = Exact<{ [key: string]: never; }>;


export type ClientNewProductLaunchWindowQuery = { newProductLaunchWindow: { earliest: string, latest: string, relaunchIntervalDays: number | null, unavailable: Array<{ from: string, to: string, reason: LaunchDateUnavailableReason }> } };

export type ClientProductHandleAvailabilityQueryVariables = Exact<{
  handle: string;
  productHandle?: string | null | undefined;
}>;


export type ClientProductHandleAvailabilityQuery = { productHandleAvailability: HandleAvailability };

export type ClientProductCategoriesQueryVariables = Exact<{ [key: string]: never; }>;


export type ClientProductCategoriesQuery = { productCategories: Array<{ id: string, name: string, handle: string, systemDefault: boolean }> };

export type ClientDeleteProductMutationVariables = Exact<{
  productHandle: string;
  expectedVersion: number;
}>;


export type ClientDeleteProductMutation = { deleteProduct: boolean };

export type ClientRegisterProductMutationVariables = Exact<{
  input: RegisterProductInput;
}>;


export type ClientRegisterProductMutation = { registerProduct: { handle: string, previousHandle: string | null, name: string, tagline: string, websiteUrl: string, description: string, logoFileId: string, hidden: boolean, listed: boolean, version: number, category: { id: string, name: string, handle: string, systemDefault: boolean }, logo: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null, screenshots: Array<{ fileId: string, byteSize: number, image: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null }>, latestLaunch: { id: string, number: number, launchDate: string, kickoffAt: string, status: LaunchStatus, outcome: QualifierOutcome | null, summary: { label: string, inMatch: boolean } } | null, plan: { mode: LaunchPlanMode, currentLaunchDate: string | null, locked: boolean, lockUnknown: boolean, ultrasEntitled: boolean, window: { earliest: string, latest: string, relaunchIntervalDays: number | null, unavailable: Array<{ from: string, to: string, reason: LaunchDateUnavailableReason }> } | null, blocks: Array<{ code: string, message: string, releaseAt: string | null }>, locks: Array<{ code: string, message: string }> } } };

export type ClientUpdateProductMutationVariables = Exact<{
  input: UpdateProductInput;
}>;


export type ClientUpdateProductMutation = { updateProduct: { handle: string, previousHandle: string | null, name: string, tagline: string, websiteUrl: string, description: string, logoFileId: string, hidden: boolean, listed: boolean, version: number, category: { id: string, name: string, handle: string, systemDefault: boolean }, logo: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null, screenshots: Array<{ fileId: string, byteSize: number, image: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null }>, latestLaunch: { id: string, number: number, launchDate: string, kickoffAt: string, status: LaunchStatus, outcome: QualifierOutcome | null, summary: { label: string, inMatch: boolean } } | null, plan: { mode: LaunchPlanMode, currentLaunchDate: string | null, locked: boolean, lockUnknown: boolean, ultrasEntitled: boolean, window: { earliest: string, latest: string, relaunchIntervalDays: number | null, unavailable: Array<{ from: string, to: string, reason: LaunchDateUnavailableReason }> } | null, blocks: Array<{ code: string, message: string, releaseAt: string | null }>, locks: Array<{ code: string, message: string }> } } };

export type ClientFollowUserMutationVariables = Exact<{
  handle: string;
}>;


export type ClientFollowUserMutation = { followUser: { handle: string, following: boolean, followerCount: number } };

export type ClientHandleAvailabilityQueryVariables = Exact<{
  handle: string;
}>;


export type ClientHandleAvailabilityQuery = { handleAvailability: HandleAvailability };

export type ClientMyFollowersQueryVariables = Exact<{
  first: number;
  after?: string | null | undefined;
}>;


export type ClientMyFollowersQuery = { myFollowers: { nodes: Array<{ followedAt: string, user: { handle: string, nickname: string, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } }>, pageInfo: { endCursor: string | null, hasNextPage: boolean } } };

export type ClientMyFollowingQueryVariables = Exact<{
  first: number;
  after?: string | null | undefined;
}>;


export type ClientMyFollowingQuery = { myFollowing: { nodes: Array<{ followedAt: string, user: { handle: string, nickname: string, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null } }>, pageInfo: { endCursor: string | null, hasNextPage: boolean } } };

export type ClientMyProfileQueryVariables = Exact<{ [key: string]: never; }>;


export type ClientMyProfileQuery = { myProfile: { nickname: string, handle: string, previousHandle: string | null, headline: string | null, bio: string | null, suspended: boolean, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null, websites: Array<{ name: string | null, url: string }> } };

export type ClientPublicProfileQueryVariables = Exact<{
  handle: string;
}>;


export type ClientPublicProfileQuery = { publicProfile:
    | { __typename: 'PublicProfile', handle: string, nickname: string, headline: string | null, bio: string | null, followerCount: number, ultras: boolean, suspended: boolean, viewerRelation: ProfileViewerRelation, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null, websites: Array<{ name: string | null, url: string }> }
    | { __typename: 'PublicProfileRedirect', handle: string }
   | null };

export type ClientUnfollowUserMutationVariables = Exact<{
  handle: string;
}>;


export type ClientUnfollowUserMutation = { unfollowUser: { handle: string, following: boolean, followerCount: number } };

export type ClientUpdateMyProfileMutationVariables = Exact<{
  input: UpdateMyProfileInput;
}>;


export type ClientUpdateMyProfileMutation = { updateMyProfile: { nickname: string, handle: string, previousHandle: string | null, headline: string | null, bio: string | null, suspended: boolean, avatar: { id: string, objectKey: string | null, fallbackFormat: MediaImageFallbackFormat, width: number | null, height: number | null } | null, websites: Array<{ name: string | null, url: string }> } };

export type ClientSystemStatusQueryVariables = Exact<{ [key: string]: never; }>;


export type ClientSystemStatusQuery = { systemStatus: { serverTime: string, databaseReachable: boolean } };

export type ClientCreateUltrasPortalSessionMutationVariables = Exact<{ [key: string]: never; }>;


export type ClientCreateUltrasPortalSessionMutation = { createUltrasPortalSession: { url: string } };

export type ClientStartUltrasCheckoutMutationVariables = Exact<{ [key: string]: never; }>;


export type ClientStartUltrasCheckoutMutation = { startUltrasCheckout: { purchaseId: string } };

export type ClientUltrasOfferQueryVariables = Exact<{ [key: string]: never; }>;


export type ClientUltrasOfferQuery = { ultrasOffer: { priceStale: boolean, promotionEnabled: boolean, price: { amount: number, currency: string } | null } };

export type ClientViewerUltrasQueryVariables = Exact<{ [key: string]: never; }>;


export type ClientViewerUltrasQuery = { viewerUltras: { entitled: boolean, canOpenPortal: boolean, plan: { status: UltrasPlanStatus, startedAt: string, currentPeriodEndsAt: string | null, canceledAt: string | null, benefitEndsAt: string | null } | null } | null };

export const MatchByeFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MatchBye"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MatchBye"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"match"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"round"}},{"kind":"Field","name":{"kind":"Name","value":"stage"}},{"kind":"Field","name":{"kind":"Name","value":"endedEarly"}}]}},{"kind":"Field","name":{"kind":"Name","value":"entry"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"colorIndex"}},{"kind":"Field","name":{"kind":"Name","value":"isViewerOwn"}},{"kind":"Field","name":{"kind":"Name","value":"upvoteCount"}},{"kind":"Field","name":{"kind":"Name","value":"result"}},{"kind":"Field","name":{"kind":"Name","value":"product"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"handle"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"tagline"}},{"kind":"Field","name":{"kind":"Name","value":"websiteUrl"}},{"kind":"Field","name":{"kind":"Name","value":"listed"}},{"kind":"Field","name":{"kind":"Name","value":"category"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"handle"}}]}},{"kind":"Field","name":{"kind":"Name","value":"logo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"objectKey"}},{"kind":"Field","name":{"kind":"Name","value":"fallbackFormat"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MatchByeFragment, unknown>;
export const MatchFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"Match"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Match"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"round"}},{"kind":"Field","name":{"kind":"Name","value":"stage"}},{"kind":"Field","name":{"kind":"Name","value":"phase"}},{"kind":"Field","name":{"kind":"Name","value":"decision"}},{"kind":"Field","name":{"kind":"Name","value":"endedEarly"}},{"kind":"Field","name":{"kind":"Name","value":"viewerRestriction"}},{"kind":"Field","name":{"kind":"Name","value":"viewerUpvotedEntryId"}},{"kind":"Field","name":{"kind":"Name","value":"entries"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"colorIndex"}},{"kind":"Field","name":{"kind":"Name","value":"isViewerOwn"}},{"kind":"Field","name":{"kind":"Name","value":"upvoteCount"}},{"kind":"Field","name":{"kind":"Name","value":"result"}},{"kind":"Field","name":{"kind":"Name","value":"product"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"handle"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"tagline"}},{"kind":"Field","name":{"kind":"Name","value":"websiteUrl"}},{"kind":"Field","name":{"kind":"Name","value":"listed"}},{"kind":"Field","name":{"kind":"Name","value":"category"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"handle"}}]}},{"kind":"Field","name":{"kind":"Name","value":"logo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"objectKey"}},{"kind":"Field","name":{"kind":"Name","value":"fallbackFormat"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MatchFragment, unknown>;
export const ClientDirectoryCategoriesDocument = {"__meta__":{"hash":"sha256:ec12184573e6602c07891ff6ede6a92821b6fcd270fcebf63b64d5182b182dee"}} as unknown as DocumentNode<ClientDirectoryCategoriesQuery, ClientDirectoryCategoriesQueryVariables>;
export const ClientDirectoryDocument = {"__meta__":{"hash":"sha256:98bd712fadac35dcb09420e8fa1b2f5100282ec06528b10e80d28b9dd2e01a3e"}} as unknown as DocumentNode<ClientDirectoryQuery, ClientDirectoryQueryVariables>;
export const ClientMatchSupportersDocument = {"__meta__":{"hash":"sha256:ad24d977e800104a12793e736bc255ea593215b0a7f5f361e25938fd49124c7c"}} as unknown as DocumentNode<ClientMatchSupportersQuery, ClientMatchSupportersQueryVariables>;
export const ClientOwnerFollowStatusDocument = {"__meta__":{"hash":"sha256:0300957c680bcbfda07b29c44addd9980fd4c8c41fc9a8bb6798543d1bcb265e"}} as unknown as DocumentNode<ClientOwnerFollowStatusQuery, ClientOwnerFollowStatusQueryVariables>;
export const ClientProductLiveMatchDocument = {"__meta__":{"hash":"sha256:92342f5c738115984b0046edc048dac373e356d45cb24476b78fb16205607640"}} as unknown as DocumentNode<ClientProductLiveMatchQuery, ClientProductLiveMatchQueryVariables>;
export const ClientProductOwnerStatusDocument = {"__meta__":{"hash":"sha256:9421f04de8a663379f0729e296406d84ab07ad3a1e9829bdd9bd994914f1aea6"}} as unknown as DocumentNode<ClientProductOwnerStatusQuery, ClientProductOwnerStatusQueryVariables>;
export const ClientProductPageDocument = {"__meta__":{"hash":"sha256:64811745ada8f0c5f555bda41d5b916026763167c37fe22f27ce84723b3ff351"}} as unknown as DocumentNode<ClientProductPageQuery, ClientProductPageQueryVariables>;
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
export const ClientCancelUpvoteDocument = {"__meta__":{"hash":"sha256:3933043522f1a733ac1cc95c6a3681241cdbd9bdc2cf40fdcc5a1d43c09a9e71"}} as unknown as DocumentNode<ClientCancelUpvoteMutation, ClientCancelUpvoteMutationVariables>;
export const ClientQualifierBoardDocument = {"__meta__":{"hash":"sha256:ff5034376bc2a441316796107a70892c5558bbe135b0720c923dd6741a8e74bf"}} as unknown as DocumentNode<ClientQualifierBoardQuery, ClientQualifierBoardQueryVariables>;
export const ClientUpvoteHistoryDocument = {"__meta__":{"hash":"sha256:311e7a62c4316504ae269836d447c7a3260d4b88784431dd975868b3df1ae2fe"}} as unknown as DocumentNode<ClientUpvoteHistoryQuery, ClientUpvoteHistoryQueryVariables>;
export const ClientUpvoteDocument = {"__meta__":{"hash":"sha256:56fccaa8654bd2a433c662ef3558247b8a1840c759148008430a57a49eee8d32"}} as unknown as DocumentNode<ClientUpvoteMutation, ClientUpvoteMutationVariables>;
export const ClientCheckoutDocument = {"__meta__":{"hash":"sha256:0f679bb5c2a93b4ed3e1f29d8979625648aac67e378081ec195e3a671b265736"}} as unknown as DocumentNode<ClientCheckoutQuery, ClientCheckoutQueryVariables>;
export const ClientConfirmCheckoutReturnDocument = {"__meta__":{"hash":"sha256:20ff36981f1f184bf48fea1f093f64a915395179e0a5e7bf171a6786ca473b30"}} as unknown as DocumentNode<ClientConfirmCheckoutReturnMutation, ClientConfirmCheckoutReturnMutationVariables>;
export const ClientPaymentHistoryDocument = {"__meta__":{"hash":"sha256:723fccc8cbea4146117d0a1b8aee0a88b01acc1488cf7fb836a129079e19b1c5"}} as unknown as DocumentNode<ClientPaymentHistoryQuery, ClientPaymentHistoryQueryVariables>;
export const ClientRecordCheckoutConsentDocument = {"__meta__":{"hash":"sha256:5beeb2e6d0d838279f1012328c32c5bae9446e4fb8d7c1370d5b895445c97e05"}} as unknown as DocumentNode<ClientRecordCheckoutConsentMutation, ClientRecordCheckoutConsentMutationVariables>;
export const ClientStartSmokeCheckoutDocument = {"__meta__":{"hash":"sha256:453e7f92f82cd9485779ddbee4a1b98898e55fb933896727e1efcb3dcd8a2eaf"}} as unknown as DocumentNode<ClientStartSmokeCheckoutMutation, ClientStartSmokeCheckoutMutationVariables>;
export const ClientLaunchHistoryDocument = {"__meta__":{"hash":"sha256:3c41a4fb429956d3b77f97dc3779b9c8064e44829735f02adccf4110c977e20d"}} as unknown as DocumentNode<ClientLaunchHistoryQuery, ClientLaunchHistoryQueryVariables>;
export const ClientProfileAwardsDocument = {"__meta__":{"hash":"sha256:fe5c079d62a96633b98048585784714874f0f90cbfa859420a5e9ac8ea026aa7"}} as unknown as DocumentNode<ClientProfileAwardsQuery, ClientProfileAwardsQueryVariables>;
export const ClientMyProductDocument = {"__meta__":{"hash":"sha256:c3d8f495b74c14931701e091b5510280eb8570f42da733e62670bfcb174714b3"}} as unknown as DocumentNode<ClientMyProductQuery, ClientMyProductQueryVariables>;
export const ClientMyProductsDocument = {"__meta__":{"hash":"sha256:117ac9cfc9d4293834e3142440dd095bafa3697fff62739f33df5f675727458a"}} as unknown as DocumentNode<ClientMyProductsQuery, ClientMyProductsQueryVariables>;
export const ClientNewProductLaunchWindowDocument = {"__meta__":{"hash":"sha256:4e7a1b66b66188c59951262f48a98b8a212c9b171f4e55202d34b69f29f086a6"}} as unknown as DocumentNode<ClientNewProductLaunchWindowQuery, ClientNewProductLaunchWindowQueryVariables>;
export const ClientProductHandleAvailabilityDocument = {"__meta__":{"hash":"sha256:e99882e3550d5311a8d0f431df7edc63160cc5b6282c348db9b96c251eef0833"}} as unknown as DocumentNode<ClientProductHandleAvailabilityQuery, ClientProductHandleAvailabilityQueryVariables>;
export const ClientProductCategoriesDocument = {"__meta__":{"hash":"sha256:293bea5c8a969e077edc0e230fbcdf0ddaeb330c756c4b0bc60c50ec56904a04"}} as unknown as DocumentNode<ClientProductCategoriesQuery, ClientProductCategoriesQueryVariables>;
export const ClientDeleteProductDocument = {"__meta__":{"hash":"sha256:547ba5446e4ad75ec314ed44811a2bca8e44adab5d900f8539f9644ad9385f27"}} as unknown as DocumentNode<ClientDeleteProductMutation, ClientDeleteProductMutationVariables>;
export const ClientRegisterProductDocument = {"__meta__":{"hash":"sha256:26e9e3c2cd4b6f27de7494fbfb5c866aa987540d03141efb773fb05fe20f1db9"}} as unknown as DocumentNode<ClientRegisterProductMutation, ClientRegisterProductMutationVariables>;
export const ClientUpdateProductDocument = {"__meta__":{"hash":"sha256:578ceca091a540ae984d8aa04a1b4b0ab22011962cbb5ec582ecbe59d9b799f1"}} as unknown as DocumentNode<ClientUpdateProductMutation, ClientUpdateProductMutationVariables>;
export const ClientFollowUserDocument = {"__meta__":{"hash":"sha256:61a8982e76108e2990bc30c68e7a92f50347977c1eb33942b96e1e3eed669c74"}} as unknown as DocumentNode<ClientFollowUserMutation, ClientFollowUserMutationVariables>;
export const ClientHandleAvailabilityDocument = {"__meta__":{"hash":"sha256:02205eb34fb97582363b5f973f14b2d6ff8f33b9ba36ea3bdcf1bb4eeaa5d55a"}} as unknown as DocumentNode<ClientHandleAvailabilityQuery, ClientHandleAvailabilityQueryVariables>;
export const ClientMyFollowersDocument = {"__meta__":{"hash":"sha256:154e09d711ae0f920e4c3e21a71eab5935c360df6016cb11f3ff8416cdeb5569"}} as unknown as DocumentNode<ClientMyFollowersQuery, ClientMyFollowersQueryVariables>;
export const ClientMyFollowingDocument = {"__meta__":{"hash":"sha256:099d0901102d00e05d4c6bd5909e77146da5b907feb3e87fb21215e2829c3e2c"}} as unknown as DocumentNode<ClientMyFollowingQuery, ClientMyFollowingQueryVariables>;
export const ClientMyProfileDocument = {"__meta__":{"hash":"sha256:2d8dcc4cbd827168505049febf76ebdbf27d7bd06017077cc5c77b9a86a7b53e"}} as unknown as DocumentNode<ClientMyProfileQuery, ClientMyProfileQueryVariables>;
export const ClientPublicProfileDocument = {"__meta__":{"hash":"sha256:9e0a702a4409301cdc80cf6c15909853192438e5c412885781b39ca96fd1accb"}} as unknown as DocumentNode<ClientPublicProfileQuery, ClientPublicProfileQueryVariables>;
export const ClientUnfollowUserDocument = {"__meta__":{"hash":"sha256:aa4354a0a4ef140b06a8ea4cae4d21d7494c10aed37765d81671355d708c922a"}} as unknown as DocumentNode<ClientUnfollowUserMutation, ClientUnfollowUserMutationVariables>;
export const ClientUpdateMyProfileDocument = {"__meta__":{"hash":"sha256:b33ca7211146ea6c901810ca374cd5e6c8aaee313997e027dfe31e606d359d18"}} as unknown as DocumentNode<ClientUpdateMyProfileMutation, ClientUpdateMyProfileMutationVariables>;
export const ClientSystemStatusDocument = {"__meta__":{"hash":"sha256:090cc17cd5d52bd28071adebddfe430cda6b85b3a1d2cfa05b655fc784d4ca9e"}} as unknown as DocumentNode<ClientSystemStatusQuery, ClientSystemStatusQueryVariables>;
export const ClientCreateUltrasPortalSessionDocument = {"__meta__":{"hash":"sha256:44f95f5ac6a34b577e87ec3fb6dbb20363fe8011c4c59f2b36028724f89262ab"}} as unknown as DocumentNode<ClientCreateUltrasPortalSessionMutation, ClientCreateUltrasPortalSessionMutationVariables>;
export const ClientStartUltrasCheckoutDocument = {"__meta__":{"hash":"sha256:0a375f8e36296fbd5183b733275bf56caf25b57a4c1e8cc70d7a20c1332c810b"}} as unknown as DocumentNode<ClientStartUltrasCheckoutMutation, ClientStartUltrasCheckoutMutationVariables>;
export const ClientUltrasOfferDocument = {"__meta__":{"hash":"sha256:ec8b30862af3edab7eb2b918ef55d266e4c8aae6e5838c65307b900746226507"}} as unknown as DocumentNode<ClientUltrasOfferQuery, ClientUltrasOfferQueryVariables>;
export const ClientViewerUltrasDocument = {"__meta__":{"hash":"sha256:ec4d291e8aa98f0a09302d916b16f1734bf43689c87af4d47a2ad6674c7d76f1"}} as unknown as DocumentNode<ClientViewerUltrasQuery, ClientViewerUltrasQueryVariables>;