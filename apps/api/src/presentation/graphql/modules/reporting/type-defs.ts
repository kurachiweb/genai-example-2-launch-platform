export const REPORTING_TYPE_DEFS = /* GraphQL */ `
  "通報の対象の種類"
  enum ReportTargetKind {
    USER
    PRODUCT
    COMMENT
  }

  "通報の案件の対応ステータス"
  enum ReportCaseStatus {
    OPEN
    IN_PROGRESS
    RESOLVED
    REJECTED
  }

  "対応済の案件の措置。NONEは措置なしの対応済"
  enum ReportResolution {
    PRODUCT_HIDE
    COMMENT_HIDE
    USER_SUSPEND
    NONE
  }

  "権利侵害の案件の対応期間の目標の超過"
  enum ResponseTimeAlert {
    START_OVERDUE
    DECISION_OVERDUE
  }

  "通報のフォームで選べるカテゴリ"
  type ReportCategory {
    id: ID!
    name: String!
    "権利侵害のカテゴリ。未ログインと停止中の利用者には連絡先メールアドレスを求める"
    infringement: Boolean!
  }

  "通報の入力"
  input SubmitReportInput {
    targetKind: ReportTargetKind!
    "ユーザーはハンドル、プロダクトとコメントはID"
    targetRef: String!
    categoryId: ID!
    reason: String!
    "未ログインと停止中の利用者の権利侵害の通報だけで使い、他では捨てる"
    contactEmail: String
  }

  "通報の受け付けの結果"
  type SubmitReportPayload {
    accepted: Boolean!
  }

  "管理画面の通報カテゴリ"
  type AdminReportCategory {
    id: ID!
    name: String!
    systemDefault: Boolean!
    infringement: Boolean!
    "紐付く通報の件数。退会で論理削除した通報を含む"
    reportCount: Int!
  }

  "管理画面の通報の対象"
  type AdminReportTarget {
    kind: ReportTargetKind!
    "対象への参照を消した案件はnull"
    id: ID
    detached: Boolean!
    "退会・削除・物理削除で読めない対象と、対象への参照を消した案件はfalse"
    available: Boolean!
    handle: String
    "ユーザーはニックネーム、プロダクトは名称"
    label: String
    "コメントの本文の抜粋"
    excerpt: String
    productId: ID
    productName: String
    productHandle: String
  }

  "案件のカテゴリごとの通報の件数"
  type AdminReportCategoryCount {
    categoryId: ID!
    "カテゴリの現在の名前"
    name: String!
    count: Int!
  }

  "権利侵害の案件の対応期間"
  type AdminReportResponseTime {
    startedAt: DateTime!
    completedAt: DateTime
    "完了の日時が得られない完了した案件はnull"
    elapsedSeconds: Int
    alerts: [ResponseTimeAlert!]!
  }

  "通報の案件"
  type AdminReportCase {
    id: ID!
    target: AdminReportTarget!
    status: ReportCaseStatus!
    "退会で論理削除した通報を除く件数"
    reportCount: Int!
    categoryCounts: [AdminReportCategoryCount!]!
    firstReportedAt: DateTime!
    lastReportedAt: DateTime!
    infringement: Boolean!
    "権利侵害の案件だけ"
    responseTime: AdminReportResponseTime
  }

  "通報の案件の一覧"
  type AdminReportCaseConnection {
    nodes: [AdminReportCase!]!
    pageInfo: PageInfo!
  }

  "通報の申出者。kindはmember(ログイン中の利用者)かguest(未ログインと停止中の利用者)"
  type AdminReporter {
    kind: String!
    nickname: String
    handle: String
    "連絡先メールアドレスは返さず、有無だけを返す"
    hasContact: Boolean!
  }

  "案件の通報"
  type AdminReport {
    id: ID!
    "カテゴリの現在の名前"
    categoryName: String!
    reason: String!
    reportedAt: DateTime!
    reporter: AdminReporter!
  }

  "最後に送った権利侵害の照会"
  type AdminReportInquiry {
    sentAt: DateTime!
    message: String!
    deadline: DateTime!
    "対応中で回答の期限を過ぎていれば真"
    overdue: Boolean!
  }

  "通報の案件の詳細"
  type AdminReportCaseDetail {
    case: AdminReportCase!
    statusChangedAt: DateTime!
    resolution: ReportResolution
    closingReason: String
    closedAt: DateTime
    lastInquiry: AdminReportInquiry
    "権利侵害の対応中の案件で、投稿者の宛先と利用者側のURLがあれば真"
    inquiryAvailable: Boolean!
    "受付日時の昇順"
    reports: [AdminReport!]!
  }

  "未対応の案件の件数"
  type AdminUnhandledReportSummary {
    open: Int!
    infringementOpen: Int!
  }

  "プロダクトの未完了の案件"
  type AdminOpenReportCaseRef {
    id: ID!
    status: ReportCaseStatus!
  }

  "プロダクトへの通報の件数と未完了の案件"
  type AdminProductReportSummary {
    reportCount: Int!
    openCase: AdminOpenReportCaseRef
  }

  "案件の操作の結果"
  type ReportCaseOutcome {
    status: ReportCaseStatus!
  }

  "権利侵害の照会の結果"
  type InfringementInquiryOutcome {
    sentAt: DateTime!
    deadline: DateTime!
  }

  "通報カテゴリの削除の結果"
  type ReportCategoryDeletion {
    "「その他」へ付け替えた通報の件数"
    reassignedCount: Int!
  }

  "通報の案件の一覧の絞り込み"
  input AdminReportCaseFilter {
    status: ReportCaseStatus
    targetKind: ReportTargetKind
    "そのカテゴリの通報を含む案件"
    categoryId: ID
    "その期間に受け付けた通報を含む案件。開始は含み、終了は含まない"
    reportedFrom: DateTime
    reportedBefore: DateTime
  }

  type Query {
    "通報のフォームで選べるカテゴリ"
    reportCategories: [ReportCategory!]!
    "通報の案件の一覧。最後の受付日時の新しい順"
    adminReportCases(
      filter: AdminReportCaseFilter
      first: Int!
      after: String
    ): AdminReportCaseConnection!
    "通報の案件の詳細。無ければnull"
    adminReportCase(id: ID!): AdminReportCaseDetail
    "未対応の案件の件数"
    adminUnhandledReportSummary: AdminUnhandledReportSummary!
    "プロダクトへの通報の件数と未完了の案件"
    adminProductReportSummary(productId: ID!): AdminProductReportSummary!
    "管理画面の通報カテゴリ"
    adminReportCategories: [AdminReportCategory!]!
  }

  type Mutation {
    "ユーザー・プロダクト・コメントの通報"
    submitReport(input: SubmitReportInput!): SubmitReportPayload!
    "案件の対応ステータスの手での変更"
    changeReportCaseStatus(
      id: ID!
      from: ReportCaseStatus!
      to: ReportCaseStatus!
      reason: String
    ): ReportCaseOutcome!
    "措置による対応済"
    resolveReportCaseWithMeasure(id: ID!, reason: String!): ReportCaseOutcome!
    "措置なしの対応済"
    resolveReportCaseWithoutMeasure(
      id: ID!
      reason: String!
    ): ReportCaseOutcome!
    "案件の却下"
    rejectReportCase(id: ID!, reason: String!): ReportCaseOutcome!
    "権利侵害の案件の投稿者への照会"
    sendInfringementInquiry(
      id: ID!
      message: String!
      reason: String
    ): InfringementInquiryOutcome!
    "通報カテゴリの追加"
    createReportCategory(name: String!, reason: String): AdminReportCategory!
    "通報カテゴリの名前の変更"
    renameReportCategory(
      id: ID!
      name: String!
      reason: String
    ): AdminReportCategory!
    "通報カテゴリの削除。紐付く通報は「その他」へ付け替える"
    deleteReportCategory(id: ID!, reason: String): ReportCategoryDeletion!
  }
`;
