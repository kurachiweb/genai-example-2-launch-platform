export const SPONSORSHIP_TYPE_DEFS = /* GraphQL */ `
  "スポンサー広告のティア"
  enum SponsorshipTier {
    LEGEND
    GOLD
    SILVER
  }

  "掲載状況。PAUSEDはプロダクトの非公開化か投稿者の停止による表示停止中"
  enum SponsorshipStatus {
    PENDING_PAYMENT
    SCHEDULED
    ACTIVE
    PAUSED
    ENDED
    TERMINATED
  }

  "ティアごとの1日あたりの税込の価格"
  type SponsorshipTierOffer {
    tier: SponsorshipTier!
    "決済サービスから取得できなければnull"
    unitPrice: Money
  }

  "申込の対象のプロダクト"
  type SponsorableProduct {
    id: ID!
    handle: String!
    name: String!
    logo: MediaImage
  }

  "料金ページのスポンサー広告の区画"
  type SponsorshipOffer {
    "Legend・Gold・Silverの順"
    tiers: [SponsorshipTierOffer!]!
    "閲覧者の申込の対象のプロダクトの名称の順。未ログインはnull"
    eligibleProducts: [SponsorableProduct!]
  }

  "選べない理由。範囲の外の日の理由(今日より前・365日後より後・開始日より前・366日を超える)は画面が範囲の種類から決める"
  enum SponsorshipDateUnavailableReason {
    OVERLAP
  }

  "選べない日の範囲(両端を含む業務日付のYYYY-MM-DD)"
  type SponsorshipDateRange {
    from: String!
    to: String!
    reason: SponsorshipDateUnavailableReason!
  }

  "選べる業務日付。earliestからlatestまでのうちunavailableの範囲を除く日を選べる"
  type SponsorshipDateWindow {
    earliest: String!
    latest: String!
    unavailable: [SponsorshipDateRange!]!
  }

  "掲載期間の選べる範囲"
  type SponsorshipPeriodWindow {
    "業務日付の今日(YYYY-MM-DD)"
    businessToday: String!
    "次の基準時刻の0:00。画面はこの時点で取り直す"
    nextDayStartsAt: DateTime!
    "開始日の選べる範囲"
    start: SponsorshipDateWindow!
    "終了日の選べる範囲。startsOnを渡さない、またはstartsOnが選べない日ならnull"
    end: SponsorshipDateWindow
  }

  "広告スペースに表示する広告"
  type SponsoredAd {
    "申込のID"
    id: ID!
    tier: SponsorshipTier!
    productName: String!
    "Silverはnull"
    tagline: String
    logo: MediaImage
    "外部WebサイトURL。検証を通らなければnull"
    websiteUrl: String
  }

  "ティアごとの広告。同じティアの中は照会ごとに無作為の順"
  type SponsoredPlacements {
    legend: [SponsoredAd!]!
    gold: [SponsoredAd!]!
    silver: [SponsoredAd!]!
  }

  "自分の広告の対象のプロダクト"
  type SponsorshipProduct {
    handle: String!
    name: String!
    logo: MediaImage
    "プロダクトのページを表示できる"
    listed: Boolean!
  }

  "依頼した返金の状態。REQUESTEDは依頼済み、ALREADY_REFUNDEDは返金できる残りが無く返金済み、REJECTEDは拒否"
  enum SponsorshipRefundStatus {
    REQUESTED
    ALREADY_REFUNDED
    REJECTED
  }

  "日割りで依頼した返金"
  type SponsorshipRefund {
    days: Int!
    "依頼した額。残りの全額で依頼したときはnull"
    amount: Money
    status: SponsorshipRefundStatus!
  }

  "自分の広告一覧の1件"
  type MySponsorship {
    id: ID!
    "論理削除済みのプロダクトはnull"
    product: SponsorshipProduct
    tier: SponsorshipTier!
    "掲載開始日(業務日付のYYYY-MM-DD)"
    startsOn: String!
    "掲載終了日(業務日付のYYYY-MM-DD)"
    endsOn: String!
    "開始日と終了日を含む日数"
    days: Int!
    "支払った金額。未決済はnull"
    amountPaid: Money
    status: SponsorshipStatus!
    "強制終了日(業務日付のYYYY-MM-DD)。強制終了していなければnull"
    terminatedOn: String
    terminationReason: String
    "強制終了の未掲載日数分の返金。無ければnull"
    terminationRefund: SponsorshipRefund
    "表示停止の日数分の返金。精算前・無ければnull"
    displayStopRefund: SponsorshipRefund
    "未決済で開始日が今日以降なら真。決済を再開できる"
    canResume: Boolean!
    createdAt: DateTime!
  }

  "自分の広告一覧"
  type MySponsorshipConnection {
    nodes: [MySponsorship!]!
    pageInfo: PageInfo!
    "次の基準時刻の0:00。掲載予定から掲載中・掲載中から終了への切り替わりで取り直す"
    nextDayStartsAt: DateTime!
  }

  "スポンサー広告の申込"
  input ApplySponsorshipInput {
    productId: ID!
    tier: SponsorshipTier!
    "掲載開始日(業務日付のYYYY-MM-DD)"
    startsOn: String!
    "掲載終了日(業務日付のYYYY-MM-DD)"
    endsOn: String!
  }

  "管理画面の一覧の掲載状況の絞り込み。表示停止中は掲載予定・掲載中に含む"
  enum AdminSponsorshipStatusFilter {
    PENDING_PAYMENT
    SCHEDULED
    ACTIVE
    ENDED
    TERMINATED
  }

  "管理画面の一覧の絞り込み。省略した条件は絞り込まない"
  input AdminSponsorshipFilter {
    status: AdminSponsorshipStatusFilter
    tier: SponsorshipTier
  }

  "管理画面の申込の一覧の1件"
  type AdminSponsorship {
    id: ID!
    "論理削除済みのプロダクトはnull"
    productName: String
    "論理削除済みのプロダクトはnull"
    productHandle: String
    productDeleted: Boolean!
    "申込者のニックネーム。照会できなければnull"
    applicantNickname: String
    tier: SponsorshipTier!
    "掲載開始日(業務日付のYYYY-MM-DD)"
    startsOn: String!
    "掲載終了日(業務日付のYYYY-MM-DD)"
    endsOn: String!
    days: Int!
    "支払った金額。未決済はnull"
    amountPaid: Money
    status: SponsorshipStatus!
    "掲載予定・掲載中(表示停止中を含む)なら真"
    terminable: Boolean!
    "決済を探すための購入のID。未決済はnull"
    purchaseId: ID
    createdAt: DateTime!
  }

  "管理画面の申込の一覧"
  type AdminSponsorshipConnection {
    nodes: [AdminSponsorship!]!
    pageInfo: PageInfo!
  }

  "強制終了の確認に示す日数と金額"
  type SponsorshipTerminationPreview {
    "申込のID"
    id: ID!
    "掲載期間の日数"
    days: Int!
    amountPaid: Money!
    "強制終了日と掲載開始日の遅い方から掲載終了日までの日数"
    unexposedDays: Int!
    "未掲載日数分の返金目安額"
    refundEstimate: Money!
    "強制終了日より前の表示停止日数"
    stoppedDays: Int!
    "表示停止日数分の返金額"
    stopRefundAmount: Money!
  }

  "強制終了の確定の結果"
  type SponsorshipTerminationResult {
    "申込のID"
    id: ID!
    "強制終了日(業務日付のYYYY-MM-DD)"
    terminatedOn: String!
    days: Int!
    amountPaid: Money!
    unexposedDays: Int!
    refundEstimate: Money!
    stoppedDays: Int!
    stopRefundAmount: Money!
    "未掲載日数分の返金の状態。返金額が0ならnull"
    terminationRefundStatus: SponsorshipRefundStatus
    "表示停止日数分の返金の状態。返金額が0ならnull"
    stopRefundStatus: SponsorshipRefundStatus
    "実際に依頼した額。残りの全額で依頼したとき・依頼しなかったときはnull"
    terminationRefundRequested: Money
    "実際に依頼した額。残りの全額で依頼したとき・依頼しなかったときはnull"
    stopRefundRequested: Money
    "決済を探すための購入のID"
    purchaseId: ID!
  }

  type Query {
    "料金ページのスポンサー広告の価格と申込の対象。ログインを求めない"
    sponsorshipOffer: SponsorshipOffer!
    "申込の対象のプロダクトとティアの掲載期間の選べる範囲。対象外はsponsorship_product_ineligible、形式の違う開始日はvalidation_error"
    sponsorshipPeriodWindow(
      productId: ID!
      tier: SponsorshipTier!
      startsOn: String
    ): SponsorshipPeriodWindow!
    "掲載中の広告。ログインを求めない"
    sponsoredPlacements: SponsoredPlacements!
    "ログイン中の利用者の申込の新しい順(1〜20件)"
    mySponsorships(first: Int!, after: String): MySponsorshipConnection!
    "本人のプロダクトの掲載中・掲載予定の広告の件数。本人のプロダクトでなければ0"
    activeSponsorshipCount(productHandle: String!): Int!
    "退会者を除く申込の新しい順(1〜50件)。閲覧のみ以上の管理者"
    adminSponsorships(
      filter: AdminSponsorshipFilter
      first: Int!
      after: String
    ): AdminSponsorshipConnection!
    "強制終了の未掲載日数・返金目安額・表示停止日数・表示停止の返金額。モデレーター以上の管理者。強制終了できなければsponsorship_not_terminable"
    sponsorshipTerminationPreview(id: ID!): SponsorshipTerminationPreview!
  }

  type Mutation {
    "申込を未決済で記録し、決済を始めて決済画面の経路に使う購入のIDを返す"
    applySponsorship(input: ApplySponsorshipInput!): CheckoutStart!
    "本人の開始日前の未決済の申込の決済を始め直す"
    resumeSponsorshipCheckout(id: ID!): CheckoutStart!
    "理由(500文字以内)を付けて広告を強制終了し、未掲載日数分と表示停止日数分の返金を依頼する。モデレーター以上の管理者"
    terminateSponsorship(
      id: ID!
      reason: String!
    ): SponsorshipTerminationResult!
  }
`;
