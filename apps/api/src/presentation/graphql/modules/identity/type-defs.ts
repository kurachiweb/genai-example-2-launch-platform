export const IDENTITY_TYPE_DEFS = /* GraphQL */ `
  "利用者の状態"
  enum AccountStatus {
    ACTIVE
    SUSPENDED
  }

  "確認メールの再送の結果"
  enum ResendVerificationResult {
    SENT
    ALREADY_VERIFIED
  }

  "ログイン中の利用者"
  type Viewer {
    id: ID!
    handle: String!
    nickname: String!
    email: String!
    emailVerified: Boolean!
    status: AccountStatus!
    totpEnabled: Boolean!
    "要求されたときだけ数える。多要素認証が無効なら0"
    remainingRecoveryCodes: Int!
  }

  "ログイン中の端末"
  type UserSessionSummary {
    id: ID!
    browserName: String
    osName: String
    createdAt: DateTime!
    lastUsedAt: DateTime!
    "操作している端末"
    current: Boolean!
  }

  "ログインの完了"
  type LoginSucceeded {
    viewer: Viewer!
  }

  "第2要素の入力の待ち"
  type SecondFactorRequired {
    "第2要素の段階の要求と組にする値"
    challenge: String!
    expiresAt: DateTime!
  }

  union LoginResult = LoginSucceeded | SecondFactorRequired

  "認証アプリへ登録する多要素認証の設定"
  type TotpSetup {
    otpauthUri: String!
    "認証アプリへ手入力するためのbase32"
    secret: String!
    expiresAt: DateTime!
  }

  "この応答でだけ見せるリカバリコード"
  type RecoveryCodeSet {
    codes: [String!]!
  }

  "メールのリンクによる確定の結果"
  type ConfirmationResult {
    "確定の操作をした端末が同じ利用者としてログイン中なら、入れ替えた後の利用者"
    viewer: Viewer
  }

  "認証コードかリカバリコードのどちらか一方"
  input SecondFactorInput {
    totpCode: String
    recoveryCode: String
  }

  "重要な操作の本人確認"
  input ReAuthenticationInput {
    currentPassword: String!
    "多要素認証が有効なときだけ必要"
    secondFactor: SecondFactorInput
  }

  input RegisterUserInput {
    nickname: String!
    email: String!
    password: String!
    "利用規約とプライバシーポリシー(18歳以上であることの表明を含む)への同意"
    agreedToTerms: Boolean!
  }

  input LoginInput {
    email: String!
    password: String!
  }

  input CompleteSecondFactorLoginInput {
    challenge: String!
    secondFactor: SecondFactorInput!
  }

  input ResetPasswordInput {
    token: String!
    newPassword: String!
  }

  input RequestEmailChangeInput {
    newEmail: String!
    reAuthentication: ReAuthenticationInput!
  }

  input RequestPasswordChangeInput {
    newPassword: String!
    reAuthentication: ReAuthenticationInput!
  }

  type Query {
    "ログイン中の利用者。未ログイン・無効なセッションではnull"
    viewer: Viewer
    "ログイン中の端末の一覧"
    mySessions: [UserSessionSummary!]!
  }

  type Mutation {
    "利用者の登録"
    registerUser(input: RegisterUserInput!): Viewer!
    "メールアドレスとパスワードによるログイン"
    login(input: LoginInput!): LoginResult!
    "認証コードかリカバリコードによるログインの完了"
    completeSecondFactorLogin(input: CompleteSecondFactorLoginInput!): Viewer!
    "この端末のログアウト"
    logout: Boolean!
    "確認メールの再送"
    resendVerificationEmail: ResendVerificationResult!
    "メールアドレスの確認の確定"
    verifyEmail(token: String!): Boolean!
    "パスワードリセットの要求。アカウントの有無を問わず同じ結果を返す"
    requestPasswordReset(email: String!): Boolean!
    "パスワードリセットの確定"
    resetPassword(input: ResetPasswordInput!): Boolean!
    "メールアドレス変更の要求"
    requestEmailChange(input: RequestEmailChangeInput!): Boolean!
    "メールアドレス変更の確定"
    confirmEmailChange(token: String!): ConfirmationResult!
    "パスワード変更の要求"
    requestPasswordChange(input: RequestPasswordChangeInput!): Boolean!
    "パスワード変更の確定"
    confirmPasswordChange(token: String!): ConfirmationResult!
    "セッションの個別の失効"
    revokeSession(id: ID!): Boolean!
    "操作している端末以外のセッションの一括の失効。失効させた件数を返す"
    revokeOtherSessions: Int!
    "多要素認証の設定の開始"
    startTotpSetup(input: ReAuthenticationInput!): TotpSetup!
    "多要素認証の有効化"
    enableTotp(totpCode: String!): RecoveryCodeSet!
    "多要素認証の無効化"
    disableTotp(input: ReAuthenticationInput!): Boolean!
    "リカバリコードの再発行"
    regenerateRecoveryCodes(input: ReAuthenticationInput!): RecoveryCodeSet!
    "退会"
    withdraw(input: ReAuthenticationInput!): Boolean!
  }
`;
