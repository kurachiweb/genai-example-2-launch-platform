export const PRODUCT_TYPE_DEFS = /* GraphQL */ `
  "ローンチの状態。照会の時点の時刻から導く"
  enum LaunchStatus {
    SCHEDULED
    PAIRED
    IN_PROGRESS
    FINISHED
    CANCELED
  }

  enum QualifierOutcome {
    WON
    LOST
  }

  "ローンチ日を選べない理由"
  enum LaunchDateUnavailableReason {
    PAIRING_DEADLINE
    RELAUNCH_INTERVAL
    OUT_OF_RANGE
  }

  "次回のローンチの計画。NEWは新しいローンチの予約、RESCHEDULEは予定のローンチの日の変更、BLOCKEDは予約できない、UNKNOWNは判定できない"
  enum LaunchPlanMode {
    NEW
    RESCHEDULE
    BLOCKED
    UNKNOWN
  }

  type ProductCategory {
    id: ID!
    name: String!
    handle: String!
    "標準カテゴリ「その他」なら真。変更・削除できない"
    systemDefault: Boolean!
  }

  "ローンチの要約の表示"
  type LaunchSummary {
    label: String!
    "トップページで予選マッチを見られる"
    inMatch: Boolean!
  }

  type ProductLaunch {
    id: ID!
    "取消を除いて古い順に1から数える。取消は0"
    number: Int!
    "業務日付(YYYY-MM-DD)"
    launchDate: String!
    kickoffAt: DateTime!
    status: LaunchStatus!
    outcome: QualifierOutcome
    summary: LaunchSummary!
  }

  "選べない日の範囲(両端を含む業務日付)"
  type LaunchDateRange {
    from: String!
    to: String!
    reason: LaunchDateUnavailableReason!
  }

  "選べるローンチ日。earliestからlatestまでのうちunavailableの範囲を除く日を選べる"
  type LaunchDateWindow {
    earliest: String!
    latest: String!
    unavailable: [LaunchDateRange!]!
    "敗北後の間隔で最も早い日が後ろへずれるときの間隔の日数。それ以外はnull"
    relaunchIntervalDays: Int
  }

  "次回の予約ができない理由"
  type RelaunchBlockView {
    code: String!
    message: String!
    "解除の日時。分からなければnull"
    releaseAt: DateTime
  }

  "ローンチ日・カテゴリの変更と削除の固定の理由"
  type ProductLockView {
    code: String!
    message: String!
  }

  type ProductLaunchPlan {
    mode: LaunchPlanMode!
    "RESCHEDULEのときの予定のローンチ日"
    currentLaunchDate: String
    "NEW・RESCHEDULEのときの選べる日"
    window: LaunchDateWindow
    "BLOCKEDのときの理由"
    blocks: [RelaunchBlockView!]!
    locked: Boolean!
    locks: [ProductLockView!]!
    "固定の判定ができない。ローンチ日・カテゴリの変更と削除を受け付けない"
    lockUnknown: Boolean!
    "敗北後の間隔をUltrasの加入で短くしている"
    ultrasEntitled: Boolean!
  }

  type ProductScreenshot {
    fileId: ID!
    "画像の記録が無ければnull。隔離中の画像は枠だけを返し、objectKeyが空になる"
    image: MediaImage
  }

  "自分のプロダクトの編集用の情報"
  type MyProduct {
    handle: String!
    "保持中の旧ハンドル。無ければnull"
    previousHandle: String
    name: String!
    tagline: String!
    category: ProductCategory!
    websiteUrl: String!
    "マークダウンの説明文"
    description: String!
    logoFileId: ID!
    "画像の記録が無ければnull。隔離中の画像は枠だけを返し、objectKeyが空になる"
    logo: MediaImage
    "表示順"
    screenshots: [ProductScreenshot!]!
    "非公開化中"
    hidden: Boolean!
    "掲載済み(可視かつ予選で勝利したローンチがある)"
    listed: Boolean!
    "編集の競合の検出に使う版"
    version: Int!
    "取消を除く直近のローンチ"
    latestLaunch: ProductLaunch
    plan: ProductLaunchPlan!
  }

  "自分のプロダクトの旧ハンドルでの照会。handleは転送先の現在のハンドル"
  type MyProductRedirect {
    handle: String!
  }

  union MyProductResult = MyProduct | MyProductRedirect

  type MyProductConnection {
    nodes: [MyProduct!]!
    pageInfo: PageInfo!
  }

  "プロダクト詳細ページの投稿者本人向けの操作の状態"
  type ProductOwnerStatus {
    "取消を除く直近のローンチ"
    latestLaunch: ProductLaunch
    plan: ProductLaunchPlan!
  }

  "プロダクトの登録・編集で全件を送る項目"
  input ProductFieldsInput {
    "前後の空白を除いて1〜50文字"
    name: String!
    "前後の空白を除いて1〜100文字"
    tagline: String!
    categoryId: ID!
    handle: String!
    "httpかhttpsの2,048文字以内の絶対URL"
    websiteUrl: String!
    "マークダウンの説明文(1〜20,000文字)"
    description: String!
    "本人がアップロードしたロゴの画像"
    logoFileId: ID!
    "表示順。0〜20件で重複なし"
    screenshotFileIds: [ID!]!
  }

  input RegisterProductInput {
    fields: ProductFieldsInput!
    "最初のローンチのローンチ日(YYYY-MM-DD)"
    launchDate: String!
  }

  input UpdateProductInput {
    "編集画面を開いたときの現在のハンドル"
    productHandle: String!
    "編集画面を開いたときの版"
    expectedVersion: Int!
    fields: ProductFieldsInput!
    "予定のローンチの日の変更か次回のローンチの予約のローンチ日(YYYY-MM-DD)。nullはローンチを変えない"
    launchDate: String
  }

  type Mutation {
    "メールアドレスを確認済みの利用者がプロダクトと最初のローンチを登録する。bot判定の操作名はproduct_save"
    registerProduct(input: RegisterProductInput!): MyProduct!
    "停止していない利用者が自分のプロダクトを保存する。bot判定の操作名はproduct_save"
    updateProduct(input: UpdateProductInput!): MyProduct!
    "停止していない利用者が自分のプロダクトを論理削除する。bot判定の操作名はproduct_delete"
    deleteProduct(productHandle: String!, expectedVersion: Int!): Boolean!
  }

  type Query {
    "ログイン中の利用者(停止中を含む)の論理削除していないプロダクトを最新のローンチ日の新しい順に返す。firstは1〜20"
    myProducts(first: Int!, after: String): MyProductConnection!
    "他人・論理削除済み・不在はnull(404)。自分のプロダクトの旧ハンドルは転送先を返す"
    myProduct(handle: String!): MyProductResult
    "登録画面で選べるローンチ日"
    newProductLaunchWindow: LaunchDateWindow!
    "プロダクトのハンドルの使用可否。productHandleは編集中のプロダクトの現在のハンドルで、その現在と保持中の旧ハンドルは使えるものとして扱う"
    productHandleAvailability(
      handle: String!
      productHandle: String
    ): HandleAvailability!
    "現在のハンドルで本人のプロダクトだけ。それ以外はnull"
    productOwnerStatus(productHandle: String!): ProductOwnerStatus
  }
`;
