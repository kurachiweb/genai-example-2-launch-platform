import type { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import type { ViewerSource } from '../modules/identity/resolver-support.ts';
import type { AdminViewerSource, AdminAccountSource } from '../modules/admin/resolver-support.ts';
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

export type Mutation = {
  __typename?: 'Mutation';
  /** メールアドレスとパスワードによるログイン。有効な管理者には必ず第2要素を求める */
  adminLogin: AdminSecondFactorRequired;
  /** この端末のログアウト */
  adminLogout: Scalars['Boolean']['output'];
  /** パスワードの変更。操作した端末へ新しいセッションを発行する */
  changeAdminPassword: Scalars['Boolean']['output'];
  /** ロールの変更 */
  changeAdminRole: AdminAccount;
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
  /** メールアドレス変更の確定 */
  confirmEmailChange: ConfirmationResult;
  /** パスワード変更の確定 */
  confirmPasswordChange: ConfirmationResult;
  /** 管理者の削除 */
  deleteAdmin: Scalars['Boolean']['output'];
  /** 多要素認証の無効化 */
  disableTotp: Scalars['Boolean']['output'];
  /** 多要素認証の有効化 */
  enableTotp: RecoveryCodeSet;
  /** 閲覧のみのロールで招待し、招待のメールを送る */
  inviteAdmin: AdminAccount;
  /** メールアドレスとパスワードによるログイン */
  login: LoginResult;
  /** この端末のログアウト */
  logout: Scalars['Boolean']['output'];
  /** リカバリコードの再発行。操作した端末へ新しいセッションを発行する */
  regenerateAdminRecoveryCodes: AdminRecoveryCodeSet;
  /** リカバリコードの再発行 */
  regenerateRecoveryCodes: RecoveryCodeSet;
  /** 利用者の登録 */
  registerUser: Viewer;
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
  /** 招待の完了の1段階目。ニックネームとパスワードを仮に保存し、多要素認証の設定を始める */
  startAdminInvitation: AdminTotpSetup;
  /** 多要素認証の再設定の開始。完了まで現在の設定が有効なまま残る */
  startAdminTotpReset: AdminTotpSetup;
  /** 多要素認証の設定の開始 */
  startTotpSetup: TotpSetup;
  /** プロフィールの更新。avatarFileIdの省略は画像を取り除く */
  updateAdminProfile: AdminAccount;
  /** メールアドレスの確認の確定 */
  verifyEmail: Scalars['Boolean']['output'];
  /** 退会 */
  withdraw: Scalars['Boolean']['output'];
};


export type MutationAdminLoginArgs = {
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
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


export type MutationConfirmEmailChangeArgs = {
  token: Scalars['String']['input'];
};


export type MutationConfirmPasswordChangeArgs = {
  token: Scalars['String']['input'];
};


export type MutationDeleteAdminArgs = {
  id: Scalars['ID']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
};


export type MutationDisableTotpArgs = {
  input: ReAuthenticationInput;
};


export type MutationEnableTotpArgs = {
  totpCode: Scalars['String']['input'];
};


export type MutationInviteAdminArgs = {
  email: Scalars['String']['input'];
  reason?: InputMaybe<Scalars['String']['input']>;
};


export type MutationLoginArgs = {
  input: LoginInput;
};


export type MutationRegenerateAdminRecoveryCodesArgs = {
  reAuthentication: AdminReAuthenticationInput;
};


export type MutationRegenerateRecoveryCodesArgs = {
  input: ReAuthenticationInput;
};


export type MutationRegisterUserArgs = {
  input: RegisterUserInput;
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


export type MutationUpdateAdminProfileArgs = {
  avatarFileId?: InputMaybe<Scalars['ID']['input']>;
  id: Scalars['ID']['input'];
  nickname: Scalars['String']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
};


export type MutationVerifyEmailArgs = {
  token: Scalars['String']['input'];
};


export type MutationWithdrawArgs = {
  input: ReAuthenticationInput;
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

/** 下書きの公開 */
export type PublishLegalDocumentInput = {
  changeSummary: Scalars['String']['input'];
  expectedStateVersion: Scalars['Int']['input'];
  kind: LegalDocumentKind;
};

export type Query = {
  __typename?: 'Query';
  /** 招待中を含む全管理者を登録の新しい順に返す */
  adminAccounts: Array<AdminAccount>;
  /** ログイン中の管理者。未ログイン・無効なセッションではnull */
  adminViewer?: Maybe<AdminViewer>;
  /** 監査ログの検索。変更・削除の操作は無い */
  auditLogs: AuditLogPage;
  /** 法務文書の最新版と改訂履歴 */
  legalDocument: LegalDocument;
  /** 法務文書の指定した版。存在しない版はnull */
  legalDocumentVersion?: Maybe<LegalDocumentVersion>;
  /** ログイン中の端末の一覧 */
  mySessions: Array<UserSessionSummary>;
  /** APIサーバーの時刻とデータベースへの到達可否 */
  systemStatus: SystemStatus;
  /** ログイン中の利用者。未ログイン・無効なセッションではnull */
  viewer?: Maybe<Viewer>;
};


export type QueryAuditLogsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<AuditLogFilterInput>;
};


export type QueryLegalDocumentArgs = {
  kind: LegalDocumentKind;
};


export type QueryLegalDocumentVersionArgs = {
  kind: LegalDocumentKind;
  versionNumber: Scalars['Int']['input'];
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

export type RegisterUserInput = {
  /** 利用規約とプライバシーポリシー(18歳以上であることの表明を含む)への同意 */
  agreedToTerms: Scalars['Boolean']['input'];
  email: Scalars['String']['input'];
  nickname: Scalars['String']['input'];
  password: Scalars['String']['input'];
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
};


/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  AccountStatus: AccountStatus;
  AdminAccount: ResolverTypeWrapper<AdminAccountSource>;
  AdminAccountStatus: AdminAccountStatus;
  AdminConfirmationResult: ResolverTypeWrapper<Omit<AdminConfirmationResult, 'viewer'> & { viewer?: Maybe<ResolversTypes['AdminViewer']> }>;
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
  CompleteSecondFactorLoginInput: CompleteSecondFactorLoginInput;
  ConfirmationResult: ResolverTypeWrapper<Omit<ConfirmationResult, 'viewer'> & { viewer?: Maybe<ResolversTypes['Viewer']> }>;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  DiscardLegalDocumentDraftInput: DiscardLegalDocumentDraftInput;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  LegalDocument: ResolverTypeWrapper<LegalDocument>;
  LegalDocumentEditor: ResolverTypeWrapper<LegalDocumentEditor>;
  LegalDocumentKind: LegalDocumentKind;
  LegalDocumentVersion: ResolverTypeWrapper<LegalDocumentVersion>;
  LegalRevision: ResolverTypeWrapper<LegalRevision>;
  LoginInput: LoginInput;
  LoginResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['LoginResult']>;
  LoginSucceeded: ResolverTypeWrapper<Omit<LoginSucceeded, 'viewer'> & { viewer: ResolversTypes['Viewer'] }>;
  MediaAttachment: ResolverTypeWrapper<MediaAttachment>;
  MediaImage: ResolverTypeWrapper<MediaImage>;
  MediaImageFallbackFormat: MediaImageFallbackFormat;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  OffsetPageInfo: ResolverTypeWrapper<OffsetPageInfo>;
  PageInfo: ResolverTypeWrapper<PageInfo>;
  PublishLegalDocumentInput: PublishLegalDocumentInput;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  ReAuthenticationInput: ReAuthenticationInput;
  RecoveryCodeSet: ResolverTypeWrapper<RecoveryCodeSet>;
  RegisterUserInput: RegisterUserInput;
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
  UserSessionSummary: ResolverTypeWrapper<UserSessionSummary>;
  Viewer: ResolverTypeWrapper<ViewerSource>;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  AdminAccount: AdminAccountSource;
  AdminConfirmationResult: Omit<AdminConfirmationResult, 'viewer'> & { viewer?: Maybe<ResolversParentTypes['AdminViewer']> };
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
  CompleteSecondFactorLoginInput: CompleteSecondFactorLoginInput;
  ConfirmationResult: Omit<ConfirmationResult, 'viewer'> & { viewer?: Maybe<ResolversParentTypes['Viewer']> };
  DateTime: Scalars['DateTime']['output'];
  DiscardLegalDocumentDraftInput: DiscardLegalDocumentDraftInput;
  ID: Scalars['ID']['output'];
  Int: Scalars['Int']['output'];
  LegalDocument: LegalDocument;
  LegalDocumentEditor: LegalDocumentEditor;
  LegalDocumentVersion: LegalDocumentVersion;
  LegalRevision: LegalRevision;
  LoginInput: LoginInput;
  LoginResult: ResolversUnionTypes<ResolversParentTypes>['LoginResult'];
  LoginSucceeded: Omit<LoginSucceeded, 'viewer'> & { viewer: ResolversParentTypes['Viewer'] };
  MediaAttachment: MediaAttachment;
  MediaImage: MediaImage;
  Mutation: Record<PropertyKey, never>;
  OffsetPageInfo: OffsetPageInfo;
  PageInfo: PageInfo;
  PublishLegalDocumentInput: PublishLegalDocumentInput;
  Query: Record<PropertyKey, never>;
  ReAuthenticationInput: ReAuthenticationInput;
  RecoveryCodeSet: RecoveryCodeSet;
  RegisterUserInput: RegisterUserInput;
  RequestEmailChangeInput: RequestEmailChangeInput;
  RequestPasswordChangeInput: RequestPasswordChangeInput;
  ResetPasswordInput: ResetPasswordInput;
  SaveLegalDocumentDraftInput: SaveLegalDocumentDraftInput;
  SecondFactorInput: SecondFactorInput;
  SecondFactorRequired: SecondFactorRequired;
  String: Scalars['String']['output'];
  SystemStatus: SystemStatus;
  TotpSetup: TotpSetup;
  UserSessionSummary: UserSessionSummary;
  Viewer: ViewerSource;
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

export type ConfirmationResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ConfirmationResult'] = ResolversParentTypes['ConfirmationResult']> = {
  viewer?: Resolver<Maybe<ResolversTypes['Viewer']>, ParentType, ContextType>;
};

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

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

export type MutationResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  adminLogin?: Resolver<ResolversTypes['AdminSecondFactorRequired'], ParentType, ContextType, RequireFields<MutationAdminLoginArgs, 'email' | 'password'>>;
  adminLogout?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  changeAdminPassword?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationChangeAdminPasswordArgs, 'newPassword' | 'reAuthentication'>>;
  changeAdminRole?: Resolver<ResolversTypes['AdminAccount'], ParentType, ContextType, RequireFields<MutationChangeAdminRoleArgs, 'id' | 'role'>>;
  completeAdminInvitation?: Resolver<ResolversTypes['AdminRecoveryCodeSet'], ParentType, ContextType, RequireFields<MutationCompleteAdminInvitationArgs, 'token' | 'totpCode'>>;
  completeAdminSecondFactorLogin?: Resolver<ResolversTypes['AdminViewer'], ParentType, ContextType, RequireFields<MutationCompleteAdminSecondFactorLoginArgs, 'challenge' | 'secondFactor'>>;
  completeAdminTotpReset?: Resolver<ResolversTypes['AdminRecoveryCodeSet'], ParentType, ContextType, RequireFields<MutationCompleteAdminTotpResetArgs, 'totpCode'>>;
  completeSecondFactorLogin?: Resolver<ResolversTypes['Viewer'], ParentType, ContextType, RequireFields<MutationCompleteSecondFactorLoginArgs, 'input'>>;
  confirmAdminEmailChange?: Resolver<ResolversTypes['AdminConfirmationResult'], ParentType, ContextType, RequireFields<MutationConfirmAdminEmailChangeArgs, 'token'>>;
  confirmEmailChange?: Resolver<ResolversTypes['ConfirmationResult'], ParentType, ContextType, RequireFields<MutationConfirmEmailChangeArgs, 'token'>>;
  confirmPasswordChange?: Resolver<ResolversTypes['ConfirmationResult'], ParentType, ContextType, RequireFields<MutationConfirmPasswordChangeArgs, 'token'>>;
  deleteAdmin?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteAdminArgs, 'id'>>;
  disableTotp?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDisableTotpArgs, 'input'>>;
  enableTotp?: Resolver<ResolversTypes['RecoveryCodeSet'], ParentType, ContextType, RequireFields<MutationEnableTotpArgs, 'totpCode'>>;
  inviteAdmin?: Resolver<ResolversTypes['AdminAccount'], ParentType, ContextType, RequireFields<MutationInviteAdminArgs, 'email'>>;
  login?: Resolver<ResolversTypes['LoginResult'], ParentType, ContextType, RequireFields<MutationLoginArgs, 'input'>>;
  logout?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  regenerateAdminRecoveryCodes?: Resolver<ResolversTypes['AdminRecoveryCodeSet'], ParentType, ContextType, RequireFields<MutationRegenerateAdminRecoveryCodesArgs, 'reAuthentication'>>;
  regenerateRecoveryCodes?: Resolver<ResolversTypes['RecoveryCodeSet'], ParentType, ContextType, RequireFields<MutationRegenerateRecoveryCodesArgs, 'input'>>;
  registerUser?: Resolver<ResolversTypes['Viewer'], ParentType, ContextType, RequireFields<MutationRegisterUserArgs, 'input'>>;
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
  startAdminInvitation?: Resolver<ResolversTypes['AdminTotpSetup'], ParentType, ContextType, RequireFields<MutationStartAdminInvitationArgs, 'nickname' | 'password' | 'token'>>;
  startAdminTotpReset?: Resolver<ResolversTypes['AdminTotpSetup'], ParentType, ContextType, RequireFields<MutationStartAdminTotpResetArgs, 'reAuthentication'>>;
  startTotpSetup?: Resolver<ResolversTypes['TotpSetup'], ParentType, ContextType, RequireFields<MutationStartTotpSetupArgs, 'input'>>;
  updateAdminProfile?: Resolver<ResolversTypes['AdminAccount'], ParentType, ContextType, RequireFields<MutationUpdateAdminProfileArgs, 'id' | 'nickname'>>;
  verifyEmail?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationVerifyEmailArgs, 'token'>>;
  withdraw?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationWithdrawArgs, 'input'>>;
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

export type QueryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  adminAccounts?: Resolver<Array<ResolversTypes['AdminAccount']>, ParentType, ContextType>;
  adminViewer?: Resolver<Maybe<ResolversTypes['AdminViewer']>, ParentType, ContextType>;
  auditLogs?: Resolver<ResolversTypes['AuditLogPage'], ParentType, ContextType, Partial<QueryAuditLogsArgs>>;
  legalDocument?: Resolver<ResolversTypes['LegalDocument'], ParentType, ContextType, RequireFields<QueryLegalDocumentArgs, 'kind'>>;
  legalDocumentVersion?: Resolver<Maybe<ResolversTypes['LegalDocumentVersion']>, ParentType, ContextType, RequireFields<QueryLegalDocumentVersionArgs, 'kind' | 'versionNumber'>>;
  mySessions?: Resolver<Array<ResolversTypes['UserSessionSummary']>, ParentType, ContextType>;
  systemStatus?: Resolver<ResolversTypes['SystemStatus'], ParentType, ContextType>;
  viewer?: Resolver<Maybe<ResolversTypes['Viewer']>, ParentType, ContextType>;
};

export type RecoveryCodeSetResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RecoveryCodeSet'] = ResolversParentTypes['RecoveryCodeSet']> = {
  codes?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
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

export type UserSessionSummaryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UserSessionSummary'] = ResolversParentTypes['UserSessionSummary']> = {
  browserName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  current?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  lastUsedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  osName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
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

export type Resolvers<ContextType = GraphQLContext> = {
  AdminAccount?: AdminAccountResolvers<ContextType>;
  AdminConfirmationResult?: AdminConfirmationResultResolvers<ContextType>;
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
  ConfirmationResult?: ConfirmationResultResolvers<ContextType>;
  DateTime?: GraphQLScalarType;
  LegalDocument?: LegalDocumentResolvers<ContextType>;
  LegalDocumentEditor?: LegalDocumentEditorResolvers<ContextType>;
  LegalDocumentVersion?: LegalDocumentVersionResolvers<ContextType>;
  LegalRevision?: LegalRevisionResolvers<ContextType>;
  LoginResult?: LoginResultResolvers<ContextType>;
  LoginSucceeded?: LoginSucceededResolvers<ContextType>;
  MediaAttachment?: MediaAttachmentResolvers<ContextType>;
  MediaImage?: MediaImageResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  OffsetPageInfo?: OffsetPageInfoResolvers<ContextType>;
  PageInfo?: PageInfoResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  RecoveryCodeSet?: RecoveryCodeSetResolvers<ContextType>;
  SecondFactorRequired?: SecondFactorRequiredResolvers<ContextType>;
  SystemStatus?: SystemStatusResolvers<ContextType>;
  TotpSetup?: TotpSetupResolvers<ContextType>;
  UserSessionSummary?: UserSessionSummaryResolvers<ContextType>;
  Viewer?: ViewerResolvers<ContextType>;
};

