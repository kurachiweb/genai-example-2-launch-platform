import type { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import type { ViewerSource } from '../modules/identity/resolver-support.ts';
import type { AdminViewerSource, AdminAccountSource } from '../modules/admin/resolver-support.ts';
import type { InquiryMessageModel, InquiryReplyAuthorModel, InquiryComposerModel, MemberInquiryModel, MemberInquirySummaryModel, AdminInquirySummaryModel, AdminInquiryMemberModel, AdminInquiryModel } from '../modules/inquiry/mappers.ts';
import type { UserSummarySource } from '../modules/profile/user-summary.ts';
import type { PublicProfileModel, PublicProfileRedirectModel, MyProfileModel } from '../modules/profile/mappers.ts';
import type { MyProductModel, ProductScreenshotModel, LaunchHistoryProductModel } from '../modules/product/mappers.ts';
import type { MatchSource, MatchEntrySource, MatchProductSource } from '../modules/match/mappers.ts';
import type { GraphQLContext } from '../graphql-context.ts';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** UTCのRFC 3339形式の日時 */
  DateTime: { input: number; output: number | Date; }
};

/** 利用者の状態 */
export type AccountStatus =
  | 'ACTIVE'
  | 'SUSPENDED';

/** 管理者のアカウント */
export type AdminAccount = {
  __typename?: 'AdminAccount';
  /** 未登録・表示できない画像ではnull */
  avatar?: Maybe<MediaImage>;
  createdAt: Scalars['DateTime']['output'];
  email: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  /** 招待の完了前はnull */
  nickname?: Maybe<Scalars['String']['output']>;
  role: AdminRole;
  status: AdminAccountStatus;
  title?: Maybe<Scalars['String']['output']>;
};

/** 管理者の一覧に示す状態 */
export type AdminAccountStatus =
  | 'ACTIVE'
  | 'INVITATION_EXPIRED'
  | 'INVITED';

/** メールのリンクによる確定の結果 */
export type AdminConfirmationResult = {
  __typename?: 'AdminConfirmationResult';
  /** 確定の操作をした端末が同じ管理者としてログイン中なら、入れ替えた後の管理者 */
  viewer?: Maybe<AdminViewer>;
};

/** 管理画面の問い合わせの詳細 */
export type AdminInquiry = {
  __typename?: 'AdminInquiry';
  category: InquiryCategory;
  createdAt: Scalars['DateTime']['output'];
  /** ログインの問い合わせではnull */
  guest?: Maybe<AdminInquiryGuest>;
  id: Scalars['ID']['output'];
  kind: InquiryKind;
  lastMessageAt: Scalars['DateTime']['output'];
  /** 未ログインの問い合わせと、送った利用者を読めないログインの問い合わせではnull */
  member?: Maybe<AdminInquiryMember>;
  /** 送信日時の古い順 */
  messages: Array<InquiryMessage>;
  status: InquiryStatus;
  statusChangedAt: Scalars['DateTime']['output'];
  withdrawn: Scalars['Boolean']['output'];
};

/** 管理画面のカテゴリの区画が削除の確認に使う、紐付く問い合わせの件数(ログイン・未ログインの合計)付きのカテゴリ */
export type AdminInquiryCategory = {
  __typename?: 'AdminInquiryCategory';
  id: Scalars['ID']['output'];
  linkedCount: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  systemDefault: Scalars['Boolean']['output'];
};

/** 管理画面の問い合わせの一覧の絞り込み */
export type AdminInquiryFilterInput = {
  categoryId?: InputMaybe<Scalars['ID']['input']>;
  kind?: InputMaybe<InquiryKind>;
  /** この日時を含まない以前の受付 */
  receivedBefore?: InputMaybe<Scalars['DateTime']['input']>;
  /** この日時を含む以降の受付 */
  receivedFrom?: InputMaybe<Scalars['DateTime']['input']>;
  status?: InputMaybe<InquiryStatus>;
};

/** 未ログインの問い合わせの送信者と本文 */
export type AdminInquiryGuest = {
  __typename?: 'AdminInquiryGuest';
  body: Scalars['String']['output'];
  email: Scalars['String']['output'];
  nickname: Scalars['String']['output'];
};

/** ログインの問い合わせを送った利用者 */
export type AdminInquiryMember = {
  __typename?: 'AdminInquiryMember';
  /** 未登録・表示できない画像はnull */
  avatar?: Maybe<MediaImage>;
  handle: Scalars['String']['output'];
  nickname: Scalars['String']['output'];
  userId: Scalars['ID']['output'];
};

/** 管理画面の問い合わせの一覧の1ページ(50件まで、受付日時の新しい順) */
export type AdminInquiryPage = {
  __typename?: 'AdminInquiryPage';
  entries: Array<AdminInquirySummary>;
  /** 続きが無ければnull */
  nextCursor?: Maybe<Scalars['String']['output']>;
};

/** 管理画面の問い合わせの一覧の1行 */
export type AdminInquirySummary = {
  __typename?: 'AdminInquirySummary';
  category: InquiryCategory;
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  kind: InquiryKind;
  lastMessageAt: Scalars['DateTime']['output'];
  senderName: Scalars['String']['output'];
  status: InquiryStatus;
  withdrawn: Scalars['Boolean']['output'];
};

/** 管理画面の編集の対象の法務文書 */
export type AdminLegalDocument = {
  __typename?: 'AdminLegalDocument';
  /** 下書きが無ければnull */
  draft?: Maybe<AdminLegalDraft>;
  kind: LegalDocumentKind;
  /** 未公開ならnull */
  latestBody?: Maybe<Scalars['String']['output']>;
  /** 新しい順 */
  revisions: Array<AdminLegalRevision>;
  /** 保存・破棄・公開で送り返す状態の版 */
  stateVersion: Scalars['Int']['output'];
};

/** 管理画面の法務文書の一覧の1行 */
export type AdminLegalDocumentSummary = {
  __typename?: 'AdminLegalDocumentSummary';
  hasDraft: Scalars['Boolean']['output'];
  kind: LegalDocumentKind;
  /** 未公開ならnull */
  latestPublishedAt?: Maybe<Scalars['DateTime']['output']>;
  /** 未公開ならnull */
  latestVersionNumber?: Maybe<Scalars['Int']['output']>;
};

/** 管理画面で表示する版 */
export type AdminLegalDocumentVersion = {
  __typename?: 'AdminLegalDocumentVersion';
  body: Scalars['String']['output'];
  changeSummary: Scalars['String']['output'];
  isLatest: Scalars['Boolean']['output'];
  kind: LegalDocumentKind;
  publishedAt: Scalars['DateTime']['output'];
  publishedBy: LegalDocumentEditor;
  versionNumber: Scalars['Int']['output'];
};

/** 保存済みの下書き */
export type AdminLegalDraft = {
  __typename?: 'AdminLegalDraft';
  body: Scalars['String']['output'];
  savedAt: Scalars['DateTime']['output'];
  savedBy: LegalDocumentEditor;
};

/** 管理画面の改訂履歴の1版 */
export type AdminLegalRevision = {
  __typename?: 'AdminLegalRevision';
  changeSummary: Scalars['String']['output'];
  publishedAt: Scalars['DateTime']['output'];
  publishedBy: LegalDocumentEditor;
  versionNumber: Scalars['Int']['output'];
};

/** 重要な操作の本人確認 */
export type AdminReAuthenticationInput = {
  /** 本人確認に使う現在のパスワード */
  currentPassword: Scalars['String']['input'];
  secondFactor: AdminSecondFactorInput;
};

/** この応答でだけ見せるリカバリコード */
export type AdminRecoveryCodeSet = {
  __typename?: 'AdminRecoveryCodeSet';
  codes: Array<Scalars['String']['output']>;
};

/** 管理者のロール */
export type AdminRole =
  | 'MODERATOR'
  | 'SUPER_ADMIN'
  | 'VIEWER';

/** 認証コードかリカバリコードのどちらか一方 */
export type AdminSecondFactorInput = {
  recoveryCode?: InputMaybe<Scalars['String']['input']>;
  totpCode?: InputMaybe<Scalars['String']['input']>;
};

/** 第2要素の入力の待ち */
export type AdminSecondFactorRequired = {
  __typename?: 'AdminSecondFactorRequired';
  /** 第2要素の段階の要求と組にする値 */
  challenge: Scalars['String']['output'];
  expiresAt: Scalars['DateTime']['output'];
};

/** 認証アプリへ登録する多要素認証の設定 */
export type AdminTotpSetup = {
  __typename?: 'AdminTotpSetup';
  expiresAt: Scalars['DateTime']['output'];
  otpauthUri: Scalars['String']['output'];
  /** 認証アプリへ手入力するためのbase32 */
  secret: Scalars['String']['output'];
};

/** ログイン中の管理者 */
export type AdminViewer = {
  __typename?: 'AdminViewer';
  /** 未登録・表示できない画像ではnull */
  avatar?: Maybe<MediaImage>;
  email: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  nickname: Scalars['String']['output'];
  /** 要求されたときだけ数える */
  remainingRecoveryCodes: Scalars['Int']['output'];
  role: AdminRole;
  title?: Maybe<Scalars['String']['output']>;
};

/** 監査ログの詳細の1項目 */
export type AuditDetail = {
  __typename?: 'AuditDetail';
  key: Scalars['String']['output'];
  value: Scalars['String']['output'];
};

/** 監査ログの1件 */
export type AuditLogEntry = {
  __typename?: 'AuditLogEntry';
  action: Scalars['String']['output'];
  /** 操作種別の表示名 */
  actionLabel: Scalars['String']['output'];
  detail: Array<AuditDetail>;
  id: Scalars['ID']['output'];
  occurredAt: Scalars['DateTime']['output'];
  operator: AuditOperator;
  reason?: Maybe<Scalars['String']['output']>;
  targetIds: Array<Scalars['String']['output']>;
  /** 対象を取らない操作ではnull */
  targetKind?: Maybe<Scalars['String']['output']>;
};

/** 監査ログの絞り込みの条件。指定した条件をすべて満たすものだけを返す */
export type AuditLogFilterInput = {
  action?: InputMaybe<Scalars['String']['input']>;
  /** この日時を含まない */
  occurredBefore?: InputMaybe<Scalars['DateTime']['input']>;
  /** この日時を含む */
  occurredFrom?: InputMaybe<Scalars['DateTime']['input']>;
  operatorId?: InputMaybe<Scalars['ID']['input']>;
  targetId?: InputMaybe<Scalars['String']['input']>;
};

/** 監査ログの1ページ(日時の新しい順に50件まで) */
export type AuditLogPage = {
  __typename?: 'AuditLogPage';
  entries: Array<AuditLogEntry>;
  /** 続きが無ければnull */
  nextCursor?: Maybe<Scalars['String']['output']>;
};

/** 監査ログを記録した操作者 */
export type AuditOperator = {
  __typename?: 'AuditOperator';
  id: Scalars['ID']['output'];
  /** 削除済みの管理者ではnull */
  nickname?: Maybe<Scalars['String']['output']>;
};

/** 不戦勝の理由。ABSENTは対戦相手なし、FORFEITはマッチ直前の相手の該当、EARLYはマッチ中の即時の終了 */
export type ByeReason =
  | 'ABSENT'
  | 'EARLY'
  | 'FORFEIT';

/** 決済画面と決済後のランディングが表示する購入 */
export type Checkout = {
  __typename?: 'Checkout';
  /** 受付期限。期限の無い購入はnull */
  acceptUntil?: Maybe<Scalars['DateTime']['output']>;
  /** 失効した購入を受付期限の前にやり直せるなら真 */
  canRestart: Scalars['Boolean']['output'];
  /** 状態がOPENのときだけ値がある */
  clientSecret?: Maybe<Scalars['String']['output']>;
  /** 決済画面が表示する同意の文言の版 */
  consentVersion: Scalars['String']['output'];
  /** 決済セッションの有効期限 */
  expiresAt: Scalars['DateTime']['output'];
  kind: PurchaseKind;
  purchaseId: Scalars['ID']['output'];
  quantity: Scalars['Int']['output'];
  /** 状態がREFUNDINGのときだけ値がある */
  rejectionReason?: Maybe<CheckoutRejectionReason>;
  status: CheckoutStatus;
  summary: CheckoutSummary;
  total: Money;
  unitPrice: Money;
};

/** 権利を付与できなかった理由 */
export type CheckoutRejectionReason =
  /** 同じ対象の二重の支払い */
  | 'DUPLICATE'
  /** 購入の条件を満たさない */
  | 'INELIGIBLE'
  /** 受付期限の後の支払い */
  | 'LATE';

/** 決済後のランディングの確認の結果 */
export type CheckoutReturnResult = {
  __typename?: 'CheckoutReturnResult';
  checkout: Checkout;
};

/** 決済の開始の結果。決済を始める変更操作が返す */
export type CheckoutStart = {
  __typename?: 'CheckoutStart';
  /** 決済画面の経路に使う購入のID */
  purchaseId: Scalars['ID']['output'];
};

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

/** 最終確認画面の表示事項 */
export type CheckoutSummary = {
  __typename?: 'CheckoutSummary';
  additionalNotes: Array<Scalars['String']['output']>;
  isSubscription: Scalars['Boolean']['output'];
  itemName: Scalars['String']['output'];
  quantityLabel: Scalars['String']['output'];
  serviceTiming: Scalars['String']['output'];
};

export type CompleteSecondFactorLoginInput = {
  challenge: Scalars['String']['input'];
  secondFactor: SecondFactorInput;
};

/** メールのリンクによる確定の結果 */
export type ConfirmationResult = {
  __typename?: 'ConfirmationResult';
  /** 確定の操作をした端末が同じ利用者としてログイン中なら、入れ替えた後の利用者 */
  viewer?: Maybe<Viewer>;
};

/** 下書きの破棄 */
export type DiscardLegalDocumentDraftInput = {
  expectedStateVersion: Scalars['Int']['input'];
  kind: LegalDocumentKind;
};

/** フォロー一覧の1行。followedAtはフォローした日時 */
export type FollowEntry = {
  __typename?: 'FollowEntry';
  followedAt: Scalars['DateTime']['output'];
  user: UserSummary;
};

export type FollowEntryConnection = {
  __typename?: 'FollowEntryConnection';
  nodes: Array<FollowEntry>;
  pageInfo: PageInfo;
};

/** フォローの結果。handleは相手の現在のハンドル、followerCountは停止中を除いた相手のフォロワー数 */
export type FollowState = {
  __typename?: 'FollowState';
  followerCount: Scalars['Int']['output'];
  following: Scalars['Boolean']['output'];
  handle: Scalars['String']['output'];
};

/** 未ログインの問い合わせの送信 */
export type GuestInquiryInput = {
  body: Scalars['String']['input'];
  categoryId: Scalars['ID']['input'];
  email: Scalars['String']['input'];
  nickname: Scalars['String']['input'];
};

/** ハンドルの使用可否。INVALIDは形式の違反 */
export type HandleAvailability =
  | 'AVAILABLE'
  | 'INVALID'
  | 'UNAVAILABLE';

/** 問い合わせのカテゴリ */
export type InquiryCategory = {
  __typename?: 'InquiryCategory';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  /** 削除できない標準カテゴリ「その他」なら真 */
  systemDefault: Scalars['Boolean']['output'];
};

/** 問い合わせフォームに表示する送信者 */
export type InquiryComposer = {
  __typename?: 'InquiryComposer';
  /** 未登録・表示できない画像はnull */
  avatar?: Maybe<MediaImage>;
  nickname: Scalars['String']['output'];
};

/** 問い合わせの種別 */
export type InquiryKind =
  | 'GUEST'
  | 'MEMBER';

/** 問い合わせのメッセージ */
export type InquiryMessage = {
  __typename?: 'InquiryMessage';
  /** 利用者のメッセージではnull */
  admin?: Maybe<InquiryReplyAuthor>;
  /** 位置の順。管理者の返信では空 */
  attachments: Array<MediaAttachment>;
  body: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  sender: InquirySender;
};

/** 追加メッセージの送信 */
export type InquiryMessageInput = {
  body: Scalars['String']['input'];
  /** アップロード済みの問い合わせの添付のファイルのID */
  fileIds: Array<Scalars['ID']['input']>;
};

/** 返信した管理者 */
export type InquiryReplyAuthor = {
  __typename?: 'InquiryReplyAuthor';
  /** 未登録・表示できない画像と削除済みの管理者ではnull */
  avatar?: Maybe<MediaImage>;
  deleted: Scalars['Boolean']['output'];
  /** 削除済みの管理者ではnull */
  nickname?: Maybe<Scalars['String']['output']>;
};

/** 管理者の返信の結果 */
export type InquiryReplyResult = {
  __typename?: 'InquiryReplyResult';
  message: InquiryMessage;
  /** 通知メールの送信要求に失敗したら偽 */
  notificationQueued: Scalars['Boolean']['output'];
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

/** 選べない日の範囲(両端を含む業務日付) */
export type LaunchDateRange = {
  __typename?: 'LaunchDateRange';
  from: Scalars['String']['output'];
  reason: LaunchDateUnavailableReason;
  to: Scalars['String']['output'];
};

/** ローンチ日を選べない理由 */
export type LaunchDateUnavailableReason =
  | 'OUT_OF_RANGE'
  | 'PAIRING_DEADLINE'
  | 'RELAUNCH_INTERVAL';

/** 選べるローンチ日。earliestからlatestまでのうちunavailableの範囲を除く日を選べる */
export type LaunchDateWindow = {
  __typename?: 'LaunchDateWindow';
  earliest: Scalars['String']['output'];
  latest: Scalars['String']['output'];
  /** 敗北後の間隔で最も早い日が後ろへずれるときの間隔の日数。それ以外はnull */
  relaunchIntervalDays?: Maybe<Scalars['Int']['output']>;
  unavailable: Array<LaunchDateRange>;
};

export type LaunchHistoryConnection = {
  __typename?: 'LaunchHistoryConnection';
  nodes: Array<LaunchHistoryItem>;
  /** 閲覧者が停止中の本人 */
  ownerSuspended: Scalars['Boolean']['output'];
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
  viewerIsOwner: Scalars['Boolean']['output'];
};

export type LaunchHistoryItem = {
  __typename?: 'LaunchHistoryItem';
  /** Yearを先頭 */
  awards: Array<ProductAward>;
  /** 取消を除く、新しい順 */
  launches: Array<ProductLaunch>;
  product: LaunchHistoryProduct;
};

/** ローンチ履歴のプロダクト */
export type LaunchHistoryProduct = {
  __typename?: 'LaunchHistoryProduct';
  category: ProductCategory;
  handle: Scalars['String']['output'];
  /** 掲載済み(可視かつ予選で勝利したローンチがある) */
  listed: Scalars['Boolean']['output'];
  /** 画像の記録が無ければnull。隔離中の画像は枠だけを返し、objectKeyが空になる */
  logo?: Maybe<MediaImage>;
  name: Scalars['String']['output'];
  tagline: Scalars['String']['output'];
  websiteUrl: Scalars['String']['output'];
};

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

/** ローンチの要約の表示 */
export type LaunchSummary = {
  __typename?: 'LaunchSummary';
  /** トップページで予選マッチを見られる */
  inMatch: Scalars['Boolean']['output'];
  label: Scalars['String']['output'];
};

/** 利用者側に公開する法務文書 */
export type LegalDocument = {
  __typename?: 'LegalDocument';
  kind: LegalDocumentKind;
  /** 準備中ならnull */
  latest?: Maybe<LegalDocumentVersion>;
  /** 新しい順 */
  revisions: Array<LegalRevision>;
};

/** 版を公開した・下書きを保存した管理者 */
export type LegalDocumentEditor = {
  __typename?: 'LegalDocumentEditor';
  id: Scalars['ID']['output'];
  /** 削除済みの管理者ではnull */
  nickname?: Maybe<Scalars['String']['output']>;
};

/** 法務文書の種類 */
export type LegalDocumentKind =
  | 'LEGAL_NOTICE'
  | 'PRIVACY'
  | 'TERMS';

/** 公開した版 */
export type LegalDocumentVersion = {
  __typename?: 'LegalDocumentVersion';
  body: Scalars['String']['output'];
  changeSummary: Scalars['String']['output'];
  isLatest: Scalars['Boolean']['output'];
  kind: LegalDocumentKind;
  publishedAt: Scalars['DateTime']['output'];
  versionNumber: Scalars['Int']['output'];
};

/** 改訂履歴の1版 */
export type LegalRevision = {
  __typename?: 'LegalRevision';
  changeSummary: Scalars['String']['output'];
  publishedAt: Scalars['DateTime']['output'];
  versionNumber: Scalars['Int']['output'];
};

export type LoginInput = {
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
};

export type LoginResult = LoginSucceeded | SecondFactorRequired;

/** ログインの完了 */
export type LoginSucceeded = {
  __typename?: 'LoginSucceeded';
  viewer: Viewer;
};

export type Match = {
  __typename?: 'Match';
  /** 実施日(業務日付のYYYY-MM-DD) */
  date: Scalars['String']['output'];
  /** 確定の前はnull */
  decision?: Maybe<MatchDecision>;
  /** マッチ中の即時の終了で確定した */
  endedEarly: Scalars['Boolean']['output'];
  endsAt: Scalars['DateTime']['output'];
  /** 側の番号の順 */
  entries: Array<MatchEntry>;
  id: Scalars['ID']['output'];
  kind: MatchKind;
  phase: MatchPhase;
  /** トーナメントのラウンドの番号(1回戦が1)。予選はnull */
  round?: Maybe<Scalars['Int']['output']>;
  stage?: Maybe<MatchStage>;
  startsAt: Scalars['DateTime']['output'];
  /** 閲覧者がUpvoteできなければその理由。できればnull */
  viewerRestriction?: Maybe<UpvoteRestriction>;
  /** 閲覧者が有効なUpvoteをしている側。未ログイン・Upvoteなしはnull */
  viewerUpvotedEntryId?: Maybe<Scalars['ID']['output']>;
};

/** 対戦カードにしない不戦勝のマッチ */
export type MatchBye = {
  __typename?: 'MatchBye';
  /** 勝ち上がる側 */
  entry: MatchEntry;
  match: Match;
  reason: ByeReason;
};

/** マッチの決着。VOTESはUpvote数、LAST_UPVOTEは同数での最終Upvote時間、NO_VOTESは両者0票の両者敗北、BOTH_FORFEITEDは両方の側の該当による両者敗北 */
export type MatchDecision =
  | 'BOTH_FORFEITED'
  | 'BYE'
  | 'LAST_UPVOTE'
  | 'NO_VOTES'
  | 'VOTES'
  | 'WALKOVER';

export type MatchEntry = {
  __typename?: 'MatchEntry';
  /** 配色の番号。紐付けを解除した側は0、それ以外はプロダクトのIDで決まる1〜12 */
  colorIndex: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  /** 閲覧者自身のプロダクトの側 */
  isViewerOwn: Scalars['Boolean']['output'];
  /** 表示できなければnull(非公開化・投稿者の退会や停止・論理削除・紐付けの解除) */
  product?: Maybe<MatchProduct>;
  /** 確定の前はnull */
  result?: Maybe<MatchEntryResult>;
  upvoteCount: Scalars['Int']['output'];
};

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

/** マッチの側のプロダクト */
export type MatchProduct = {
  __typename?: 'MatchProduct';
  category: ProductCategory;
  handle: Scalars['String']['output'];
  /** 掲載済み(可視かつ予選で勝利したローンチがある) */
  listed: Scalars['Boolean']['output'];
  /** 画像の記録が無ければnull。隔離中の画像は枠だけを返し、objectKeyが空になる */
  logo?: Maybe<MediaImage>;
  name: Scalars['String']['output'];
  tagline: Scalars['String']['output'];
  websiteUrl: Scalars['String']['output'];
};

/** トーナメントの段階。予選と段階の名前を持たないラウンドはnull */
export type MatchStage =
  | 'FINAL'
  | 'QUARTERFINAL'
  | 'SEMIFINAL';

/** ファイル用の用途のファイル */
export type MediaAttachment = {
  __typename?: 'MediaAttachment';
  byteSize: Scalars['Int']['output'];
  contentType: Scalars['String']['output'];
  /** フロントエンドサーバーのダウンロードのパス */
  downloadPath: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  originalFileName: Scalars['String']['output'];
};

/** 画像用の用途のファイル */
export type MediaImage = {
  __typename?: 'MediaImage';
  fallbackFormat: MediaImageFallbackFormat;
  height?: Maybe<Scalars['Int']['output']>;
  id: Scalars['ID']['output'];
  /** 隔離中・削除待ち・保存未完了の画像は空 */
  objectKey?: Maybe<Scalars['String']['output']>;
  width?: Maybe<Scalars['Int']['output']>;
};

/** AVIF・WebPに非対応のブラウザ向けの形式。原本がJPEGならJPG、SVGならSVG(SVGはこの形式だけで表示する)、それ以外はPNG */
export type MediaImageFallbackFormat =
  | 'JPG'
  | 'PNG'
  | 'SVG';

/** 利用者側のログインの問い合わせ */
export type MemberInquiry = {
  __typename?: 'MemberInquiry';
  /** 停止中の利用者では偽 */
  canPost: Scalars['Boolean']['output'];
  category: InquiryCategory;
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  lastMessageAt: Scalars['DateTime']['output'];
  /** 送信日時の古い順 */
  messages: Array<InquiryMessage>;
  status: InquiryStatus;
};

/** ログインの問い合わせの送信 */
export type MemberInquiryInput = {
  body: Scalars['String']['input'];
  categoryId: Scalars['ID']['input'];
  /** アップロード済みの問い合わせの添付のファイルのID */
  fileIds: Array<Scalars['ID']['input']>;
};

/** 自分の問い合わせの一覧の1ページ */
export type MemberInquiryPage = {
  __typename?: 'MemberInquiryPage';
  items: Array<MemberInquirySummary>;
  /** 続きが無ければnull */
  nextCursor?: Maybe<Scalars['String']['output']>;
};

/** 自分の問い合わせの一覧の1行 */
export type MemberInquirySummary = {
  __typename?: 'MemberInquirySummary';
  category: InquiryCategory;
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  lastMessageAt: Scalars['DateTime']['output'];
  status: InquiryStatus;
};

/** 金額 */
export type Money = {
  __typename?: 'Money';
  /** 最小通貨単位の整数 */
  amount: Scalars['Int']['output'];
  /** ISO 4217の小文字の通貨コード */
  currency: Scalars['String']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  /** メールアドレスとパスワードによるログイン。有効な管理者には必ず第2要素を求める */
  adminLogin: AdminSecondFactorRequired;
  /** この端末のログアウト */
  adminLogout: Scalars['Boolean']['output'];
  /** メールアドレスが確認済みの利用者がマッチ中のマッチのUpvoteを取り消す。Upvoteしていなくても成功する。更新後のマッチを返す */
  cancelUpvote: Match;
  /** パスワードの変更。操作した端末へ新しいセッションを発行する */
  changeAdminPassword: Scalars['Boolean']['output'];
  /** ロールの変更 */
  changeAdminRole: AdminAccount;
  /** 対応ステータスの変更。変更後の詳細を返す。モデレーター以上 */
  changeInquiryStatus: AdminInquiry;
  /** 招待の完了の2段階目。認証コードで有効化し、ログインする */
  completeAdminInvitation: AdminRecoveryCodeSet;
  /** 認証コードかリカバリコードによるログインの完了 */
  completeAdminSecondFactorLogin: AdminViewer;
  /** 多要素認証の再設定の完了。操作した端末へ新しいセッションを発行する */
  completeAdminTotpReset: AdminRecoveryCodeSet;
  /** 認証コードかリカバリコードによるログインの完了 */
  completeSecondFactorLogin: Viewer;
  /** メールアドレス変更の確定 */
  confirmAdminEmailChange: AdminConfirmationResult;
  /** 決済後のランディングでの決済セッションの確認と反映。Stripeに到達できなければ未完了の購入を処理中として返す */
  confirmCheckoutReturn: CheckoutReturnResult;
  /** メールアドレス変更の確定 */
  confirmEmailChange: ConfirmationResult;
  /** パスワード変更の確定 */
  confirmPasswordChange: ConfirmationResult;
  /** カテゴリの追加。モデレーター以上 */
  createInquiryCategory: InquiryCategory;
  /** モデレーター以上の管理者がプロダクトカテゴリを追加する */
  createProductCategory: ProductCategory;
  /** Customer Portalのセッションの作成。加入したことがある本人のStripe Customerにセッションを作り、移動先のURLを返す。戻り先はプラン管理画面 */
  createUltrasPortalSession: UltrasPortalSession;
  /** 管理者の削除 */
  deleteAdmin: Scalars['Boolean']['output'];
  /** カテゴリの削除。紐付く問い合わせを標準カテゴリへ付け替える。モデレーター以上 */
  deleteInquiryCategory: Scalars['Boolean']['output'];
  /** 停止していない利用者が自分のプロダクトを論理削除する。bot判定の操作名はproduct_delete */
  deleteProduct: Scalars['Boolean']['output'];
  /** モデレーター以上の管理者がプロダクトの紐付かないプロダクトカテゴリを削除する。標準カテゴリは削除できない */
  deleteProductCategory: Scalars['Boolean']['output'];
  /** 多要素認証の無効化 */
  disableTotp: Scalars['Boolean']['output'];
  /** 下書きの破棄。最上位管理者 */
  discardLegalDocumentDraft: AdminLegalDocument;
  /** 多要素認証の有効化 */
  enableTotp: RecoveryCodeSet;
  /** メールアドレスが確認済みの利用者がフォローする。すでにフォロー済みでも成功する */
  followUser: FollowState;
  /** 閲覧のみのロールで招待し、招待のメールを送る */
  inviteAdmin: AdminAccount;
  /** メールアドレスとパスワードによるログイン */
  login: LoginResult;
  /** この端末のログアウト */
  logout: Scalars['Boolean']['output'];
  /** 本人の問い合わせへの追加メッセージ */
  postInquiryMessage: InquiryMessage;
  /** 下書きの公開。最上位管理者 */
  publishLegalDocument: AdminLegalDocument;
  /** 支払いの確定の前の同意の記録。支払える状態の本人の購入だけに記録し、同じ購入の再記録は最新の日時で上書きする */
  recordCheckoutConsent: Checkout;
  /** リカバリコードの再発行。操作した端末へ新しいセッションを発行する */
  regenerateAdminRecoveryCodes: AdminRecoveryCodeSet;
  /** リカバリコードの再発行 */
  regenerateRecoveryCodes: RecoveryCodeSet;
  /** メールアドレスを確認済みの利用者がプロダクトと最初のローンチを登録する。bot判定の操作名はproduct_save */
  registerProduct: MyProduct;
  /** 利用者の登録 */
  registerUser: Viewer;
  /** カテゴリの名前の変更。標準カテゴリは変更できない。モデレーター以上 */
  renameInquiryCategory: InquiryCategory;
  /** ログインの問い合わせへの管理者の返信。対応ステータスを変えない。モデレーター以上 */
  replyToInquiry: InquiryReplyResult;
  /** メールアドレス変更の要求。重複の有無を問わず同じ結果を返す */
  requestAdminEmailChange: Scalars['Boolean']['output'];
  /** パスワードリセットの要求。管理者の有無と状態を問わず同じ結果を返す */
  requestAdminPasswordReset: Scalars['Boolean']['output'];
  /** メールアドレス変更の要求 */
  requestEmailChange: Scalars['Boolean']['output'];
  /** パスワード変更の要求 */
  requestPasswordChange: Scalars['Boolean']['output'];
  /** パスワードリセットの要求。アカウントの有無を問わず同じ結果を返す */
  requestPasswordReset: Scalars['Boolean']['output'];
  /** 招待中の管理者へ招待のリンクを送り直す */
  resendAdminInvitation: AdminAccount;
  /** 確認メールの再送 */
  resendVerificationEmail: ResendVerificationResult;
  /** パスワードリセットの確定 */
  resetAdminPassword: Scalars['Boolean']['output'];
  /** パスワードリセットの確定 */
  resetPassword: Scalars['Boolean']['output'];
  /** 操作している端末以外のセッションの一括の失効。失効させた件数を返す */
  revokeOtherSessions: Scalars['Int']['output'];
  /** セッションの個別の失効 */
  revokeSession: Scalars['Boolean']['output'];
  /** 下書きの保存。最上位管理者 */
  saveLegalDocumentDraft: AdminLegalDocument;
  /** 招待の完了の1段階目。ニックネームとパスワードを仮に保存し、多要素認証の設定を始める */
  startAdminInvitation: AdminTotpSetup;
  /** 多要素認証の再設定の開始。完了まで現在の設定が有効なまま残る */
  startAdminTotpReset: AdminTotpSetup;
  /** 疎通確認用の決済の開始。疎通確認を有効にした環境だけで受け付ける */
  startSmokeCheckout: CheckoutStart;
  /** 多要素認証の設定の開始 */
  startTotpSetup: TotpSetup;
  /** Ultrasの加入の開始。加入できるかを確かめて購入を作り、決済画面の経路に使う購入のIDを返す */
  startUltrasCheckout: CheckoutStart;
  /** 未ログイン(停止中の利用者を含む)の問い合わせの送信 */
  submitGuestInquiry: Scalars['Boolean']['output'];
  /** 停止していないログイン中の利用者の問い合わせの送信 */
  submitMemberInquiry: MemberInquiry;
  /** 停止中でない利用者がフォローを解除する。フォローしていなくても成功する */
  unfollowUser: FollowState;
  /** プロフィールの更新。avatarFileIdの省略は画像を取り除く */
  updateAdminProfile: AdminAccount;
  /** メールアドレスが未確認の利用者も保存できる。停止中の利用者は保存できない */
  updateMyProfile: MyProfile;
  /** 停止していない利用者が自分のプロダクトを保存する。bot判定の操作名はproduct_save */
  updateProduct: MyProduct;
  /** モデレーター以上の管理者がプロダクトカテゴリの名前とハンドルを変更する。標準カテゴリは変更できない */
  updateProductCategory: ProductCategory;
  /** 機能フラグの変更。読み取った版と一致するときだけ保存して監査ログに記録し、変更後の設定を返す。最上位管理者 */
  updateUltrasPromotionSetting: UltrasPromotionSetting;
  /** メールアドレスが確認済みの利用者がマッチ中のマッチの一方の側にUpvoteする。もう一方の側にUpvote済みなら付け替え、同じ側なら何も変えない。更新後のマッチを返す */
  upvote: Match;
  /** メールアドレスの確認の確定 */
  verifyEmail: Scalars['Boolean']['output'];
  /** 退会 */
  withdraw: Scalars['Boolean']['output'];
};


export type MutationAdminLoginArgs = {
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
};


export type MutationCancelUpvoteArgs = {
  matchId: Scalars['ID']['input'];
};


export type MutationChangeAdminPasswordArgs = {
  newPassword: Scalars['String']['input'];
  reAuthentication: AdminReAuthenticationInput;
};


export type MutationChangeAdminRoleArgs = {
  id: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
  role: AdminRole;
};


export type MutationChangeInquiryStatusArgs = {
  inquiryId: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
  status: InquiryStatus;
};


export type MutationCompleteAdminInvitationArgs = {
  token: Scalars['String']['input'];
  totpCode: Scalars['String']['input'];
};


export type MutationCompleteAdminSecondFactorLoginArgs = {
  challenge: Scalars['String']['input'];
  secondFactor: AdminSecondFactorInput;
};


export type MutationCompleteAdminTotpResetArgs = {
  totpCode: Scalars['String']['input'];
};


export type MutationCompleteSecondFactorLoginArgs = {
  input: CompleteSecondFactorLoginInput;
};


export type MutationConfirmAdminEmailChangeArgs = {
  token: Scalars['String']['input'];
};


export type MutationConfirmCheckoutReturnArgs = {
  sessionId: Scalars['String']['input'];
};


export type MutationConfirmEmailChangeArgs = {
  token: Scalars['String']['input'];
};


export type MutationConfirmPasswordChangeArgs = {
  token: Scalars['String']['input'];
};


export type MutationCreateInquiryCategoryArgs = {
  name: Scalars['String']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCreateProductCategoryArgs = {
  input: ProductCategoryInput;
  reason?: InputMaybe<Scalars['String']['input']>;
};


export type MutationDeleteAdminArgs = {
  id: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
};


export type MutationDeleteInquiryCategoryArgs = {
  id: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
};


export type MutationDeleteProductArgs = {
  expectedVersion: Scalars['Int']['input'];
  productHandle: Scalars['String']['input'];
};


export type MutationDeleteProductCategoryArgs = {
  id: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
};


export type MutationDisableTotpArgs = {
  input: ReAuthenticationInput;
};


export type MutationDiscardLegalDocumentDraftArgs = {
  input: DiscardLegalDocumentDraftInput;
};


export type MutationEnableTotpArgs = {
  totpCode: Scalars['String']['input'];
};


export type MutationFollowUserArgs = {
  handle: Scalars['String']['input'];
};


export type MutationInviteAdminArgs = {
  email: Scalars['String']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
};


export type MutationLoginArgs = {
  input: LoginInput;
};


export type MutationPostInquiryMessageArgs = {
  input: InquiryMessageInput;
  inquiryId: Scalars['ID']['input'];
};


export type MutationPublishLegalDocumentArgs = {
  input: PublishLegalDocumentInput;
};


export type MutationRecordCheckoutConsentArgs = {
  purchaseId: Scalars['ID']['input'];
};


export type MutationRegenerateAdminRecoveryCodesArgs = {
  reAuthentication: AdminReAuthenticationInput;
};


export type MutationRegenerateRecoveryCodesArgs = {
  input: ReAuthenticationInput;
};


export type MutationRegisterProductArgs = {
  input: RegisterProductInput;
};


export type MutationRegisterUserArgs = {
  input: RegisterUserInput;
};


export type MutationRenameInquiryCategoryArgs = {
  id: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
};


export type MutationReplyToInquiryArgs = {
  body: Scalars['String']['input'];
  inquiryId: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
};


export type MutationRequestAdminEmailChangeArgs = {
  newEmail: Scalars['String']['input'];
  reAuthentication: AdminReAuthenticationInput;
};


export type MutationRequestAdminPasswordResetArgs = {
  email: Scalars['String']['input'];
};


export type MutationRequestEmailChangeArgs = {
  input: RequestEmailChangeInput;
};


export type MutationRequestPasswordChangeArgs = {
  input: RequestPasswordChangeInput;
};


export type MutationRequestPasswordResetArgs = {
  email: Scalars['String']['input'];
};


export type MutationResendAdminInvitationArgs = {
  id: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
};


export type MutationResetAdminPasswordArgs = {
  newPassword: Scalars['String']['input'];
  token: Scalars['String']['input'];
};


export type MutationResetPasswordArgs = {
  input: ResetPasswordInput;
};


export type MutationRevokeSessionArgs = {
  id: Scalars['ID']['input'];
};


export type MutationSaveLegalDocumentDraftArgs = {
  input: SaveLegalDocumentDraftInput;
};


export type MutationStartAdminInvitationArgs = {
  nickname: Scalars['String']['input'];
  password: Scalars['String']['input'];
  token: Scalars['String']['input'];
};


export type MutationStartAdminTotpResetArgs = {
  reAuthentication: AdminReAuthenticationInput;
};


export type MutationStartTotpSetupArgs = {
  input: ReAuthenticationInput;
};


export type MutationSubmitGuestInquiryArgs = {
  input: GuestInquiryInput;
};


export type MutationSubmitMemberInquiryArgs = {
  input: MemberInquiryInput;
};


export type MutationUnfollowUserArgs = {
  handle: Scalars['String']['input'];
};


export type MutationUpdateAdminProfileArgs = {
  avatarFileId?: InputMaybe<Scalars['ID']['input']>;
  id: Scalars['ID']['input'];
  nickname: Scalars['String']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
};


export type MutationUpdateMyProfileArgs = {
  input: UpdateMyProfileInput;
};


export type MutationUpdateProductArgs = {
  input: UpdateProductInput;
};


export type MutationUpdateProductCategoryArgs = {
  id: Scalars['ID']['input'];
  input: ProductCategoryInput;
  reason?: InputMaybe<Scalars['String']['input']>;
};


export type MutationUpdateUltrasPromotionSettingArgs = {
  input: UpdateUltrasPromotionSettingInput;
};


export type MutationUpvoteArgs = {
  input: UpvoteInput;
};


export type MutationVerifyEmailArgs = {
  token: Scalars['String']['input'];
};


export type MutationWithdrawArgs = {
  input: ReAuthenticationInput;
};

/** 自分のプロダクトの編集用の情報 */
export type MyProduct = {
  __typename?: 'MyProduct';
  category: ProductCategory;
  /** マークダウンの説明文 */
  description: Scalars['String']['output'];
  handle: Scalars['String']['output'];
  /** 非公開化中 */
  hidden: Scalars['Boolean']['output'];
  /** 取消を除く直近のローンチ */
  latestLaunch?: Maybe<ProductLaunch>;
  /** 掲載済み(可視かつ予選で勝利したローンチがある) */
  listed: Scalars['Boolean']['output'];
  /** 画像の記録が無ければnull。隔離中の画像は枠だけを返し、objectKeyが空になる */
  logo?: Maybe<MediaImage>;
  logoFileId: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  plan: ProductLaunchPlan;
  /** 保持中の旧ハンドル。無ければnull */
  previousHandle?: Maybe<Scalars['String']['output']>;
  /** 表示順 */
  screenshots: Array<ProductScreenshot>;
  tagline: Scalars['String']['output'];
  /** 編集の競合の検出に使う版 */
  version: Scalars['Int']['output'];
  websiteUrl: Scalars['String']['output'];
};

export type MyProductConnection = {
  __typename?: 'MyProductConnection';
  nodes: Array<MyProduct>;
  pageInfo: PageInfo;
};

/** 自分のプロダクトの旧ハンドルでの照会。handleは転送先の現在のハンドル */
export type MyProductRedirect = {
  __typename?: 'MyProductRedirect';
  handle: Scalars['String']['output'];
};

export type MyProductResult = MyProduct | MyProductRedirect;

export type MyProfile = {
  __typename?: 'MyProfile';
  avatar?: Maybe<MediaImage>;
  bio?: Maybe<Scalars['String']['output']>;
  handle: Scalars['String']['output'];
  headline?: Maybe<Scalars['String']['output']>;
  nickname: Scalars['String']['output'];
  /** 保持中の旧ハンドル。無ければnull */
  previousHandle?: Maybe<Scalars['String']['output']>;
  suspended: Scalars['Boolean']['output'];
  websites: Array<ProfileWebsite>;
};

export type OffsetPageInfo = {
  __typename?: 'OffsetPageInfo';
  page: Scalars['Int']['output'];
  perPage: Scalars['Int']['output'];
  totalCount: Scalars['Int']['output'];
  totalPages: Scalars['Int']['output'];
};

export type PageInfo = {
  __typename?: 'PageInfo';
  endCursor?: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
};

/** 決済履歴の1件 */
export type PaymentRecord = {
  __typename?: 'PaymentRecord';
  /** 返金・チャージバックの引き落としは負 */
  amount: Money;
  id: Scalars['ID']['output'];
  kind: PaymentRecordKind;
  occurredAt: Scalars['DateTime']['output'];
  purpose: PurchaseKind;
  /** 数量の無い記録はnull */
  quantity?: Maybe<Scalars['Int']['output']>;
  status: PaymentRecordStatus;
};

/** 決済履歴の一覧 */
export type PaymentRecordConnection = {
  __typename?: 'PaymentRecordConnection';
  nodes: Array<PaymentRecord>;
  pageInfo: PageInfo;
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

/** 賞の種類ごとの受賞 */
export type ProductAward = {
  __typename?: 'ProductAward';
  count: Scalars['Int']['output'];
  kind: ProductAwardKind;
  /** 受賞の週・年。公開プロフィールの受賞(profileAwards)では先頭に受賞したプロダクトの名称を付ける */
  labels: Array<Scalars['String']['output']>;
};

export type ProductAwardKind =
  | 'WEEK'
  | 'YEAR';

export type ProductCategory = {
  __typename?: 'ProductCategory';
  handle: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  /** 標準カテゴリ「その他」なら真。変更・削除できない */
  systemDefault: Scalars['Boolean']['output'];
};

/** プロダクトカテゴリの追加・変更の項目 */
export type ProductCategoryInput = {
  /** プロダクトのハンドルと同じ形式で50文字以内 */
  handle: Scalars['String']['input'];
  /** 前後の空白を除いて1〜30文字 */
  name: Scalars['String']['input'];
};

/** プロダクトの登録・編集で全件を送る項目 */
export type ProductFieldsInput = {
  categoryId: Scalars['ID']['input'];
  /** マークダウンの説明文(1〜20,000文字) */
  description: Scalars['String']['input'];
  handle: Scalars['String']['input'];
  /** 本人がアップロードしたロゴの画像 */
  logoFileId: Scalars['ID']['input'];
  /** 前後の空白を除いて1〜50文字 */
  name: Scalars['String']['input'];
  /** 表示順。0〜20件で重複なし */
  screenshotFileIds: Array<Scalars['ID']['input']>;
  /** 前後の空白を除いて1〜100文字 */
  tagline: Scalars['String']['input'];
  /** httpかhttpsの2,048文字以内の絶対URL */
  websiteUrl: Scalars['String']['input'];
};

export type ProductLaunch = {
  __typename?: 'ProductLaunch';
  id: Scalars['ID']['output'];
  kickoffAt: Scalars['DateTime']['output'];
  /** 業務日付(YYYY-MM-DD) */
  launchDate: Scalars['String']['output'];
  /** 取消を除いて古い順に1から数える。取消は0 */
  number: Scalars['Int']['output'];
  outcome?: Maybe<QualifierOutcome>;
  status: LaunchStatus;
  summary: LaunchSummary;
};

export type ProductLaunchPlan = {
  __typename?: 'ProductLaunchPlan';
  /** BLOCKEDのときの理由 */
  blocks: Array<RelaunchBlockView>;
  /** RESCHEDULEのときの予定のローンチ日 */
  currentLaunchDate?: Maybe<Scalars['String']['output']>;
  /** 固定の判定ができない。ローンチ日・カテゴリの変更と削除を受け付けない */
  lockUnknown: Scalars['Boolean']['output'];
  locked: Scalars['Boolean']['output'];
  locks: Array<ProductLockView>;
  mode: LaunchPlanMode;
  /** 敗北後の間隔をUltrasの加入で短くしている */
  ultrasEntitled: Scalars['Boolean']['output'];
  /** NEW・RESCHEDULEのときの選べる日 */
  window?: Maybe<LaunchDateWindow>;
};

/** ローンチ日・カテゴリの変更と削除の固定の理由 */
export type ProductLockView = {
  __typename?: 'ProductLockView';
  code: Scalars['String']['output'];
  message: Scalars['String']['output'];
};

/** プロダクト詳細ページの投稿者本人向けの操作の状態 */
export type ProductOwnerStatus = {
  __typename?: 'ProductOwnerStatus';
  /** 取消を除く直近のローンチ */
  latestLaunch?: Maybe<ProductLaunch>;
  plan: ProductLaunchPlan;
};

export type ProductScreenshot = {
  __typename?: 'ProductScreenshot';
  /** 画像のバイト数。編集画面で保存済みの合計を数えるのに使う。画像の記録が無ければ0 */
  byteSize: Scalars['Int']['output'];
  fileId: Scalars['ID']['output'];
  /** 画像の記録が無ければnull。隔離中の画像は枠だけを返し、objectKeyが空になる */
  image?: Maybe<MediaImage>;
};

/** 公開プロフィールの閲覧者と表示される利用者の関係 */
export type ProfileViewerRelation =
  | 'FOLLOWING'
  | 'GUEST'
  | 'NOT_FOLLOWING'
  | 'OWNER';

export type ProfileWebsite = {
  __typename?: 'ProfileWebsite';
  /** 未入力ならnull。画面はホスト名を表示する */
  name?: Maybe<Scalars['String']['output']>;
  url: Scalars['String']['output'];
};

export type ProfileWebsiteInput = {
  name?: InputMaybe<Scalars['String']['input']>;
  url: Scalars['String']['input'];
};

export type PublicProfile = {
  __typename?: 'PublicProfile';
  avatar?: Maybe<MediaImage>;
  /** マークダウンの自己紹介。未設定ならnull */
  bio?: Maybe<Scalars['String']['output']>;
  /** 停止中の利用者を除いたフォロワー数 */
  followerCount: Scalars['Int']['output'];
  handle: Scalars['String']['output'];
  headline?: Maybe<Scalars['String']['output']>;
  nickname: Scalars['String']['output'];
  /** 本人が停止中のときだけtrue。他の閲覧者には停止中の利用者のプロフィールを返さない */
  suspended: Scalars['Boolean']['output'];
  ultras: Scalars['Boolean']['output'];
  viewerRelation: ProfileViewerRelation;
  websites: Array<ProfileWebsite>;
};

/** 旧ハンドルでの閲覧。handleは転送先の現在のハンドル */
export type PublicProfileRedirect = {
  __typename?: 'PublicProfileRedirect';
  handle: Scalars['String']['output'];
};

export type PublicProfileResult = PublicProfile | PublicProfileRedirect;

/** 下書きの公開 */
export type PublishLegalDocumentInput = {
  changeSummary: Scalars['String']['input'];
  expectedStateVersion: Scalars['Int']['input'];
  kind: LegalDocumentKind;
};

/** 購入種別 */
export type PurchaseKind =
  | 'PAYMENTS_SMOKE'
  | 'SPONSORSHIP'
  | 'ULTRAS'
  | 'WEEK_TOURNAMENT_ENTRY'
  | 'YEAR_TOURNAMENT_ENTRY';

/** トップページの当日の予選 */
export type QualifierBoard = {
  __typename?: 'QualifierBoard';
  /** 当日のペアリングが未完了、または開始の日時を過ぎて開始も確定もしていない当日の予選がある */
  awaitingKickoff: Scalars['Boolean']['output'];
  /** 不戦勝。マッチのIDの順 */
  byes: Array<MatchBye>;
  /** 業務日付(YYYY-MM-DD) */
  date: Scalars['String']['output'];
  /** 当日の予選の終了の時刻 */
  fullTimeAt: Scalars['DateTime']['output'];
  /** 対戦カードと即時の終了の不戦勝の数 */
  heldCount: Scalars['Int']['output'];
  /** 対戦カード。合計のUpvote数が最も多いマッチを先頭に、残りを合計の少ない順に並べる */
  matches: Array<Match>;
  /** 翌日のキックオフの時刻 */
  nextKickoffAt: Scalars['DateTime']['output'];
  phase: QualifierBoardPhase;
  /** 照会の時点のサーバーの時刻。カウントダウンを合わせるのに使う */
  serverTime: Scalars['DateTime']['output'];
};

/** トップページの予選の表示。LIVEは終了の時刻(23:40)の前、RESULTはその後の結果の表示 */
export type QualifierBoardPhase =
  | 'LIVE'
  | 'RESULT';

export type QualifierOutcome =
  | 'LOST'
  | 'WON';

export type Query = {
  __typename?: 'Query';
  /** 招待中を含む全管理者を登録の新しい順に返す */
  adminAccounts: Array<AdminAccount>;
  /** 管理画面のログインと未ログインの問い合わせの一覧(50件ずつ、受付日時の新しい順)。閲覧のみ以上 */
  adminInquiries: AdminInquiryPage;
  /** 管理画面の問い合わせの詳細。退会済みも返し、見つからなければnull。閲覧のみ以上 */
  adminInquiry?: Maybe<AdminInquiry>;
  /** 紐付く問い合わせの件数付きのカテゴリ。追加の順で、標準カテゴリを末尾に置く。閲覧のみ以上 */
  adminInquiryCategories: Array<AdminInquiryCategory>;
  /** 管理画面の編集の対象の法務文書。閲覧のみ以上の管理者 */
  adminLegalDocument: AdminLegalDocument;
  /** 管理画面で表示する版。存在しない版はnull。閲覧のみ以上の管理者 */
  adminLegalDocumentVersion?: Maybe<AdminLegalDocumentVersion>;
  /** 管理画面の法務文書の一覧。閲覧のみ以上の管理者 */
  adminLegalDocuments: Array<AdminLegalDocumentSummary>;
  /** 管理者向けのプロダクトカテゴリの一覧。productCategoriesと同じ順 */
  adminProductCategories: Array<ProductCategory>;
  /** 退会済みを除く「未対応」のログインと未ログインの問い合わせの合計件数。閲覧のみ以上 */
  adminUnhandledInquiryCount: Scalars['Int']['output'];
  /** ログイン中の管理者。未ログイン・無効なセッションではnull */
  adminViewer?: Maybe<AdminViewer>;
  /** 監査ログの検索。変更・削除の操作は無い */
  auditLogs: AuditLogPage;
  /** 本人の購入の決済画面の表示事項。他人・存在しない購入はcheckout_not_found */
  checkout: Checkout;
  /** ハンドルの使用可否。自分の現在と保持中の旧ハンドルは使えるものとして扱う */
  handleAvailability: HandleAvailability;
  /** 問い合わせフォームのカテゴリの選択肢。追加の順で、標準カテゴリを末尾に置く */
  inquiryCategories: Array<InquiryCategory>;
  /** 問い合わせフォームに表示する送信者。停止していないログイン中の利用者だけ値を返す */
  inquiryComposer?: Maybe<InquiryComposer>;
  /** 公開プロフィールのローンチ履歴。他人には掲載済みの、本人には論理削除していない自分のプロダクトを、いずれも非公開化中を除いて最新のローンチ日の新しい順に返す。利用者を表示できなければnull。firstは1〜20 */
  launchHistory?: Maybe<LaunchHistoryConnection>;
  /** 法務文書の最新版と改訂履歴 */
  legalDocument: LegalDocument;
  /** 法務文書の指定した版。存在しない版はnull */
  legalDocumentVersion?: Maybe<LegalDocumentVersion>;
  /** 本人の問い合わせのチャット。本人の問い合わせでなければnull */
  memberInquiry?: Maybe<MemberInquiry>;
  /** ログイン中の利用者(停止中を含む)をフォローしている、停止中でない利用者を新しい順に返す。firstは1〜20 */
  myFollowers: FollowEntryConnection;
  /** ログイン中の利用者(停止中を含む)がフォローしている、停止中でない利用者を新しい順に返す。firstは1〜20 */
  myFollowing: FollowEntryConnection;
  /** 自分のログインの問い合わせの一覧(20件ずつ、送信日時の新しい順)。停止中の利用者も読める */
  myInquiries: MemberInquiryPage;
  /** 他人・論理削除済み・不在はnull(404)。自分のプロダクトの旧ハンドルは転送先を返す */
  myProduct?: Maybe<MyProductResult>;
  /** ログイン中の利用者(停止中を含む)の論理削除していないプロダクトを最新のローンチ日の新しい順に返す。firstは1〜20 */
  myProducts: MyProductConnection;
  /** ログイン中の利用者(停止中を含む)のプロフィール編集用の情報 */
  myProfile: MyProfile;
  /** ログイン中の端末の一覧 */
  mySessions: Array<UserSessionSummary>;
  /** 登録画面で選べるローンチ日 */
  newProductLaunchWindow: LaunchDateWindow;
  /** ログイン中の利用者の決済履歴(既定20件・1〜50件、発生時刻の新しい順) */
  paymentHistory: PaymentRecordConnection;
  /** プロダクトカテゴリを追加の順で、標準カテゴリを末尾に置いて返す */
  productCategories: Array<ProductCategory>;
  /** プロダクトのハンドルの使用可否。productHandleは編集中のプロダクトの現在のハンドルで、その現在と保持中の旧ハンドルは使えるものとして扱う */
  productHandleAvailability: HandleAvailability;
  /** 現在のハンドルで本人のプロダクトだけ。それ以外はnull */
  productOwnerStatus?: Maybe<ProductOwnerStatus>;
  /** 公開プロフィールの受賞バッジ。launchHistoryと同じ対象のプロダクトの受賞を、Yearを先頭に種類ごとにまとめて返す。ラベルの先頭に受賞したプロダクトの名称を付ける。利用者を表示できなければnull */
  profileAwards?: Maybe<Array<ProductAward>>;
  /** 見つからない・表示できないハンドルではnull(404)。旧ハンドルは転送先を返す */
  publicProfile?: Maybe<PublicProfileResult>;
  /** トップページの当日の予選。開始済みの予選を対戦カードと不戦勝に分けて返す。ログインを求めない */
  qualifierBoard: QualifierBoard;
  /** APIサーバーの時刻とデータベースへの到達可否 */
  systemStatus: SystemStatus;
  /** Ultrasの月額の価格と新規の加入の受付の状態。ログイン不要 */
  ultrasOffer: UltrasOffer;
  /** 有料プラン導線の機能フラグの現在の値と最後の変更。閲覧のみ以上の管理者 */
  ultrasPromotionSetting: UltrasPromotionSetting;
  /** ログイン中の利用者。未ログイン・無効なセッションではnull */
  viewer?: Maybe<Viewer>;
  /** ログイン中の利用者のUltrasの加入状態と特典の有無。未ログインはnull */
  viewerUltras?: Maybe<ViewerUltras>;
};


export type QueryAdminInquiriesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<AdminInquiryFilterInput>;
};


export type QueryAdminInquiryArgs = {
  id: Scalars['ID']['input'];
};


export type QueryAdminLegalDocumentArgs = {
  kind: LegalDocumentKind;
};


export type QueryAdminLegalDocumentVersionArgs = {
  kind: LegalDocumentKind;
  versionNumber: Scalars['Int']['input'];
};


export type QueryAuditLogsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<AuditLogFilterInput>;
};


export type QueryCheckoutArgs = {
  purchaseId: Scalars['ID']['input'];
};


export type QueryHandleAvailabilityArgs = {
  handle: Scalars['String']['input'];
};


export type QueryLaunchHistoryArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first: Scalars['Int']['input'];
  userHandle: Scalars['String']['input'];
};


export type QueryLegalDocumentArgs = {
  kind: LegalDocumentKind;
};


export type QueryLegalDocumentVersionArgs = {
  kind: LegalDocumentKind;
  versionNumber: Scalars['Int']['input'];
};


export type QueryMemberInquiryArgs = {
  id: Scalars['ID']['input'];
};


export type QueryMyFollowersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first: Scalars['Int']['input'];
};


export type QueryMyFollowingArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first: Scalars['Int']['input'];
};


export type QueryMyInquiriesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
};


export type QueryMyProductArgs = {
  handle: Scalars['String']['input'];
};


export type QueryMyProductsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first: Scalars['Int']['input'];
};


export type QueryPaymentHistoryArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryProductHandleAvailabilityArgs = {
  handle: Scalars['String']['input'];
  productHandle?: InputMaybe<Scalars['String']['input']>;
};


export type QueryProductOwnerStatusArgs = {
  productHandle: Scalars['String']['input'];
};


export type QueryProfileAwardsArgs = {
  userHandle: Scalars['String']['input'];
};


export type QueryPublicProfileArgs = {
  handle: Scalars['String']['input'];
};

/** 重要な操作の本人確認 */
export type ReAuthenticationInput = {
  currentPassword: Scalars['String']['input'];
  /** 多要素認証が有効なときだけ必要 */
  secondFactor?: InputMaybe<SecondFactorInput>;
};

/** この応答でだけ見せるリカバリコード */
export type RecoveryCodeSet = {
  __typename?: 'RecoveryCodeSet';
  codes: Array<Scalars['String']['output']>;
};

export type RegisterProductInput = {
  fields: ProductFieldsInput;
  /** 最初のローンチのローンチ日(YYYY-MM-DD) */
  launchDate: Scalars['String']['input'];
};

export type RegisterUserInput = {
  /** 利用規約とプライバシーポリシー(18歳以上であることの表明を含む)への同意 */
  agreedToTerms: Scalars['Boolean']['input'];
  email: Scalars['String']['input'];
  nickname: Scalars['String']['input'];
  password: Scalars['String']['input'];
};

/** 次回の予約ができない理由 */
export type RelaunchBlockView = {
  __typename?: 'RelaunchBlockView';
  code: Scalars['String']['output'];
  message: Scalars['String']['output'];
  /** 解除の日時。分からなければnull */
  releaseAt?: Maybe<Scalars['DateTime']['output']>;
};

export type RequestEmailChangeInput = {
  newEmail: Scalars['String']['input'];
  reAuthentication: ReAuthenticationInput;
};

export type RequestPasswordChangeInput = {
  newPassword: Scalars['String']['input'];
  reAuthentication: ReAuthenticationInput;
};

/** 確認メールの再送の結果 */
export type ResendVerificationResult =
  | 'ALREADY_VERIFIED'
  | 'SENT';

export type ResetPasswordInput = {
  newPassword: Scalars['String']['input'];
  token: Scalars['String']['input'];
};

/** 下書きの保存 */
export type SaveLegalDocumentDraftInput = {
  body: Scalars['String']['input'];
  expectedStateVersion: Scalars['Int']['input'];
  kind: LegalDocumentKind;
};

/** 認証コードかリカバリコードのどちらか一方 */
export type SecondFactorInput = {
  recoveryCode?: InputMaybe<Scalars['String']['input']>;
  totpCode?: InputMaybe<Scalars['String']['input']>;
};

/** 第2要素の入力の待ち */
export type SecondFactorRequired = {
  __typename?: 'SecondFactorRequired';
  /** 第2要素の段階の要求と組にする値 */
  challenge: Scalars['String']['output'];
  expiresAt: Scalars['DateTime']['output'];
};

export type SystemStatus = {
  __typename?: 'SystemStatus';
  databaseReachable: Scalars['Boolean']['output'];
  serverTime: Scalars['DateTime']['output'];
};

/** 認証アプリへ登録する多要素認証の設定 */
export type TotpSetup = {
  __typename?: 'TotpSetup';
  expiresAt: Scalars['DateTime']['output'];
  otpauthUri: Scalars['String']['output'];
  /** 認証アプリへ手入力するためのbase32 */
  secret: Scalars['String']['output'];
};

/** 料金ページが表示するUltrasの料金と受付の状態 */
export type UltrasOffer = {
  __typename?: 'UltrasOffer';
  /** 月額の価格(税込のUSD)。照会できなければnull */
  price?: Maybe<Money>;
  /** Stripeに到達できず、以前に照会した価格を返したときに真 */
  priceStale: Scalars['Boolean']['output'];
  /** 新規の加入を受け付けているか(有料プラン導線の機能フラグ) */
  promotionEnabled: Scalars['Boolean']['output'];
};

/** 利用者の最新の有効化された加入 */
export type UltrasPlan = {
  __typename?: 'UltrasPlan';
  /** 特典の終了日時。右に開いていればnull */
  benefitEndsAt?: Maybe<Scalars['DateTime']['output']>;
  /** 解約の操作の日時 */
  canceledAt?: Maybe<Scalars['DateTime']['output']>;
  /** 次回の更新日時(課金期間の終了日時) */
  currentPeriodEndsAt?: Maybe<Scalars['DateTime']['output']>;
  /** 加入の開始日時 */
  startedAt: Scalars['DateTime']['output'];
  status: UltrasPlanStatus;
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

/** Customer Portalへ移動するためのセッション */
export type UltrasPortalSession = {
  __typename?: 'UltrasPortalSession';
  /** Customer PortalのURL。作成の直後に移動に使う */
  url: Scalars['String']['output'];
};

/** 有料プラン導線の機能フラグ */
export type UltrasPromotionSetting = {
  __typename?: 'UltrasPromotionSetting';
  /** 未加入者に導線を表示し、新規の加入を受け付けるか */
  enabled: Scalars['Boolean']['output'];
  /** 最後に変更した日時 */
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
  /** 最後に変更した管理者のニックネーム。管理者の変更が無い・削除済みはnull */
  updatedByNickname?: Maybe<Scalars['String']['output']>;
  /** 変更のたびに1つ進む版。変更の入力にそのまま渡す */
  version: Scalars['Int']['output'];
};

export type UpdateMyProfileInput = {
  /** 保存後の画像。現在の画像のIDなら維持し、nullなら削除する */
  avatarFileId?: InputMaybe<Scalars['ID']['input']>;
  bio?: InputMaybe<Scalars['String']['input']>;
  /** 画面を開いた時点のハンドル。保存の間に変更されていれば保存しない */
  expectedHandle: Scalars['String']['input'];
  handle: Scalars['String']['input'];
  headline?: InputMaybe<Scalars['String']['input']>;
  nickname: Scalars['String']['input'];
  websites: Array<ProfileWebsiteInput>;
};

export type UpdateProductInput = {
  /** 編集画面を開いたときの版 */
  expectedVersion: Scalars['Int']['input'];
  fields: ProductFieldsInput;
  /** 予定のローンチの日の変更か次回のローンチの予約のローンチ日(YYYY-MM-DD)。nullはローンチを変えない */
  launchDate?: InputMaybe<Scalars['String']['input']>;
  /** 編集画面を開いたときの現在のハンドル */
  productHandle: Scalars['String']['input'];
};

/** 機能フラグの変更の入力 */
export type UpdateUltrasPromotionSettingInput = {
  enabled: Scalars['Boolean']['input'];
  /** 照会で読み取った版。最新と一致しなければversion_conflict */
  expectedVersion: Scalars['Int']['input'];
  /** 監査ログに残す理由(任意) */
  reason?: InputMaybe<Scalars['String']['input']>;
};

/** Upvoteする側 */
export type UpvoteInput = {
  entryId: Scalars['ID']['input'];
  matchId: Scalars['ID']['input'];
};

/** 閲覧者がUpvoteできない理由 */
export type UpvoteRestriction =
  | 'ACCOUNT_UNAVAILABLE'
  | 'EMAIL_NOT_VERIFIED'
  | 'GUEST'
  | 'NOT_ACCEPTING'
  | 'OWN_MATCH';

/** ログイン中の端末 */
export type UserSessionSummary = {
  __typename?: 'UserSessionSummary';
  browserName?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  /** 操作している端末 */
  current: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  lastUsedAt: Scalars['DateTime']['output'];
  osName?: Maybe<Scalars['String']['output']>;
};

/** 他の利用者の表示に使う最小限の情報。他の機能の型が利用者を指す項目の戻り値に使う */
export type UserSummary = {
  __typename?: 'UserSummary';
  /** プロフィール画像。未設定ならnull。隔離中の画像は枠だけを返し、objectKeyが空になる */
  avatar?: Maybe<MediaImage>;
  handle: Scalars['String']['output'];
  nickname: Scalars['String']['output'];
};

/** ログイン中の利用者 */
export type Viewer = {
  __typename?: 'Viewer';
  email: Scalars['String']['output'];
  emailVerified: Scalars['Boolean']['output'];
  handle: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  nickname: Scalars['String']['output'];
  /** 要求されたときだけ数える。多要素認証が無効なら0 */
  remainingRecoveryCodes: Scalars['Int']['output'];
  status: AccountStatus;
  totpEnabled: Scalars['Boolean']['output'];
};

/** ログイン中の利用者のUltrasの加入状態 */
export type ViewerUltras = {
  __typename?: 'ViewerUltras';
  /** Customer Portalを開けるか(加入したことがあれば真) */
  canOpenPortal: Scalars['Boolean']['output'];
  /** 現在、特典を受けられるか */
  entitled: Scalars['Boolean']['output'];
  /** 加入したことが無ければnull */
  plan?: Maybe<UltrasPlan>;
};



export type ResolverTypeWrapper<T> = Promise<T> | T;


export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = Record<PropertyKey, never>, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;



/** Mapping of union types */
export type ResolversUnionTypes<_RefType extends Record<string, unknown>> = {
  LoginResult:
    | ( Omit<LoginSucceeded, 'viewer'> & { viewer: _RefType['Viewer'] } )
    | ( SecondFactorRequired )
  ;
  MyProductResult:
    | ( MyProductModel )
    | ( MyProductRedirect )
  ;
  PublicProfileResult:
    | ( PublicProfileModel )
    | ( PublicProfileRedirectModel )
  ;
};


/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  AccountStatus: AccountStatus;
  AdminAccount: ResolverTypeWrapper<AdminAccountSource>;
  AdminAccountStatus: AdminAccountStatus;
  AdminConfirmationResult: ResolverTypeWrapper<Omit<AdminConfirmationResult, 'viewer'> & { viewer?: Maybe<ResolversTypes['AdminViewer']> }>;
  AdminInquiry: ResolverTypeWrapper<AdminInquiryModel>;
  AdminInquiryCategory: ResolverTypeWrapper<AdminInquiryCategory>;
  AdminInquiryFilterInput: AdminInquiryFilterInput;
  AdminInquiryGuest: ResolverTypeWrapper<AdminInquiryGuest>;
  AdminInquiryMember: ResolverTypeWrapper<AdminInquiryMemberModel>;
  AdminInquiryPage: ResolverTypeWrapper<Omit<AdminInquiryPage, 'entries'> & { entries: Array<ResolversTypes['AdminInquirySummary']> }>;
  AdminInquirySummary: ResolverTypeWrapper<AdminInquirySummaryModel>;
  AdminLegalDocument: ResolverTypeWrapper<AdminLegalDocument>;
  AdminLegalDocumentSummary: ResolverTypeWrapper<AdminLegalDocumentSummary>;
  AdminLegalDocumentVersion: ResolverTypeWrapper<AdminLegalDocumentVersion>;
  AdminLegalDraft: ResolverTypeWrapper<AdminLegalDraft>;
  AdminLegalRevision: ResolverTypeWrapper<AdminLegalRevision>;
  AdminReAuthenticationInput: AdminReAuthenticationInput;
  AdminRecoveryCodeSet: ResolverTypeWrapper<AdminRecoveryCodeSet>;
  AdminRole: AdminRole;
  AdminSecondFactorInput: AdminSecondFactorInput;
  AdminSecondFactorRequired: ResolverTypeWrapper<AdminSecondFactorRequired>;
  AdminTotpSetup: ResolverTypeWrapper<AdminTotpSetup>;
  AdminViewer: ResolverTypeWrapper<AdminViewerSource>;
  AuditDetail: ResolverTypeWrapper<AuditDetail>;
  AuditLogEntry: ResolverTypeWrapper<AuditLogEntry>;
  AuditLogFilterInput: AuditLogFilterInput;
  AuditLogPage: ResolverTypeWrapper<AuditLogPage>;
  AuditOperator: ResolverTypeWrapper<AuditOperator>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  ByeReason: ByeReason;
  Checkout: ResolverTypeWrapper<Checkout>;
  CheckoutRejectionReason: CheckoutRejectionReason;
  CheckoutReturnResult: ResolverTypeWrapper<CheckoutReturnResult>;
  CheckoutStart: ResolverTypeWrapper<CheckoutStart>;
  CheckoutStatus: CheckoutStatus;
  CheckoutSummary: ResolverTypeWrapper<CheckoutSummary>;
  CompleteSecondFactorLoginInput: CompleteSecondFactorLoginInput;
  ConfirmationResult: ResolverTypeWrapper<Omit<ConfirmationResult, 'viewer'> & { viewer?: Maybe<ResolversTypes['Viewer']> }>;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  DiscardLegalDocumentDraftInput: DiscardLegalDocumentDraftInput;
  FollowEntry: ResolverTypeWrapper<Omit<FollowEntry, 'user'> & { user: ResolversTypes['UserSummary'] }>;
  FollowEntryConnection: ResolverTypeWrapper<Omit<FollowEntryConnection, 'nodes'> & { nodes: Array<ResolversTypes['FollowEntry']> }>;
  FollowState: ResolverTypeWrapper<FollowState>;
  GuestInquiryInput: GuestInquiryInput;
  HandleAvailability: HandleAvailability;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  InquiryCategory: ResolverTypeWrapper<InquiryCategory>;
  InquiryComposer: ResolverTypeWrapper<InquiryComposerModel>;
  InquiryKind: InquiryKind;
  InquiryMessage: ResolverTypeWrapper<InquiryMessageModel>;
  InquiryMessageInput: InquiryMessageInput;
  InquiryReplyAuthor: ResolverTypeWrapper<InquiryReplyAuthorModel>;
  InquiryReplyResult: ResolverTypeWrapper<Omit<InquiryReplyResult, 'message'> & { message: ResolversTypes['InquiryMessage'] }>;
  InquirySender: InquirySender;
  InquiryStatus: InquiryStatus;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  LaunchDateRange: ResolverTypeWrapper<LaunchDateRange>;
  LaunchDateUnavailableReason: LaunchDateUnavailableReason;
  LaunchDateWindow: ResolverTypeWrapper<LaunchDateWindow>;
  LaunchHistoryConnection: ResolverTypeWrapper<Omit<LaunchHistoryConnection, 'nodes'> & { nodes: Array<ResolversTypes['LaunchHistoryItem']> }>;
  LaunchHistoryItem: ResolverTypeWrapper<Omit<LaunchHistoryItem, 'product'> & { product: ResolversTypes['LaunchHistoryProduct'] }>;
  LaunchHistoryProduct: ResolverTypeWrapper<LaunchHistoryProductModel>;
  LaunchPlanMode: LaunchPlanMode;
  LaunchStatus: LaunchStatus;
  LaunchSummary: ResolverTypeWrapper<LaunchSummary>;
  LegalDocument: ResolverTypeWrapper<LegalDocument>;
  LegalDocumentEditor: ResolverTypeWrapper<LegalDocumentEditor>;
  LegalDocumentKind: LegalDocumentKind;
  LegalDocumentVersion: ResolverTypeWrapper<LegalDocumentVersion>;
  LegalRevision: ResolverTypeWrapper<LegalRevision>;
  LoginInput: LoginInput;
  LoginResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['LoginResult']>;
  LoginSucceeded: ResolverTypeWrapper<Omit<LoginSucceeded, 'viewer'> & { viewer: ResolversTypes['Viewer'] }>;
  Match: ResolverTypeWrapper<MatchSource>;
  MatchBye: ResolverTypeWrapper<Omit<MatchBye, 'entry' | 'match'> & { entry: ResolversTypes['MatchEntry'], match: ResolversTypes['Match'] }>;
  MatchDecision: MatchDecision;
  MatchEntry: ResolverTypeWrapper<MatchEntrySource>;
  MatchEntryResult: MatchEntryResult;
  MatchKind: MatchKind;
  MatchPhase: MatchPhase;
  MatchProduct: ResolverTypeWrapper<MatchProductSource>;
  MatchStage: MatchStage;
  MediaAttachment: ResolverTypeWrapper<MediaAttachment>;
  MediaImage: ResolverTypeWrapper<MediaImage>;
  MediaImageFallbackFormat: MediaImageFallbackFormat;
  MemberInquiry: ResolverTypeWrapper<MemberInquiryModel>;
  MemberInquiryInput: MemberInquiryInput;
  MemberInquiryPage: ResolverTypeWrapper<Omit<MemberInquiryPage, 'items'> & { items: Array<ResolversTypes['MemberInquirySummary']> }>;
  MemberInquirySummary: ResolverTypeWrapper<MemberInquirySummaryModel>;
  Money: ResolverTypeWrapper<Money>;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  MyProduct: ResolverTypeWrapper<MyProductModel>;
  MyProductConnection: ResolverTypeWrapper<Omit<MyProductConnection, 'nodes'> & { nodes: Array<ResolversTypes['MyProduct']> }>;
  MyProductRedirect: ResolverTypeWrapper<MyProductRedirect>;
  MyProductResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['MyProductResult']>;
  MyProfile: ResolverTypeWrapper<MyProfileModel>;
  OffsetPageInfo: ResolverTypeWrapper<OffsetPageInfo>;
  PageInfo: ResolverTypeWrapper<PageInfo>;
  PaymentRecord: ResolverTypeWrapper<PaymentRecord>;
  PaymentRecordConnection: ResolverTypeWrapper<PaymentRecordConnection>;
  PaymentRecordKind: PaymentRecordKind;
  PaymentRecordStatus: PaymentRecordStatus;
  ProductAward: ResolverTypeWrapper<ProductAward>;
  ProductAwardKind: ProductAwardKind;
  ProductCategory: ResolverTypeWrapper<ProductCategory>;
  ProductCategoryInput: ProductCategoryInput;
  ProductFieldsInput: ProductFieldsInput;
  ProductLaunch: ResolverTypeWrapper<ProductLaunch>;
  ProductLaunchPlan: ResolverTypeWrapper<ProductLaunchPlan>;
  ProductLockView: ResolverTypeWrapper<ProductLockView>;
  ProductOwnerStatus: ResolverTypeWrapper<ProductOwnerStatus>;
  ProductScreenshot: ResolverTypeWrapper<ProductScreenshotModel>;
  ProfileViewerRelation: ProfileViewerRelation;
  ProfileWebsite: ResolverTypeWrapper<ProfileWebsite>;
  ProfileWebsiteInput: ProfileWebsiteInput;
  PublicProfile: ResolverTypeWrapper<PublicProfileModel>;
  PublicProfileRedirect: ResolverTypeWrapper<PublicProfileRedirectModel>;
  PublicProfileResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['PublicProfileResult']>;
  PublishLegalDocumentInput: PublishLegalDocumentInput;
  PurchaseKind: PurchaseKind;
  QualifierBoard: ResolverTypeWrapper<Omit<QualifierBoard, 'byes' | 'matches'> & { byes: Array<ResolversTypes['MatchBye']>, matches: Array<ResolversTypes['Match']> }>;
  QualifierBoardPhase: QualifierBoardPhase;
  QualifierOutcome: QualifierOutcome;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  ReAuthenticationInput: ReAuthenticationInput;
  RecoveryCodeSet: ResolverTypeWrapper<RecoveryCodeSet>;
  RegisterProductInput: RegisterProductInput;
  RegisterUserInput: RegisterUserInput;
  RelaunchBlockView: ResolverTypeWrapper<RelaunchBlockView>;
  RequestEmailChangeInput: RequestEmailChangeInput;
  RequestPasswordChangeInput: RequestPasswordChangeInput;
  ResendVerificationResult: ResendVerificationResult;
  ResetPasswordInput: ResetPasswordInput;
  SaveLegalDocumentDraftInput: SaveLegalDocumentDraftInput;
  SecondFactorInput: SecondFactorInput;
  SecondFactorRequired: ResolverTypeWrapper<SecondFactorRequired>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  SystemStatus: ResolverTypeWrapper<SystemStatus>;
  TotpSetup: ResolverTypeWrapper<TotpSetup>;
  UltrasOffer: ResolverTypeWrapper<UltrasOffer>;
  UltrasPlan: ResolverTypeWrapper<UltrasPlan>;
  UltrasPlanStatus: UltrasPlanStatus;
  UltrasPortalSession: ResolverTypeWrapper<UltrasPortalSession>;
  UltrasPromotionSetting: ResolverTypeWrapper<UltrasPromotionSetting>;
  UpdateMyProfileInput: UpdateMyProfileInput;
  UpdateProductInput: UpdateProductInput;
  UpdateUltrasPromotionSettingInput: UpdateUltrasPromotionSettingInput;
  UpvoteInput: UpvoteInput;
  UpvoteRestriction: UpvoteRestriction;
  UserSessionSummary: ResolverTypeWrapper<UserSessionSummary>;
  UserSummary: ResolverTypeWrapper<UserSummarySource>;
  Viewer: ResolverTypeWrapper<ViewerSource>;
  ViewerUltras: ResolverTypeWrapper<ViewerUltras>;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  AdminAccount: AdminAccountSource;
  AdminConfirmationResult: Omit<AdminConfirmationResult, 'viewer'> & { viewer?: Maybe<ResolversParentTypes['AdminViewer']> };
  AdminInquiry: AdminInquiryModel;
  AdminInquiryCategory: AdminInquiryCategory;
  AdminInquiryFilterInput: AdminInquiryFilterInput;
  AdminInquiryGuest: AdminInquiryGuest;
  AdminInquiryMember: AdminInquiryMemberModel;
  AdminInquiryPage: Omit<AdminInquiryPage, 'entries'> & { entries: Array<ResolversParentTypes['AdminInquirySummary']> };
  AdminInquirySummary: AdminInquirySummaryModel;
  AdminLegalDocument: AdminLegalDocument;
  AdminLegalDocumentSummary: AdminLegalDocumentSummary;
  AdminLegalDocumentVersion: AdminLegalDocumentVersion;
  AdminLegalDraft: AdminLegalDraft;
  AdminLegalRevision: AdminLegalRevision;
  AdminReAuthenticationInput: AdminReAuthenticationInput;
  AdminRecoveryCodeSet: AdminRecoveryCodeSet;
  AdminSecondFactorInput: AdminSecondFactorInput;
  AdminSecondFactorRequired: AdminSecondFactorRequired;
  AdminTotpSetup: AdminTotpSetup;
  AdminViewer: AdminViewerSource;
  AuditDetail: AuditDetail;
  AuditLogEntry: AuditLogEntry;
  AuditLogFilterInput: AuditLogFilterInput;
  AuditLogPage: AuditLogPage;
  AuditOperator: AuditOperator;
  Boolean: Scalars['Boolean']['output'];
  Checkout: Checkout;
  CheckoutReturnResult: CheckoutReturnResult;
  CheckoutStart: CheckoutStart;
  CheckoutSummary: CheckoutSummary;
  CompleteSecondFactorLoginInput: CompleteSecondFactorLoginInput;
  ConfirmationResult: Omit<ConfirmationResult, 'viewer'> & { viewer?: Maybe<ResolversParentTypes['Viewer']> };
  DateTime: Scalars['DateTime']['output'];
  DiscardLegalDocumentDraftInput: DiscardLegalDocumentDraftInput;
  FollowEntry: Omit<FollowEntry, 'user'> & { user: ResolversParentTypes['UserSummary'] };
  FollowEntryConnection: Omit<FollowEntryConnection, 'nodes'> & { nodes: Array<ResolversParentTypes['FollowEntry']> };
  FollowState: FollowState;
  GuestInquiryInput: GuestInquiryInput;
  ID: Scalars['ID']['output'];
  InquiryCategory: InquiryCategory;
  InquiryComposer: InquiryComposerModel;
  InquiryMessage: InquiryMessageModel;
  InquiryMessageInput: InquiryMessageInput;
  InquiryReplyAuthor: InquiryReplyAuthorModel;
  InquiryReplyResult: Omit<InquiryReplyResult, 'message'> & { message: ResolversParentTypes['InquiryMessage'] };
  Int: Scalars['Int']['output'];
  LaunchDateRange: LaunchDateRange;
  LaunchDateWindow: LaunchDateWindow;
  LaunchHistoryConnection: Omit<LaunchHistoryConnection, 'nodes'> & { nodes: Array<ResolversParentTypes['LaunchHistoryItem']> };
  LaunchHistoryItem: Omit<LaunchHistoryItem, 'product'> & { product: ResolversParentTypes['LaunchHistoryProduct'] };
  LaunchHistoryProduct: LaunchHistoryProductModel;
  LaunchSummary: LaunchSummary;
  LegalDocument: LegalDocument;
  LegalDocumentEditor: LegalDocumentEditor;
  LegalDocumentVersion: LegalDocumentVersion;
  LegalRevision: LegalRevision;
  LoginInput: LoginInput;
  LoginResult: ResolversUnionTypes<ResolversParentTypes>['LoginResult'];
  LoginSucceeded: Omit<LoginSucceeded, 'viewer'> & { viewer: ResolversParentTypes['Viewer'] };
  Match: MatchSource;
  MatchBye: Omit<MatchBye, 'entry' | 'match'> & { entry: ResolversParentTypes['MatchEntry'], match: ResolversParentTypes['Match'] };
  MatchEntry: MatchEntrySource;
  MatchProduct: MatchProductSource;
  MediaAttachment: MediaAttachment;
  MediaImage: MediaImage;
  MemberInquiry: MemberInquiryModel;
  MemberInquiryInput: MemberInquiryInput;
  MemberInquiryPage: Omit<MemberInquiryPage, 'items'> & { items: Array<ResolversParentTypes['MemberInquirySummary']> };
  MemberInquirySummary: MemberInquirySummaryModel;
  Money: Money;
  Mutation: Record<PropertyKey, never>;
  MyProduct: MyProductModel;
  MyProductConnection: Omit<MyProductConnection, 'nodes'> & { nodes: Array<ResolversParentTypes['MyProduct']> };
  MyProductRedirect: MyProductRedirect;
  MyProductResult: ResolversUnionTypes<ResolversParentTypes>['MyProductResult'];
  MyProfile: MyProfileModel;
  OffsetPageInfo: OffsetPageInfo;
  PageInfo: PageInfo;
  PaymentRecord: PaymentRecord;
  PaymentRecordConnection: PaymentRecordConnection;
  ProductAward: ProductAward;
  ProductCategory: ProductCategory;
  ProductCategoryInput: ProductCategoryInput;
  ProductFieldsInput: ProductFieldsInput;
  ProductLaunch: ProductLaunch;
  ProductLaunchPlan: ProductLaunchPlan;
  ProductLockView: ProductLockView;
  ProductOwnerStatus: ProductOwnerStatus;
  ProductScreenshot: ProductScreenshotModel;
  ProfileWebsite: ProfileWebsite;
  ProfileWebsiteInput: ProfileWebsiteInput;
  PublicProfile: PublicProfileModel;
  PublicProfileRedirect: PublicProfileRedirectModel;
  PublicProfileResult: ResolversUnionTypes<ResolversParentTypes>['PublicProfileResult'];
  PublishLegalDocumentInput: PublishLegalDocumentInput;
  QualifierBoard: Omit<QualifierBoard, 'byes' | 'matches'> & { byes: Array<ResolversParentTypes['MatchBye']>, matches: Array<ResolversParentTypes['Match']> };
  Query: Record<PropertyKey, never>;
  ReAuthenticationInput: ReAuthenticationInput;
  RecoveryCodeSet: RecoveryCodeSet;
  RegisterProductInput: RegisterProductInput;
  RegisterUserInput: RegisterUserInput;
  RelaunchBlockView: RelaunchBlockView;
  RequestEmailChangeInput: RequestEmailChangeInput;
  RequestPasswordChangeInput: RequestPasswordChangeInput;
  ResetPasswordInput: ResetPasswordInput;
  SaveLegalDocumentDraftInput: SaveLegalDocumentDraftInput;
  SecondFactorInput: SecondFactorInput;
  SecondFactorRequired: SecondFactorRequired;
  String: Scalars['String']['output'];
  SystemStatus: SystemStatus;
  TotpSetup: TotpSetup;
  UltrasOffer: UltrasOffer;
  UltrasPlan: UltrasPlan;
  UltrasPortalSession: UltrasPortalSession;
  UltrasPromotionSetting: UltrasPromotionSetting;
  UpdateMyProfileInput: UpdateMyProfileInput;
  UpdateProductInput: UpdateProductInput;
  UpdateUltrasPromotionSettingInput: UpdateUltrasPromotionSettingInput;
  UpvoteInput: UpvoteInput;
  UserSessionSummary: UserSessionSummary;
  UserSummary: UserSummarySource;
  Viewer: ViewerSource;
  ViewerUltras: ViewerUltras;
};

export type AdminAccountResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdminAccount'] = ResolversParentTypes['AdminAccount']> = {
  avatar?: Resolver<Maybe<ResolversTypes['MediaImage']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  nickname?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  role?: Resolver<ResolversTypes['AdminRole'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['AdminAccountStatus'], ParentType, ContextType>;
  title?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type AdminConfirmationResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdminConfirmationResult'] = ResolversParentTypes['AdminConfirmationResult']> = {
  viewer?: Resolver<Maybe<ResolversTypes['AdminViewer']>, ParentType, ContextType>;
};

export type AdminInquiryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdminInquiry'] = ResolversParentTypes['AdminInquiry']> = {
  category?: Resolver<ResolversTypes['InquiryCategory'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  guest?: Resolver<Maybe<ResolversTypes['AdminInquiryGuest']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['InquiryKind'], ParentType, ContextType>;
  lastMessageAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  member?: Resolver<Maybe<ResolversTypes['AdminInquiryMember']>, ParentType, ContextType>;
  messages?: Resolver<Array<ResolversTypes['InquiryMessage']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['InquiryStatus'], ParentType, ContextType>;
  statusChangedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  withdrawn?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type AdminInquiryCategoryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdminInquiryCategory'] = ResolversParentTypes['AdminInquiryCategory']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  linkedCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  systemDefault?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type AdminInquiryGuestResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdminInquiryGuest'] = ResolversParentTypes['AdminInquiryGuest']> = {
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  nickname?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type AdminInquiryMemberResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdminInquiryMember'] = ResolversParentTypes['AdminInquiryMember']> = {
  avatar?: Resolver<Maybe<ResolversTypes['MediaImage']>, ParentType, ContextType>;
  handle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  nickname?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  userId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type AdminInquiryPageResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdminInquiryPage'] = ResolversParentTypes['AdminInquiryPage']> = {
  entries?: Resolver<Array<ResolversTypes['AdminInquirySummary']>, ParentType, ContextType>;
  nextCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type AdminInquirySummaryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdminInquirySummary'] = ResolversParentTypes['AdminInquirySummary']> = {
  category?: Resolver<ResolversTypes['InquiryCategory'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['InquiryKind'], ParentType, ContextType>;
  lastMessageAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  senderName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['InquiryStatus'], ParentType, ContextType>;
  withdrawn?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type AdminLegalDocumentResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdminLegalDocument'] = ResolversParentTypes['AdminLegalDocument']> = {
  draft?: Resolver<Maybe<ResolversTypes['AdminLegalDraft']>, ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['LegalDocumentKind'], ParentType, ContextType>;
  latestBody?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  revisions?: Resolver<Array<ResolversTypes['AdminLegalRevision']>, ParentType, ContextType>;
  stateVersion?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type AdminLegalDocumentSummaryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdminLegalDocumentSummary'] = ResolversParentTypes['AdminLegalDocumentSummary']> = {
  hasDraft?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['LegalDocumentKind'], ParentType, ContextType>;
  latestPublishedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  latestVersionNumber?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
};

export type AdminLegalDocumentVersionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdminLegalDocumentVersion'] = ResolversParentTypes['AdminLegalDocumentVersion']> = {
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  changeSummary?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  isLatest?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['LegalDocumentKind'], ParentType, ContextType>;
  publishedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  publishedBy?: Resolver<ResolversTypes['LegalDocumentEditor'], ParentType, ContextType>;
  versionNumber?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type AdminLegalDraftResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdminLegalDraft'] = ResolversParentTypes['AdminLegalDraft']> = {
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  savedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  savedBy?: Resolver<ResolversTypes['LegalDocumentEditor'], ParentType, ContextType>;
};

export type AdminLegalRevisionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdminLegalRevision'] = ResolversParentTypes['AdminLegalRevision']> = {
  changeSummary?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  publishedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  publishedBy?: Resolver<ResolversTypes['LegalDocumentEditor'], ParentType, ContextType>;
  versionNumber?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type AdminRecoveryCodeSetResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdminRecoveryCodeSet'] = ResolversParentTypes['AdminRecoveryCodeSet']> = {
  codes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
};

export type AdminSecondFactorRequiredResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdminSecondFactorRequired'] = ResolversParentTypes['AdminSecondFactorRequired']> = {
  challenge?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  expiresAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
};

export type AdminTotpSetupResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdminTotpSetup'] = ResolversParentTypes['AdminTotpSetup']> = {
  expiresAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  otpauthUri?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  secret?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type AdminViewerResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdminViewer'] = ResolversParentTypes['AdminViewer']> = {
  avatar?: Resolver<Maybe<ResolversTypes['MediaImage']>, ParentType, ContextType>;
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  nickname?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  remainingRecoveryCodes?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  role?: Resolver<ResolversTypes['AdminRole'], ParentType, ContextType>;
  title?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type AuditDetailResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AuditDetail'] = ResolversParentTypes['AuditDetail']> = {
  key?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  value?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type AuditLogEntryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AuditLogEntry'] = ResolversParentTypes['AuditLogEntry']> = {
  action?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  actionLabel?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  detail?: Resolver<Array<ResolversTypes['AuditDetail']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  occurredAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  operator?: Resolver<ResolversTypes['AuditOperator'], ParentType, ContextType>;
  reason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  targetIds?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  targetKind?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type AuditLogPageResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AuditLogPage'] = ResolversParentTypes['AuditLogPage']> = {
  entries?: Resolver<Array<ResolversTypes['AuditLogEntry']>, ParentType, ContextType>;
  nextCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type AuditOperatorResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AuditOperator'] = ResolversParentTypes['AuditOperator']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  nickname?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type CheckoutResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Checkout'] = ResolversParentTypes['Checkout']> = {
  acceptUntil?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  canRestart?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  clientSecret?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  consentVersion?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  expiresAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['PurchaseKind'], ParentType, ContextType>;
  purchaseId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  quantity?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  rejectionReason?: Resolver<Maybe<ResolversTypes['CheckoutRejectionReason']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['CheckoutStatus'], ParentType, ContextType>;
  summary?: Resolver<ResolversTypes['CheckoutSummary'], ParentType, ContextType>;
  total?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
  unitPrice?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
};

export type CheckoutReturnResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CheckoutReturnResult'] = ResolversParentTypes['CheckoutReturnResult']> = {
  checkout?: Resolver<ResolversTypes['Checkout'], ParentType, ContextType>;
};

export type CheckoutStartResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CheckoutStart'] = ResolversParentTypes['CheckoutStart']> = {
  purchaseId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type CheckoutSummaryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CheckoutSummary'] = ResolversParentTypes['CheckoutSummary']> = {
  additionalNotes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  isSubscription?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  itemName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  quantityLabel?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  serviceTiming?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type ConfirmationResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ConfirmationResult'] = ResolversParentTypes['ConfirmationResult']> = {
  viewer?: Resolver<Maybe<ResolversTypes['Viewer']>, ParentType, ContextType>;
};

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export type FollowEntryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['FollowEntry'] = ResolversParentTypes['FollowEntry']> = {
  followedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  user?: Resolver<ResolversTypes['UserSummary'], ParentType, ContextType>;
};

export type FollowEntryConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['FollowEntryConnection'] = ResolversParentTypes['FollowEntryConnection']> = {
  nodes?: Resolver<Array<ResolversTypes['FollowEntry']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
};

export type FollowStateResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['FollowState'] = ResolversParentTypes['FollowState']> = {
  followerCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  following?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  handle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type InquiryCategoryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['InquiryCategory'] = ResolversParentTypes['InquiryCategory']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  systemDefault?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type InquiryComposerResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['InquiryComposer'] = ResolversParentTypes['InquiryComposer']> = {
  avatar?: Resolver<Maybe<ResolversTypes['MediaImage']>, ParentType, ContextType>;
  nickname?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type InquiryMessageResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['InquiryMessage'] = ResolversParentTypes['InquiryMessage']> = {
  admin?: Resolver<Maybe<ResolversTypes['InquiryReplyAuthor']>, ParentType, ContextType>;
  attachments?: Resolver<Array<ResolversTypes['MediaAttachment']>, ParentType, ContextType>;
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  sender?: Resolver<ResolversTypes['InquirySender'], ParentType, ContextType>;
};

export type InquiryReplyAuthorResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['InquiryReplyAuthor'] = ResolversParentTypes['InquiryReplyAuthor']> = {
  avatar?: Resolver<Maybe<ResolversTypes['MediaImage']>, ParentType, ContextType>;
  deleted?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  nickname?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type InquiryReplyResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['InquiryReplyResult'] = ResolversParentTypes['InquiryReplyResult']> = {
  message?: Resolver<ResolversTypes['InquiryMessage'], ParentType, ContextType>;
  notificationQueued?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type LaunchDateRangeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LaunchDateRange'] = ResolversParentTypes['LaunchDateRange']> = {
  from?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  reason?: Resolver<ResolversTypes['LaunchDateUnavailableReason'], ParentType, ContextType>;
  to?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type LaunchDateWindowResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LaunchDateWindow'] = ResolversParentTypes['LaunchDateWindow']> = {
  earliest?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  latest?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  relaunchIntervalDays?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  unavailable?: Resolver<Array<ResolversTypes['LaunchDateRange']>, ParentType, ContextType>;
};

export type LaunchHistoryConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LaunchHistoryConnection'] = ResolversParentTypes['LaunchHistoryConnection']> = {
  nodes?: Resolver<Array<ResolversTypes['LaunchHistoryItem']>, ParentType, ContextType>;
  ownerSuspended?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  viewerIsOwner?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type LaunchHistoryItemResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LaunchHistoryItem'] = ResolversParentTypes['LaunchHistoryItem']> = {
  awards?: Resolver<Array<ResolversTypes['ProductAward']>, ParentType, ContextType>;
  launches?: Resolver<Array<ResolversTypes['ProductLaunch']>, ParentType, ContextType>;
  product?: Resolver<ResolversTypes['LaunchHistoryProduct'], ParentType, ContextType>;
};

export type LaunchHistoryProductResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LaunchHistoryProduct'] = ResolversParentTypes['LaunchHistoryProduct']> = {
  category?: Resolver<ResolversTypes['ProductCategory'], ParentType, ContextType>;
  handle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  listed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  logo?: Resolver<Maybe<ResolversTypes['MediaImage']>, ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  tagline?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  websiteUrl?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type LaunchSummaryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LaunchSummary'] = ResolversParentTypes['LaunchSummary']> = {
  inMatch?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  label?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type LegalDocumentResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LegalDocument'] = ResolversParentTypes['LegalDocument']> = {
  kind?: Resolver<ResolversTypes['LegalDocumentKind'], ParentType, ContextType>;
  latest?: Resolver<Maybe<ResolversTypes['LegalDocumentVersion']>, ParentType, ContextType>;
  revisions?: Resolver<Array<ResolversTypes['LegalRevision']>, ParentType, ContextType>;
};

export type LegalDocumentEditorResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LegalDocumentEditor'] = ResolversParentTypes['LegalDocumentEditor']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  nickname?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type LegalDocumentVersionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LegalDocumentVersion'] = ResolversParentTypes['LegalDocumentVersion']> = {
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  changeSummary?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  isLatest?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['LegalDocumentKind'], ParentType, ContextType>;
  publishedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  versionNumber?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type LegalRevisionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LegalRevision'] = ResolversParentTypes['LegalRevision']> = {
  changeSummary?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  publishedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  versionNumber?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type LoginResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LoginResult'] = ResolversParentTypes['LoginResult']> = {
  __resolveType: TypeResolveFn<'LoginSucceeded' | 'SecondFactorRequired', ParentType, ContextType>;
};

export type LoginSucceededResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LoginSucceeded'] = ResolversParentTypes['LoginSucceeded']> = {
  viewer?: Resolver<ResolversTypes['Viewer'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type MatchResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Match'] = ResolversParentTypes['Match']> = {
  date?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  decision?: Resolver<Maybe<ResolversTypes['MatchDecision']>, ParentType, ContextType>;
  endedEarly?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  endsAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  entries?: Resolver<Array<ResolversTypes['MatchEntry']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['MatchKind'], ParentType, ContextType>;
  phase?: Resolver<ResolversTypes['MatchPhase'], ParentType, ContextType>;
  round?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  stage?: Resolver<Maybe<ResolversTypes['MatchStage']>, ParentType, ContextType>;
  startsAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  viewerRestriction?: Resolver<Maybe<ResolversTypes['UpvoteRestriction']>, ParentType, ContextType>;
  viewerUpvotedEntryId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
};

export type MatchByeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MatchBye'] = ResolversParentTypes['MatchBye']> = {
  entry?: Resolver<ResolversTypes['MatchEntry'], ParentType, ContextType>;
  match?: Resolver<ResolversTypes['Match'], ParentType, ContextType>;
  reason?: Resolver<ResolversTypes['ByeReason'], ParentType, ContextType>;
};

export type MatchEntryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MatchEntry'] = ResolversParentTypes['MatchEntry']> = {
  colorIndex?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isViewerOwn?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  product?: Resolver<Maybe<ResolversTypes['MatchProduct']>, ParentType, ContextType>;
  result?: Resolver<Maybe<ResolversTypes['MatchEntryResult']>, ParentType, ContextType>;
  upvoteCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type MatchProductResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MatchProduct'] = ResolversParentTypes['MatchProduct']> = {
  category?: Resolver<ResolversTypes['ProductCategory'], ParentType, ContextType>;
  handle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  listed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  logo?: Resolver<Maybe<ResolversTypes['MediaImage']>, ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  tagline?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  websiteUrl?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type MediaAttachmentResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MediaAttachment'] = ResolversParentTypes['MediaAttachment']> = {
  byteSize?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  contentType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  downloadPath?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  originalFileName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type MediaImageResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MediaImage'] = ResolversParentTypes['MediaImage']> = {
  fallbackFormat?: Resolver<ResolversTypes['MediaImageFallbackFormat'], ParentType, ContextType>;
  height?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  objectKey?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  width?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
};

export type MemberInquiryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MemberInquiry'] = ResolversParentTypes['MemberInquiry']> = {
  canPost?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  category?: Resolver<ResolversTypes['InquiryCategory'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  lastMessageAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  messages?: Resolver<Array<ResolversTypes['InquiryMessage']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['InquiryStatus'], ParentType, ContextType>;
};

export type MemberInquiryPageResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MemberInquiryPage'] = ResolversParentTypes['MemberInquiryPage']> = {
  items?: Resolver<Array<ResolversTypes['MemberInquirySummary']>, ParentType, ContextType>;
  nextCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type MemberInquirySummaryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MemberInquirySummary'] = ResolversParentTypes['MemberInquirySummary']> = {
  category?: Resolver<ResolversTypes['InquiryCategory'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  lastMessageAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['InquiryStatus'], ParentType, ContextType>;
};

export type MoneyResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Money'] = ResolversParentTypes['Money']> = {
  amount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  currency?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type MutationResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  adminLogin?: Resolver<ResolversTypes['AdminSecondFactorRequired'], ParentType, ContextType, RequireFields<MutationAdminLoginArgs, 'email' | 'password'>>;
  adminLogout?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  cancelUpvote?: Resolver<ResolversTypes['Match'], ParentType, ContextType, RequireFields<MutationCancelUpvoteArgs, 'matchId'>>;
  changeAdminPassword?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationChangeAdminPasswordArgs, 'newPassword' | 'reAuthentication'>>;
  changeAdminRole?: Resolver<ResolversTypes['AdminAccount'], ParentType, ContextType, RequireFields<MutationChangeAdminRoleArgs, 'id' | 'role'>>;
  changeInquiryStatus?: Resolver<ResolversTypes['AdminInquiry'], ParentType, ContextType, RequireFields<MutationChangeInquiryStatusArgs, 'inquiryId' | 'status'>>;
  completeAdminInvitation?: Resolver<ResolversTypes['AdminRecoveryCodeSet'], ParentType, ContextType, RequireFields<MutationCompleteAdminInvitationArgs, 'token' | 'totpCode'>>;
  completeAdminSecondFactorLogin?: Resolver<ResolversTypes['AdminViewer'], ParentType, ContextType, RequireFields<MutationCompleteAdminSecondFactorLoginArgs, 'challenge' | 'secondFactor'>>;
  completeAdminTotpReset?: Resolver<ResolversTypes['AdminRecoveryCodeSet'], ParentType, ContextType, RequireFields<MutationCompleteAdminTotpResetArgs, 'totpCode'>>;
  completeSecondFactorLogin?: Resolver<ResolversTypes['Viewer'], ParentType, ContextType, RequireFields<MutationCompleteSecondFactorLoginArgs, 'input'>>;
  confirmAdminEmailChange?: Resolver<ResolversTypes['AdminConfirmationResult'], ParentType, ContextType, RequireFields<MutationConfirmAdminEmailChangeArgs, 'token'>>;
  confirmCheckoutReturn?: Resolver<ResolversTypes['CheckoutReturnResult'], ParentType, ContextType, RequireFields<MutationConfirmCheckoutReturnArgs, 'sessionId'>>;
  confirmEmailChange?: Resolver<ResolversTypes['ConfirmationResult'], ParentType, ContextType, RequireFields<MutationConfirmEmailChangeArgs, 'token'>>;
  confirmPasswordChange?: Resolver<ResolversTypes['ConfirmationResult'], ParentType, ContextType, RequireFields<MutationConfirmPasswordChangeArgs, 'token'>>;
  createInquiryCategory?: Resolver<ResolversTypes['InquiryCategory'], ParentType, ContextType, RequireFields<MutationCreateInquiryCategoryArgs, 'name'>>;
  createProductCategory?: Resolver<ResolversTypes['ProductCategory'], ParentType, ContextType, RequireFields<MutationCreateProductCategoryArgs, 'input'>>;
  createUltrasPortalSession?: Resolver<ResolversTypes['UltrasPortalSession'], ParentType, ContextType>;
  deleteAdmin?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteAdminArgs, 'id'>>;
  deleteInquiryCategory?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteInquiryCategoryArgs, 'id'>>;
  deleteProduct?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteProductArgs, 'expectedVersion' | 'productHandle'>>;
  deleteProductCategory?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteProductCategoryArgs, 'id'>>;
  disableTotp?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDisableTotpArgs, 'input'>>;
  discardLegalDocumentDraft?: Resolver<ResolversTypes['AdminLegalDocument'], ParentType, ContextType, RequireFields<MutationDiscardLegalDocumentDraftArgs, 'input'>>;
  enableTotp?: Resolver<ResolversTypes['RecoveryCodeSet'], ParentType, ContextType, RequireFields<MutationEnableTotpArgs, 'totpCode'>>;
  followUser?: Resolver<ResolversTypes['FollowState'], ParentType, ContextType, RequireFields<MutationFollowUserArgs, 'handle'>>;
  inviteAdmin?: Resolver<ResolversTypes['AdminAccount'], ParentType, ContextType, RequireFields<MutationInviteAdminArgs, 'email'>>;
  login?: Resolver<ResolversTypes['LoginResult'], ParentType, ContextType, RequireFields<MutationLoginArgs, 'input'>>;
  logout?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  postInquiryMessage?: Resolver<ResolversTypes['InquiryMessage'], ParentType, ContextType, RequireFields<MutationPostInquiryMessageArgs, 'input' | 'inquiryId'>>;
  publishLegalDocument?: Resolver<ResolversTypes['AdminLegalDocument'], ParentType, ContextType, RequireFields<MutationPublishLegalDocumentArgs, 'input'>>;
  recordCheckoutConsent?: Resolver<ResolversTypes['Checkout'], ParentType, ContextType, RequireFields<MutationRecordCheckoutConsentArgs, 'purchaseId'>>;
  regenerateAdminRecoveryCodes?: Resolver<ResolversTypes['AdminRecoveryCodeSet'], ParentType, ContextType, RequireFields<MutationRegenerateAdminRecoveryCodesArgs, 'reAuthentication'>>;
  regenerateRecoveryCodes?: Resolver<ResolversTypes['RecoveryCodeSet'], ParentType, ContextType, RequireFields<MutationRegenerateRecoveryCodesArgs, 'input'>>;
  registerProduct?: Resolver<ResolversTypes['MyProduct'], ParentType, ContextType, RequireFields<MutationRegisterProductArgs, 'input'>>;
  registerUser?: Resolver<ResolversTypes['Viewer'], ParentType, ContextType, RequireFields<MutationRegisterUserArgs, 'input'>>;
  renameInquiryCategory?: Resolver<ResolversTypes['InquiryCategory'], ParentType, ContextType, RequireFields<MutationRenameInquiryCategoryArgs, 'id' | 'name'>>;
  replyToInquiry?: Resolver<ResolversTypes['InquiryReplyResult'], ParentType, ContextType, RequireFields<MutationReplyToInquiryArgs, 'body' | 'inquiryId'>>;
  requestAdminEmailChange?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRequestAdminEmailChangeArgs, 'newEmail' | 'reAuthentication'>>;
  requestAdminPasswordReset?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRequestAdminPasswordResetArgs, 'email'>>;
  requestEmailChange?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRequestEmailChangeArgs, 'input'>>;
  requestPasswordChange?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRequestPasswordChangeArgs, 'input'>>;
  requestPasswordReset?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRequestPasswordResetArgs, 'email'>>;
  resendAdminInvitation?: Resolver<ResolversTypes['AdminAccount'], ParentType, ContextType, RequireFields<MutationResendAdminInvitationArgs, 'id'>>;
  resendVerificationEmail?: Resolver<ResolversTypes['ResendVerificationResult'], ParentType, ContextType>;
  resetAdminPassword?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationResetAdminPasswordArgs, 'newPassword' | 'token'>>;
  resetPassword?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationResetPasswordArgs, 'input'>>;
  revokeOtherSessions?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  revokeSession?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRevokeSessionArgs, 'id'>>;
  saveLegalDocumentDraft?: Resolver<ResolversTypes['AdminLegalDocument'], ParentType, ContextType, RequireFields<MutationSaveLegalDocumentDraftArgs, 'input'>>;
  startAdminInvitation?: Resolver<ResolversTypes['AdminTotpSetup'], ParentType, ContextType, RequireFields<MutationStartAdminInvitationArgs, 'nickname' | 'password' | 'token'>>;
  startAdminTotpReset?: Resolver<ResolversTypes['AdminTotpSetup'], ParentType, ContextType, RequireFields<MutationStartAdminTotpResetArgs, 'reAuthentication'>>;
  startSmokeCheckout?: Resolver<ResolversTypes['CheckoutStart'], ParentType, ContextType>;
  startTotpSetup?: Resolver<ResolversTypes['TotpSetup'], ParentType, ContextType, RequireFields<MutationStartTotpSetupArgs, 'input'>>;
  startUltrasCheckout?: Resolver<ResolversTypes['CheckoutStart'], ParentType, ContextType>;
  submitGuestInquiry?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationSubmitGuestInquiryArgs, 'input'>>;
  submitMemberInquiry?: Resolver<ResolversTypes['MemberInquiry'], ParentType, ContextType, RequireFields<MutationSubmitMemberInquiryArgs, 'input'>>;
  unfollowUser?: Resolver<ResolversTypes['FollowState'], ParentType, ContextType, RequireFields<MutationUnfollowUserArgs, 'handle'>>;
  updateAdminProfile?: Resolver<ResolversTypes['AdminAccount'], ParentType, ContextType, RequireFields<MutationUpdateAdminProfileArgs, 'id' | 'nickname'>>;
  updateMyProfile?: Resolver<ResolversTypes['MyProfile'], ParentType, ContextType, RequireFields<MutationUpdateMyProfileArgs, 'input'>>;
  updateProduct?: Resolver<ResolversTypes['MyProduct'], ParentType, ContextType, RequireFields<MutationUpdateProductArgs, 'input'>>;
  updateProductCategory?: Resolver<ResolversTypes['ProductCategory'], ParentType, ContextType, RequireFields<MutationUpdateProductCategoryArgs, 'id' | 'input'>>;
  updateUltrasPromotionSetting?: Resolver<ResolversTypes['UltrasPromotionSetting'], ParentType, ContextType, RequireFields<MutationUpdateUltrasPromotionSettingArgs, 'input'>>;
  upvote?: Resolver<ResolversTypes['Match'], ParentType, ContextType, RequireFields<MutationUpvoteArgs, 'input'>>;
  verifyEmail?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationVerifyEmailArgs, 'token'>>;
  withdraw?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationWithdrawArgs, 'input'>>;
};

export type MyProductResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MyProduct'] = ResolversParentTypes['MyProduct']> = {
  category?: Resolver<ResolversTypes['ProductCategory'], ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  handle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  hidden?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  latestLaunch?: Resolver<Maybe<ResolversTypes['ProductLaunch']>, ParentType, ContextType>;
  listed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  logo?: Resolver<Maybe<ResolversTypes['MediaImage']>, ParentType, ContextType>;
  logoFileId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  plan?: Resolver<ResolversTypes['ProductLaunchPlan'], ParentType, ContextType>;
  previousHandle?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  screenshots?: Resolver<Array<ResolversTypes['ProductScreenshot']>, ParentType, ContextType>;
  tagline?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  version?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  websiteUrl?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type MyProductConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MyProductConnection'] = ResolversParentTypes['MyProductConnection']> = {
  nodes?: Resolver<Array<ResolversTypes['MyProduct']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
};

export type MyProductRedirectResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MyProductRedirect'] = ResolversParentTypes['MyProductRedirect']> = {
  handle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type MyProductResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MyProductResult'] = ResolversParentTypes['MyProductResult']> = {
  __resolveType: TypeResolveFn<'MyProduct' | 'MyProductRedirect', ParentType, ContextType>;
};

export type MyProfileResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MyProfile'] = ResolversParentTypes['MyProfile']> = {
  avatar?: Resolver<Maybe<ResolversTypes['MediaImage']>, ParentType, ContextType>;
  bio?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  handle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  headline?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  nickname?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  previousHandle?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  suspended?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  websites?: Resolver<Array<ResolversTypes['ProfileWebsite']>, ParentType, ContextType>;
};

export type OffsetPageInfoResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OffsetPageInfo'] = ResolversParentTypes['OffsetPageInfo']> = {
  page?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  perPage?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  totalPages?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type PageInfoResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PageInfo'] = ResolversParentTypes['PageInfo']> = {
  endCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  hasNextPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type PaymentRecordResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PaymentRecord'] = ResolversParentTypes['PaymentRecord']> = {
  amount?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['PaymentRecordKind'], ParentType, ContextType>;
  occurredAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  purpose?: Resolver<ResolversTypes['PurchaseKind'], ParentType, ContextType>;
  quantity?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['PaymentRecordStatus'], ParentType, ContextType>;
};

export type PaymentRecordConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PaymentRecordConnection'] = ResolversParentTypes['PaymentRecordConnection']> = {
  nodes?: Resolver<Array<ResolversTypes['PaymentRecord']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
};

export type ProductAwardResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProductAward'] = ResolversParentTypes['ProductAward']> = {
  count?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['ProductAwardKind'], ParentType, ContextType>;
  labels?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
};

export type ProductCategoryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProductCategory'] = ResolversParentTypes['ProductCategory']> = {
  handle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  systemDefault?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type ProductLaunchResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProductLaunch'] = ResolversParentTypes['ProductLaunch']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  kickoffAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  launchDate?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  number?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  outcome?: Resolver<Maybe<ResolversTypes['QualifierOutcome']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['LaunchStatus'], ParentType, ContextType>;
  summary?: Resolver<ResolversTypes['LaunchSummary'], ParentType, ContextType>;
};

export type ProductLaunchPlanResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProductLaunchPlan'] = ResolversParentTypes['ProductLaunchPlan']> = {
  blocks?: Resolver<Array<ResolversTypes['RelaunchBlockView']>, ParentType, ContextType>;
  currentLaunchDate?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  lockUnknown?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  locked?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  locks?: Resolver<Array<ResolversTypes['ProductLockView']>, ParentType, ContextType>;
  mode?: Resolver<ResolversTypes['LaunchPlanMode'], ParentType, ContextType>;
  ultrasEntitled?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  window?: Resolver<Maybe<ResolversTypes['LaunchDateWindow']>, ParentType, ContextType>;
};

export type ProductLockViewResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProductLockView'] = ResolversParentTypes['ProductLockView']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type ProductOwnerStatusResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProductOwnerStatus'] = ResolversParentTypes['ProductOwnerStatus']> = {
  latestLaunch?: Resolver<Maybe<ResolversTypes['ProductLaunch']>, ParentType, ContextType>;
  plan?: Resolver<ResolversTypes['ProductLaunchPlan'], ParentType, ContextType>;
};

export type ProductScreenshotResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProductScreenshot'] = ResolversParentTypes['ProductScreenshot']> = {
  byteSize?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  fileId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  image?: Resolver<Maybe<ResolversTypes['MediaImage']>, ParentType, ContextType>;
};

export type ProfileWebsiteResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProfileWebsite'] = ResolversParentTypes['ProfileWebsite']> = {
  name?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  url?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type PublicProfileResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PublicProfile'] = ResolversParentTypes['PublicProfile']> = {
  avatar?: Resolver<Maybe<ResolversTypes['MediaImage']>, ParentType, ContextType>;
  bio?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  followerCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  handle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  headline?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  nickname?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  suspended?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  ultras?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  viewerRelation?: Resolver<ResolversTypes['ProfileViewerRelation'], ParentType, ContextType>;
  websites?: Resolver<Array<ResolversTypes['ProfileWebsite']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type PublicProfileRedirectResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PublicProfileRedirect'] = ResolversParentTypes['PublicProfileRedirect']> = {
  handle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type PublicProfileResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PublicProfileResult'] = ResolversParentTypes['PublicProfileResult']> = {
  __resolveType: TypeResolveFn<'PublicProfile' | 'PublicProfileRedirect', ParentType, ContextType>;
};

export type QualifierBoardResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['QualifierBoard'] = ResolversParentTypes['QualifierBoard']> = {
  awaitingKickoff?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  byes?: Resolver<Array<ResolversTypes['MatchBye']>, ParentType, ContextType>;
  date?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  fullTimeAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  heldCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  matches?: Resolver<Array<ResolversTypes['Match']>, ParentType, ContextType>;
  nextKickoffAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  phase?: Resolver<ResolversTypes['QualifierBoardPhase'], ParentType, ContextType>;
  serverTime?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
};

export type QueryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  adminAccounts?: Resolver<Array<ResolversTypes['AdminAccount']>, ParentType, ContextType>;
  adminInquiries?: Resolver<ResolversTypes['AdminInquiryPage'], ParentType, ContextType, Partial<QueryAdminInquiriesArgs>>;
  adminInquiry?: Resolver<Maybe<ResolversTypes['AdminInquiry']>, ParentType, ContextType, RequireFields<QueryAdminInquiryArgs, 'id'>>;
  adminInquiryCategories?: Resolver<Array<ResolversTypes['AdminInquiryCategory']>, ParentType, ContextType>;
  adminLegalDocument?: Resolver<ResolversTypes['AdminLegalDocument'], ParentType, ContextType, RequireFields<QueryAdminLegalDocumentArgs, 'kind'>>;
  adminLegalDocumentVersion?: Resolver<Maybe<ResolversTypes['AdminLegalDocumentVersion']>, ParentType, ContextType, RequireFields<QueryAdminLegalDocumentVersionArgs, 'kind' | 'versionNumber'>>;
  adminLegalDocuments?: Resolver<Array<ResolversTypes['AdminLegalDocumentSummary']>, ParentType, ContextType>;
  adminProductCategories?: Resolver<Array<ResolversTypes['ProductCategory']>, ParentType, ContextType>;
  adminUnhandledInquiryCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  adminViewer?: Resolver<Maybe<ResolversTypes['AdminViewer']>, ParentType, ContextType>;
  auditLogs?: Resolver<ResolversTypes['AuditLogPage'], ParentType, ContextType, Partial<QueryAuditLogsArgs>>;
  checkout?: Resolver<ResolversTypes['Checkout'], ParentType, ContextType, RequireFields<QueryCheckoutArgs, 'purchaseId'>>;
  handleAvailability?: Resolver<ResolversTypes['HandleAvailability'], ParentType, ContextType, RequireFields<QueryHandleAvailabilityArgs, 'handle'>>;
  inquiryCategories?: Resolver<Array<ResolversTypes['InquiryCategory']>, ParentType, ContextType>;
  inquiryComposer?: Resolver<Maybe<ResolversTypes['InquiryComposer']>, ParentType, ContextType>;
  launchHistory?: Resolver<Maybe<ResolversTypes['LaunchHistoryConnection']>, ParentType, ContextType, RequireFields<QueryLaunchHistoryArgs, 'first' | 'userHandle'>>;
  legalDocument?: Resolver<ResolversTypes['LegalDocument'], ParentType, ContextType, RequireFields<QueryLegalDocumentArgs, 'kind'>>;
  legalDocumentVersion?: Resolver<Maybe<ResolversTypes['LegalDocumentVersion']>, ParentType, ContextType, RequireFields<QueryLegalDocumentVersionArgs, 'kind' | 'versionNumber'>>;
  memberInquiry?: Resolver<Maybe<ResolversTypes['MemberInquiry']>, ParentType, ContextType, RequireFields<QueryMemberInquiryArgs, 'id'>>;
  myFollowers?: Resolver<ResolversTypes['FollowEntryConnection'], ParentType, ContextType, RequireFields<QueryMyFollowersArgs, 'first'>>;
  myFollowing?: Resolver<ResolversTypes['FollowEntryConnection'], ParentType, ContextType, RequireFields<QueryMyFollowingArgs, 'first'>>;
  myInquiries?: Resolver<ResolversTypes['MemberInquiryPage'], ParentType, ContextType, Partial<QueryMyInquiriesArgs>>;
  myProduct?: Resolver<Maybe<ResolversTypes['MyProductResult']>, ParentType, ContextType, RequireFields<QueryMyProductArgs, 'handle'>>;
  myProducts?: Resolver<ResolversTypes['MyProductConnection'], ParentType, ContextType, RequireFields<QueryMyProductsArgs, 'first'>>;
  myProfile?: Resolver<ResolversTypes['MyProfile'], ParentType, ContextType>;
  mySessions?: Resolver<Array<ResolversTypes['UserSessionSummary']>, ParentType, ContextType>;
  newProductLaunchWindow?: Resolver<ResolversTypes['LaunchDateWindow'], ParentType, ContextType>;
  paymentHistory?: Resolver<ResolversTypes['PaymentRecordConnection'], ParentType, ContextType, Partial<QueryPaymentHistoryArgs>>;
  productCategories?: Resolver<Array<ResolversTypes['ProductCategory']>, ParentType, ContextType>;
  productHandleAvailability?: Resolver<ResolversTypes['HandleAvailability'], ParentType, ContextType, RequireFields<QueryProductHandleAvailabilityArgs, 'handle'>>;
  productOwnerStatus?: Resolver<Maybe<ResolversTypes['ProductOwnerStatus']>, ParentType, ContextType, RequireFields<QueryProductOwnerStatusArgs, 'productHandle'>>;
  profileAwards?: Resolver<Maybe<Array<ResolversTypes['ProductAward']>>, ParentType, ContextType, RequireFields<QueryProfileAwardsArgs, 'userHandle'>>;
  publicProfile?: Resolver<Maybe<ResolversTypes['PublicProfileResult']>, ParentType, ContextType, RequireFields<QueryPublicProfileArgs, 'handle'>>;
  qualifierBoard?: Resolver<ResolversTypes['QualifierBoard'], ParentType, ContextType>;
  systemStatus?: Resolver<ResolversTypes['SystemStatus'], ParentType, ContextType>;
  ultrasOffer?: Resolver<ResolversTypes['UltrasOffer'], ParentType, ContextType>;
  ultrasPromotionSetting?: Resolver<ResolversTypes['UltrasPromotionSetting'], ParentType, ContextType>;
  viewer?: Resolver<Maybe<ResolversTypes['Viewer']>, ParentType, ContextType>;
  viewerUltras?: Resolver<Maybe<ResolversTypes['ViewerUltras']>, ParentType, ContextType>;
};

export type RecoveryCodeSetResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RecoveryCodeSet'] = ResolversParentTypes['RecoveryCodeSet']> = {
  codes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
};

export type RelaunchBlockViewResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RelaunchBlockView'] = ResolversParentTypes['RelaunchBlockView']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  releaseAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
};

export type SecondFactorRequiredResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['SecondFactorRequired'] = ResolversParentTypes['SecondFactorRequired']> = {
  challenge?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  expiresAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type SystemStatusResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['SystemStatus'] = ResolversParentTypes['SystemStatus']> = {
  databaseReachable?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  serverTime?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
};

export type TotpSetupResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['TotpSetup'] = ResolversParentTypes['TotpSetup']> = {
  expiresAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  otpauthUri?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  secret?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type UltrasOfferResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UltrasOffer'] = ResolversParentTypes['UltrasOffer']> = {
  price?: Resolver<Maybe<ResolversTypes['Money']>, ParentType, ContextType>;
  priceStale?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  promotionEnabled?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type UltrasPlanResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UltrasPlan'] = ResolversParentTypes['UltrasPlan']> = {
  benefitEndsAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  canceledAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  currentPeriodEndsAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  startedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['UltrasPlanStatus'], ParentType, ContextType>;
};

export type UltrasPortalSessionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UltrasPortalSession'] = ResolversParentTypes['UltrasPortalSession']> = {
  url?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type UltrasPromotionSettingResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UltrasPromotionSetting'] = ResolversParentTypes['UltrasPromotionSetting']> = {
  enabled?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  updatedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  updatedByNickname?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  version?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type UserSessionSummaryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UserSessionSummary'] = ResolversParentTypes['UserSessionSummary']> = {
  browserName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  current?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  lastUsedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  osName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type UserSummaryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UserSummary'] = ResolversParentTypes['UserSummary']> = {
  avatar?: Resolver<Maybe<ResolversTypes['MediaImage']>, ParentType, ContextType>;
  handle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  nickname?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type ViewerResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Viewer'] = ResolversParentTypes['Viewer']> = {
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  emailVerified?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  handle?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  nickname?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  remainingRecoveryCodes?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['AccountStatus'], ParentType, ContextType>;
  totpEnabled?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type ViewerUltrasResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ViewerUltras'] = ResolversParentTypes['ViewerUltras']> = {
  canOpenPortal?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  entitled?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  plan?: Resolver<Maybe<ResolversTypes['UltrasPlan']>, ParentType, ContextType>;
};

export type Resolvers<ContextType = GraphQLContext> = {
  AdminAccount?: AdminAccountResolvers<ContextType>;
  AdminConfirmationResult?: AdminConfirmationResultResolvers<ContextType>;
  AdminInquiry?: AdminInquiryResolvers<ContextType>;
  AdminInquiryCategory?: AdminInquiryCategoryResolvers<ContextType>;
  AdminInquiryGuest?: AdminInquiryGuestResolvers<ContextType>;
  AdminInquiryMember?: AdminInquiryMemberResolvers<ContextType>;
  AdminInquiryPage?: AdminInquiryPageResolvers<ContextType>;
  AdminInquirySummary?: AdminInquirySummaryResolvers<ContextType>;
  AdminLegalDocument?: AdminLegalDocumentResolvers<ContextType>;
  AdminLegalDocumentSummary?: AdminLegalDocumentSummaryResolvers<ContextType>;
  AdminLegalDocumentVersion?: AdminLegalDocumentVersionResolvers<ContextType>;
  AdminLegalDraft?: AdminLegalDraftResolvers<ContextType>;
  AdminLegalRevision?: AdminLegalRevisionResolvers<ContextType>;
  AdminRecoveryCodeSet?: AdminRecoveryCodeSetResolvers<ContextType>;
  AdminSecondFactorRequired?: AdminSecondFactorRequiredResolvers<ContextType>;
  AdminTotpSetup?: AdminTotpSetupResolvers<ContextType>;
  AdminViewer?: AdminViewerResolvers<ContextType>;
  AuditDetail?: AuditDetailResolvers<ContextType>;
  AuditLogEntry?: AuditLogEntryResolvers<ContextType>;
  AuditLogPage?: AuditLogPageResolvers<ContextType>;
  AuditOperator?: AuditOperatorResolvers<ContextType>;
  Checkout?: CheckoutResolvers<ContextType>;
  CheckoutReturnResult?: CheckoutReturnResultResolvers<ContextType>;
  CheckoutStart?: CheckoutStartResolvers<ContextType>;
  CheckoutSummary?: CheckoutSummaryResolvers<ContextType>;
  ConfirmationResult?: ConfirmationResultResolvers<ContextType>;
  DateTime?: GraphQLScalarType;
  FollowEntry?: FollowEntryResolvers<ContextType>;
  FollowEntryConnection?: FollowEntryConnectionResolvers<ContextType>;
  FollowState?: FollowStateResolvers<ContextType>;
  InquiryCategory?: InquiryCategoryResolvers<ContextType>;
  InquiryComposer?: InquiryComposerResolvers<ContextType>;
  InquiryMessage?: InquiryMessageResolvers<ContextType>;
  InquiryReplyAuthor?: InquiryReplyAuthorResolvers<ContextType>;
  InquiryReplyResult?: InquiryReplyResultResolvers<ContextType>;
  LaunchDateRange?: LaunchDateRangeResolvers<ContextType>;
  LaunchDateWindow?: LaunchDateWindowResolvers<ContextType>;
  LaunchHistoryConnection?: LaunchHistoryConnectionResolvers<ContextType>;
  LaunchHistoryItem?: LaunchHistoryItemResolvers<ContextType>;
  LaunchHistoryProduct?: LaunchHistoryProductResolvers<ContextType>;
  LaunchSummary?: LaunchSummaryResolvers<ContextType>;
  LegalDocument?: LegalDocumentResolvers<ContextType>;
  LegalDocumentEditor?: LegalDocumentEditorResolvers<ContextType>;
  LegalDocumentVersion?: LegalDocumentVersionResolvers<ContextType>;
  LegalRevision?: LegalRevisionResolvers<ContextType>;
  LoginResult?: LoginResultResolvers<ContextType>;
  LoginSucceeded?: LoginSucceededResolvers<ContextType>;
  Match?: MatchResolvers<ContextType>;
  MatchBye?: MatchByeResolvers<ContextType>;
  MatchEntry?: MatchEntryResolvers<ContextType>;
  MatchProduct?: MatchProductResolvers<ContextType>;
  MediaAttachment?: MediaAttachmentResolvers<ContextType>;
  MediaImage?: MediaImageResolvers<ContextType>;
  MemberInquiry?: MemberInquiryResolvers<ContextType>;
  MemberInquiryPage?: MemberInquiryPageResolvers<ContextType>;
  MemberInquirySummary?: MemberInquirySummaryResolvers<ContextType>;
  Money?: MoneyResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  MyProduct?: MyProductResolvers<ContextType>;
  MyProductConnection?: MyProductConnectionResolvers<ContextType>;
  MyProductRedirect?: MyProductRedirectResolvers<ContextType>;
  MyProductResult?: MyProductResultResolvers<ContextType>;
  MyProfile?: MyProfileResolvers<ContextType>;
  OffsetPageInfo?: OffsetPageInfoResolvers<ContextType>;
  PageInfo?: PageInfoResolvers<ContextType>;
  PaymentRecord?: PaymentRecordResolvers<ContextType>;
  PaymentRecordConnection?: PaymentRecordConnectionResolvers<ContextType>;
  ProductAward?: ProductAwardResolvers<ContextType>;
  ProductCategory?: ProductCategoryResolvers<ContextType>;
  ProductLaunch?: ProductLaunchResolvers<ContextType>;
  ProductLaunchPlan?: ProductLaunchPlanResolvers<ContextType>;
  ProductLockView?: ProductLockViewResolvers<ContextType>;
  ProductOwnerStatus?: ProductOwnerStatusResolvers<ContextType>;
  ProductScreenshot?: ProductScreenshotResolvers<ContextType>;
  ProfileWebsite?: ProfileWebsiteResolvers<ContextType>;
  PublicProfile?: PublicProfileResolvers<ContextType>;
  PublicProfileRedirect?: PublicProfileRedirectResolvers<ContextType>;
  PublicProfileResult?: PublicProfileResultResolvers<ContextType>;
  QualifierBoard?: QualifierBoardResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  RecoveryCodeSet?: RecoveryCodeSetResolvers<ContextType>;
  RelaunchBlockView?: RelaunchBlockViewResolvers<ContextType>;
  SecondFactorRequired?: SecondFactorRequiredResolvers<ContextType>;
  SystemStatus?: SystemStatusResolvers<ContextType>;
  TotpSetup?: TotpSetupResolvers<ContextType>;
  UltrasOffer?: UltrasOfferResolvers<ContextType>;
  UltrasPlan?: UltrasPlanResolvers<ContextType>;
  UltrasPortalSession?: UltrasPortalSessionResolvers<ContextType>;
  UltrasPromotionSetting?: UltrasPromotionSettingResolvers<ContextType>;
  UserSessionSummary?: UserSessionSummaryResolvers<ContextType>;
  UserSummary?: UserSummaryResolvers<ContextType>;
  Viewer?: ViewerResolvers<ContextType>;
  ViewerUltras?: ViewerUltrasResolvers<ContextType>;
};

