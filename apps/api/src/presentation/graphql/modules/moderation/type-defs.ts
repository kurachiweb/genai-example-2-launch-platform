export const MODERATION_TYPE_DEFS = /* GraphQL */ `
  "管理画面の利用者の停止状態"
  enum AdminUserStatus {
    ACTIVE
    SUSPENDED
  }

  "使い捨てメールアドレスの判定結果。UNVERIFIEDはメールアドレスの確認を済ませていない利用者"
  enum DisposableEmailCheck {
    DISPOSABLE
    REGULAR
    UNDETERMINED
    UNVERIFIED
  }

  "画像の隔離理由"
  enum QuarantineReason {
    AUTO
    PRODUCT_HIDDEN
    USER_SUSPENDED
    ADMIN_ACTION
  }

  "プロダクトの最新のローンチの状態"
  enum AdminProductLaunchState {
    SCHEDULED
    IN_PROGRESS
    WON
    LOST
    CANCELED
  }

  "プロダクトの公開状態"
  enum AdminProductVisibility {
    VISIBLE
    HIDDEN
    OWNER_SUSPENDED
  }

  "管理画面のコメントの状態"
  enum AdminCommentState {
    HIDDEN
    DELETED
    ANONYMIZED
    AUTHOR_UNAVAILABLE
    SHOWN
  }

  "管理画面の評価の状態"
  enum AdminRatingState {
    VALID
    INVALIDATED
  }

  "最新の措置の理由と日時。理由は措置の記録から読み、任意の操作で理由が無ければnull"
  type ModerationNote {
    reason: String
    occurredAt: DateTime!
  }

  "管理画面で表示する画像のファイル"
  type AdminMediaFile {
    id: ID!
    "管理者側のサイトと同じオリジンの中継の経路"
    path: String!
    quarantined: Boolean!
    quarantineReasons: [QuarantineReason!]!
  }

  "管理画面の一覧に添える利用者の表示"
  type AdminUserSummary {
    id: ID!
    handle: String!
    nickname: String!
    suspended: Boolean!
  }

  "管理画面の利用者。メールアドレスは返さない"
  type AdminUser {
    id: ID!
    handle: String!
    nickname: String!
    avatar: AdminMediaFile
    registeredAt: DateTime!
    disposableEmail: DisposableEmailCheck!
    status: AdminUserStatus!
    suspendedAt: DateTime
    "停止中で、停止の措置の記録が残っている利用者だけが持つ"
    latestSuspension: ModerationNote
  }

  type AdminUserConnection {
    nodes: [AdminUser!]!
    pageInfo: PageInfo!
  }

  "管理画面のプロダクトのカテゴリ"
  type AdminCategoryRef {
    id: ID!
    name: String!
  }

  "管理画面のプロダクト"
  type AdminProduct {
    id: ID!
    handle: String!
    name: String!
    logo: AdminMediaFile
    "退会済みの投稿者はnull"
    owner: AdminUserSummary
    category: AdminCategoryRef!
    "業務日付。ローンチが無ければnull"
    latestLaunchDate: String
    latestLaunchState: AdminProductLaunchState
    visibility: AdminProductVisibility!
  }

  type AdminProductConnection {
    nodes: [AdminProduct!]!
    pageInfo: PageInfo!
  }

  "ローンチのマッチ結果"
  type AdminMatchResult {
    id: ID!
    kind: String!
    round: Int
    stage: String
    "業務日付"
    matchDate: String!
    upvoteCount: Int!
    "未確定はnull"
    result: String
    "不戦勝・表示できない相手はnull"
    opponentName: String
  }

  "プロダクトのローンチ"
  type AdminLaunch {
    id: ID!
    number: Int!
    "業務日付"
    launchDate: String!
    status: String!
    matches: [AdminMatchResult!]!
  }

  "有効な評価の平均と件数"
  type AdminRatingSummary {
    average: Float
    count: Int!
  }

  "管理画面のプロダクトの詳細"
  type AdminProductDetail {
    product: AdminProduct!
    tagline: String!
    descriptionMarkdown: String!
    websiteUrl: String!
    screenshots: [AdminMediaFile!]!
    hiddenAt: DateTime
    "非公開化中で、非公開化の措置の記録が残っているプロダクトだけが持つ"
    latestHide: ModerationNote
    ratingSummary: AdminRatingSummary!
    "ローンチ日の新しい順"
    launches: [AdminLaunch!]!
  }

  "管理画面のコメント"
  type AdminComment {
    id: ID!
    "マークダウンとして描画しない本文の先頭"
    excerpt: String!
    "匿名化・退会済みの投稿者はnull"
    author: AdminUserSummary
    "論理削除済みのプロダクトはnull"
    productName: String
    productId: ID!
    launchId: ID!
    createdAt: DateTime!
    state: AdminCommentState!
    "非公開化中で、非公開化の措置の記録が残っているコメントだけが持つ"
    latestHide: ModerationNote
  }

  type AdminCommentConnection {
    nodes: [AdminComment!]!
    pageInfo: PageInfo!
  }

  "管理画面の評価"
  type AdminRating {
    id: ID!
    "退会済みの評価者はnull"
    rater: AdminUserSummary
    "論理削除済みのプロダクトはnull"
    productName: String
    productId: ID!
    score: Int!
    createdAt: DateTime!
    updatedAt: DateTime!
    state: AdminRatingState!
    "無効化中で、無効化の措置の記録が残っている評価だけが持つ"
    latestInvalidation: ModerationNote
  }

  type AdminRatingConnection {
    nodes: [AdminRating!]!
    pageInfo: PageInfo!
  }

  "隔離画像の保有者。kindはuserかadmin"
  type AdminImageOwner {
    kind: String!
    id: ID!
    "表示名を引けない保有者はnull"
    nickname: String
    handle: String
  }

  "隔離画像"
  type AdminQuarantinedImage {
    file: AdminMediaFile!
    "画像の用途"
    purpose: String!
    "システムが保有する画像はnull"
    owner: AdminImageOwner
    quarantinedAt: DateTime!
    "自動判定の検出内容"
    findings: [String!]!
  }

  "隔離画像の一覧の1ページ。続きが無ければnextCursorはnull"
  type AdminQuarantinedImagePage {
    items: [AdminQuarantinedImage!]!
    nextCursor: String
  }

  "措置の結果。既に同じ状態ならchangedは偽"
  type ModerationOutcome {
    changed: Boolean!
  }

  "ユーザーの一覧の絞り込み。指定した条件を全て満たす利用者を返す"
  input AdminUserFilter {
    "大文字小文字を区別しない部分一致"
    handle: String
    "大文字小文字を区別しない部分一致"
    nickname: String
    "大文字小文字を区別しない完全一致"
    email: String
    status: AdminUserStatus
  }

  "プロダクトの一覧の絞り込み。指定した条件を全て満たすプロダクトを返す"
  input AdminProductFilter {
    name: String
    handle: String
    ownerHandle: String
    categoryId: ID
    launchState: AdminProductLaunchState
    visibility: AdminProductVisibility
  }

  "コメントの一覧の絞り込み。投稿日時はpostedFromを含みpostedBeforeを含まない"
  input AdminCommentFilter {
    authorHandle: String
    productHandle: String
    postedFrom: DateTime
    postedBefore: DateTime
    state: AdminCommentState
  }

  "評価の一覧の絞り込み"
  input AdminRatingFilter {
    productHandle: String
    raterHandle: String
    state: AdminRatingState
  }

  "代理の退会の入力"
  input AdministrativeWithdrawalInput {
    userId: ID!
    reason: String!
  }

  type Query {
    "退会していない利用者の一覧(登録日時の新しい順)。firstは1〜50"
    adminUsers(
      filter: AdminUserFilter
      first: Int!
      after: String
    ): AdminUserConnection!
    "論理削除されていないプロダクトの一覧(登録日時の新しい順)。firstは1〜50"
    adminProducts(
      filter: AdminProductFilter
      first: Int!
      after: String
    ): AdminProductConnection!
    "プロダクトの詳細。存在しない・論理削除済みはnull"
    adminProduct(id: ID!): AdminProductDetail
    "プロダクトの一覧の絞り込みのカテゴリの選択肢"
    adminModerationCategoryOptions: [AdminCategoryRef!]!
    "プロダクトの評価の一覧(更新日時の新しい順)。firstは1〜50"
    adminProductRatings(
      productId: ID!
      first: Int!
      after: String
    ): AdminRatingConnection!
    "コメントの一覧(投稿日時の新しい順)。firstは1〜50"
    adminComments(
      filter: AdminCommentFilter
      first: Int!
      after: String
    ): AdminCommentConnection!
    "評価の一覧(更新日時の新しい順)。firstは1〜50"
    adminRatings(
      filter: AdminRatingFilter
      first: Int!
      after: String
    ): AdminRatingConnection!
    "隔離理由ごとの隔離画像の一覧(隔離された日時の新しい順に50件ずつ)"
    adminQuarantinedImages(
      reason: QuarantineReason!
      after: String
    ): AdminQuarantinedImagePage!
  }

  type Mutation {
    "利用者の停止"
    suspendUser(id: ID!, reason: String!): ModerationOutcome!
    "利用者の停止解除"
    unsuspendUser(id: ID!, reason: String!): ModerationOutcome!
    "最上位管理者による代理の退会"
    withdrawUserByAdministrator(
      input: AdministrativeWithdrawalInput!
    ): ModerationOutcome!
    "プロダクトの非公開化"
    hideProduct(id: ID!, reason: String!): ModerationOutcome!
    "プロダクトの復元"
    unhideProduct(id: ID!, reason: String!): ModerationOutcome!
    "コメントの非公開化"
    hideComment(id: ID!, reason: String!): ModerationOutcome!
    "コメントの復元"
    unhideComment(id: ID!, reason: String!): ModerationOutcome!
    "評価の無効化"
    invalidateRating(id: ID!, reason: String!): ModerationOutcome!
    "評価の無効化の取り消し"
    revalidateRating(id: ID!, reason: String!): ModerationOutcome!
    "自動判定の隔離理由を外す公開承認"
    approveQuarantinedImage(fileId: ID!, reason: String): ModerationOutcome!
    "画像の個別の隔離"
    quarantineImage(fileId: ID!, reason: String): ModerationOutcome!
    "管理者操作の隔離理由を外す隔離の解除"
    releaseQuarantinedImage(fileId: ID!, reason: String): ModerationOutcome!
    "隔離画像の削除"
    deleteQuarantinedImage(fileId: ID!, reason: String): ModerationOutcome!
  }
`;
