// パスワードの引数に説明を付けると、印字したスキーマで引数が1行ずつに並び、シークレット検出の誤検知の除外(型の注釈だけの行)に当たる
export const ADMIN_TYPE_DEFS = /* GraphQL */ `
  "管理者のロール"
  enum AdminRole {
    VIEWER
    MODERATOR
    SUPER_ADMIN
  }

  "管理者の一覧に示す状態"
  enum AdminAccountStatus {
    ACTIVE
    INVITED
    INVITATION_EXPIRED
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

  "管理者のアカウント"
  type AdminAccount {
    id: ID!
    email: String!
    "招待の完了前はnull"
    nickname: String
    title: String
    "未登録・表示できない画像ではnull"
    avatar: MediaImage
    role: AdminRole!
    status: AdminAccountStatus!
    createdAt: DateTime!
  }

  "監査ログを記録した操作者"
  type AuditOperator {
    id: ID!
    "削除済みの管理者ではnull"
    nickname: String
  }

  "監査ログの詳細の1項目"
  type AuditDetail {
    key: String!
    value: String!
  }

  "監査ログの1件"
  type AuditLogEntry {
    id: ID!
    occurredAt: DateTime!
    operator: AuditOperator!
    action: String!
    "操作種別の表示名"
    actionLabel: String!
    "対象を取らない操作ではnull"
    targetKind: String
    targetIds: [String!]!
    reason: String
    detail: [AuditDetail!]!
  }

  "監査ログの1ページ(日時の新しい順に50件まで)"
  type AuditLogPage {
    entries: [AuditLogEntry!]!
    "続きが無ければnull"
    nextCursor: String
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

  "重要な操作の本人確認"
  input AdminReAuthenticationInput {
    "本人確認に使う現在のパスワード"
    currentPassword: String!
    secondFactor: AdminSecondFactorInput!
  }

  "監査ログの絞り込みの条件。指定した条件をすべて満たすものだけを返す"
  input AuditLogFilterInput {
    operatorId: ID
    action: String
    targetId: String
    "この日時を含む"
    occurredFrom: DateTime
    "この日時を含まない"
    occurredBefore: DateTime
  }

  type Query {
    "ログイン中の管理者。未ログイン・無効なセッションではnull"
    adminViewer: AdminViewer
    "招待中を含む全管理者を登録の新しい順に返す"
    adminAccounts: [AdminAccount!]!
    "監査ログの検索。変更・削除の操作は無い"
    auditLogs(filter: AuditLogFilterInput, after: String): AuditLogPage!
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
    "閲覧のみのロールで招待し、招待のメールを送る"
    inviteAdmin(email: String!, reason: String): AdminAccount!
    "招待中の管理者へ招待のリンクを送り直す"
    resendAdminInvitation(id: ID!, reason: String): AdminAccount!
    "管理者の削除"
    deleteAdmin(id: ID!, reason: String): Boolean!
    "ロールの変更"
    changeAdminRole(id: ID!, role: AdminRole!, reason: String): AdminAccount!
    "プロフィールの更新。avatarFileIdの省略は画像を取り除く"
    updateAdminProfile(
      id: ID!
      nickname: String!
      title: String
      avatarFileId: ID
    ): AdminAccount!
    "メールアドレス変更の要求。重複の有無を問わず同じ結果を返す"
    requestAdminEmailChange(
      newEmail: String!
      reAuthentication: AdminReAuthenticationInput!
    ): Boolean!
    "パスワードの変更。操作した端末へ新しいセッションを発行する"
    changeAdminPassword(
      "設定する新しいパスワード"
      newPassword: String!
      reAuthentication: AdminReAuthenticationInput!
    ): Boolean!
    "多要素認証の再設定の開始。完了まで現在の設定が有効なまま残る"
    startAdminTotpReset(
      reAuthentication: AdminReAuthenticationInput!
    ): AdminTotpSetup!
    "多要素認証の再設定の完了。操作した端末へ新しいセッションを発行する"
    completeAdminTotpReset(totpCode: String!): AdminRecoveryCodeSet!
    "リカバリコードの再発行。操作した端末へ新しいセッションを発行する"
    regenerateAdminRecoveryCodes(
      reAuthentication: AdminReAuthenticationInput!
    ): AdminRecoveryCodeSet!
  }
`;
