import type { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import type { ViewerSource } from '../modules/identity/resolver-support.ts';
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
  /** 認証コードかリカバリコードによるログインの完了 */
  completeSecondFactorLogin: Viewer;
  /** メールアドレス変更の確定 */
  confirmEmailChange: ConfirmationResult;
  /** パスワード変更の確定 */
  confirmPasswordChange: ConfirmationResult;
  /** 多要素認証の無効化 */
  disableTotp: Scalars['Boolean']['output'];
  /** 多要素認証の有効化 */
  enableTotp: RecoveryCodeSet;
  /** メールアドレスとパスワードによるログイン */
  login: LoginResult;
  /** この端末のログアウト */
  logout: Scalars['Boolean']['output'];
  /** リカバリコードの再発行 */
  regenerateRecoveryCodes: RecoveryCodeSet;
  /** 利用者の登録 */
  registerUser: Viewer;
  /** メールアドレス変更の要求 */
  requestEmailChange: Scalars['Boolean']['output'];
  /** パスワード変更の要求 */
  requestPasswordChange: Scalars['Boolean']['output'];
  /** パスワードリセットの要求。アカウントの有無を問わず同じ結果を返す */
  requestPasswordReset: Scalars['Boolean']['output'];
  /** 確認メールの再送 */
  resendVerificationEmail: ResendVerificationResult;
  /** パスワードリセットの確定 */
  resetPassword: Scalars['Boolean']['output'];
  /** 操作している端末以外のセッションの一括の失効。失効させた件数を返す */
  revokeOtherSessions: Scalars['Int']['output'];
  /** セッションの個別の失効 */
  revokeSession: Scalars['Boolean']['output'];
  /** 多要素認証の設定の開始 */
  startTotpSetup: TotpSetup;
  /** メールアドレスの確認の確定 */
  verifyEmail: Scalars['Boolean']['output'];
  /** 退会 */
  withdraw: Scalars['Boolean']['output'];
};


export type MutationCompleteSecondFactorLoginArgs = {
  input: CompleteSecondFactorLoginInput;
};


export type MutationConfirmEmailChangeArgs = {
  token: Scalars['String']['input'];
};


export type MutationConfirmPasswordChangeArgs = {
  token: Scalars['String']['input'];
};


export type MutationDisableTotpArgs = {
  input: ReAuthenticationInput;
};


export type MutationEnableTotpArgs = {
  totpCode: Scalars['String']['input'];
};


export type MutationLoginArgs = {
  input: LoginInput;
};


export type MutationRegenerateRecoveryCodesArgs = {
  input: ReAuthenticationInput;
};


export type MutationRegisterUserArgs = {
  input: RegisterUserInput;
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


export type MutationResetPasswordArgs = {
  input: ResetPasswordInput;
};


export type MutationRevokeSessionArgs = {
  id: Scalars['ID']['input'];
};


export type MutationStartTotpSetupArgs = {
  input: ReAuthenticationInput;
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

export type Query = {
  __typename?: 'Query';
  /** ログイン中の端末の一覧 */
  mySessions: Array<UserSessionSummary>;
  /** APIサーバーの時刻とデータベースへの到達可否 */
  systemStatus: SystemStatus;
  /** ログイン中の利用者。未ログイン・無効なセッションではnull */
  viewer?: Maybe<Viewer>;
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
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  CompleteSecondFactorLoginInput: CompleteSecondFactorLoginInput;
  ConfirmationResult: ResolverTypeWrapper<Omit<ConfirmationResult, 'viewer'> & { viewer?: Maybe<ResolversTypes['Viewer']> }>;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  LoginInput: LoginInput;
  LoginResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['LoginResult']>;
  LoginSucceeded: ResolverTypeWrapper<Omit<LoginSucceeded, 'viewer'> & { viewer: ResolversTypes['Viewer'] }>;
  MediaAttachment: ResolverTypeWrapper<MediaAttachment>;
  MediaImage: ResolverTypeWrapper<MediaImage>;
  MediaImageFallbackFormat: MediaImageFallbackFormat;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  OffsetPageInfo: ResolverTypeWrapper<OffsetPageInfo>;
  PageInfo: ResolverTypeWrapper<PageInfo>;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  ReAuthenticationInput: ReAuthenticationInput;
  RecoveryCodeSet: ResolverTypeWrapper<RecoveryCodeSet>;
  RegisterUserInput: RegisterUserInput;
  RequestEmailChangeInput: RequestEmailChangeInput;
  RequestPasswordChangeInput: RequestPasswordChangeInput;
  ResendVerificationResult: ResendVerificationResult;
  ResetPasswordInput: ResetPasswordInput;
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
  Boolean: Scalars['Boolean']['output'];
  CompleteSecondFactorLoginInput: CompleteSecondFactorLoginInput;
  ConfirmationResult: Omit<ConfirmationResult, 'viewer'> & { viewer?: Maybe<ResolversParentTypes['Viewer']> };
  DateTime: Scalars['DateTime']['output'];
  ID: Scalars['ID']['output'];
  Int: Scalars['Int']['output'];
  LoginInput: LoginInput;
  LoginResult: ResolversUnionTypes<ResolversParentTypes>['LoginResult'];
  LoginSucceeded: Omit<LoginSucceeded, 'viewer'> & { viewer: ResolversParentTypes['Viewer'] };
  MediaAttachment: MediaAttachment;
  MediaImage: MediaImage;
  Mutation: Record<PropertyKey, never>;
  OffsetPageInfo: OffsetPageInfo;
  PageInfo: PageInfo;
  Query: Record<PropertyKey, never>;
  ReAuthenticationInput: ReAuthenticationInput;
  RecoveryCodeSet: RecoveryCodeSet;
  RegisterUserInput: RegisterUserInput;
  RequestEmailChangeInput: RequestEmailChangeInput;
  RequestPasswordChangeInput: RequestPasswordChangeInput;
  ResetPasswordInput: ResetPasswordInput;
  SecondFactorInput: SecondFactorInput;
  SecondFactorRequired: SecondFactorRequired;
  String: Scalars['String']['output'];
  SystemStatus: SystemStatus;
  TotpSetup: TotpSetup;
  UserSessionSummary: UserSessionSummary;
  Viewer: ViewerSource;
};

export type ConfirmationResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ConfirmationResult'] = ResolversParentTypes['ConfirmationResult']> = {
  viewer?: Resolver<Maybe<ResolversTypes['Viewer']>, ParentType, ContextType>;
};

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

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
  completeSecondFactorLogin?: Resolver<ResolversTypes['Viewer'], ParentType, ContextType, RequireFields<MutationCompleteSecondFactorLoginArgs, 'input'>>;
  confirmEmailChange?: Resolver<ResolversTypes['ConfirmationResult'], ParentType, ContextType, RequireFields<MutationConfirmEmailChangeArgs, 'token'>>;
  confirmPasswordChange?: Resolver<ResolversTypes['ConfirmationResult'], ParentType, ContextType, RequireFields<MutationConfirmPasswordChangeArgs, 'token'>>;
  disableTotp?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDisableTotpArgs, 'input'>>;
  enableTotp?: Resolver<ResolversTypes['RecoveryCodeSet'], ParentType, ContextType, RequireFields<MutationEnableTotpArgs, 'totpCode'>>;
  login?: Resolver<ResolversTypes['LoginResult'], ParentType, ContextType, RequireFields<MutationLoginArgs, 'input'>>;
  logout?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  regenerateRecoveryCodes?: Resolver<ResolversTypes['RecoveryCodeSet'], ParentType, ContextType, RequireFields<MutationRegenerateRecoveryCodesArgs, 'input'>>;
  registerUser?: Resolver<ResolversTypes['Viewer'], ParentType, ContextType, RequireFields<MutationRegisterUserArgs, 'input'>>;
  requestEmailChange?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRequestEmailChangeArgs, 'input'>>;
  requestPasswordChange?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRequestPasswordChangeArgs, 'input'>>;
  requestPasswordReset?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRequestPasswordResetArgs, 'email'>>;
  resendVerificationEmail?: Resolver<ResolversTypes['ResendVerificationResult'], ParentType, ContextType>;
  resetPassword?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationResetPasswordArgs, 'input'>>;
  revokeOtherSessions?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  revokeSession?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationRevokeSessionArgs, 'id'>>;
  startTotpSetup?: Resolver<ResolversTypes['TotpSetup'], ParentType, ContextType, RequireFields<MutationStartTotpSetupArgs, 'input'>>;
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
  ConfirmationResult?: ConfirmationResultResolvers<ContextType>;
  DateTime?: GraphQLScalarType;
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

