// パスワードの引数に説明を付けると、印字したスキーマで引数が1行ずつに並び、シークレット検出の誤検知の除外(型の注釈だけの行)に当たる
export const ADMIN_TYPE_DEFS = /* GraphQL */ `
  "管理者のロール"
  enum AdminRole {
    VIEWER
    MODERATOR
    SUPER_ADMIN
  }

  "ログイン中の管理者"
  type AdminViewer {
    id: ID!
    nickname: String!
    title: String
    email: String!
    role: AdminRole!
    "未登録・表示できない画像ではnull"
    avatar: MediaImage
    "要求されたときだけ数える"
    remainingRecoveryCodes: Int!
  }

  "第2要素の入力の待ち"
  type AdminSecondFactorRequired {
    "第2要素の段階の要求と組にする値"
    challenge: String!
    expiresAt: DateTime!
  }

  "認証アプリへ登録する多要素認証の設定"
  type AdminTotpSetup {
    otpauthUri: String!
    "認証アプリへ手入力するためのbase32"
    secret: String!
    expiresAt: DateTime!
  }

  "この応答でだけ見せるリカバリコード"
  type AdminRecoveryCodeSet {
    codes: [String!]!
  }

  "メールのリンクによる確定の結果"
  type AdminConfirmationResult {
    "確定の操作をした端末が同じ管理者としてログイン中なら、入れ替えた後の管理者"
    viewer: AdminViewer
  }

  "認証コードかリカバリコードのどちらか一方"
  input AdminSecondFactorInput {
    totpCode: String
    recoveryCode: String
  }

  type Query {
    "ログイン中の管理者。未ログイン・無効なセッションではnull"
    adminViewer: AdminViewer
  }

  type Mutation {
    "メールアドレスとパスワードによるログイン。有効な管理者には必ず第2要素を求める"
    adminLogin(
      email: String!
      "照合するパスワード"
      password: String!
    ): AdminSecondFactorRequired!
    "認証コードかリカバリコードによるログインの完了"
    completeAdminSecondFactorLogin(
      challenge: String!
      secondFactor: AdminSecondFactorInput!
    ): AdminViewer!
    "この端末のログアウト"
    adminLogout: Boolean!
    "パスワードリセットの要求。管理者の有無と状態を問わず同じ結果を返す"
    requestAdminPasswordReset(email: String!): Boolean!
    "パスワードリセットの確定"
    resetAdminPassword(
      token: String!
      "設定する新しいパスワード"
      newPassword: String!
    ): Boolean!
    "招待の完了の1段階目。ニックネームとパスワードを仮に保存し、多要素認証の設定を始める"
    startAdminInvitation(
      token: String!
      nickname: String!
      "設定するパスワード"
      password: String!
    ): AdminTotpSetup!
    "招待の完了の2段階目。認証コードで有効化し、ログインする"
    completeAdminInvitation(
      token: String!
      totpCode: String!
    ): AdminRecoveryCodeSet!
    "メールアドレス変更の確定"
    confirmAdminEmailChange(token: String!): AdminConfirmationResult!
  }
`;
