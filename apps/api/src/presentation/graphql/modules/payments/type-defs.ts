export const PAYMENTS_TYPE_DEFS = /* GraphQL */ `
  type Query {
    "本人の購入の決済画面の表示事項。他人・存在しない購入はcheckout_not_found"
    checkout(purchaseId: ID!): Checkout!
    "ログイン中の利用者の決済履歴(既定20件・1〜50件、発生時刻の新しい順)"
    paymentHistory(first: Int, after: String): PaymentRecordConnection!
  }

  type Mutation {
    "支払いの確定の前の同意の記録。支払える状態の本人の購入だけに記録し、同じ購入の再記録は最新の日時で上書きする"
    recordCheckoutConsent(purchaseId: ID!): Checkout!
    "決済後のランディングでの決済セッションの確認と反映。Stripeに到達できなければ未完了の購入を処理中として返す"
    confirmCheckoutReturn(sessionId: String!): CheckoutReturnResult!
    "疎通確認用の決済の開始。疎通確認を有効にした環境だけで受け付ける"
    startSmokeCheckout: CheckoutStart!
  }

  "購入種別"
  enum PurchaseKind {
    WEEK_TOURNAMENT_ENTRY
    YEAR_TOURNAMENT_ENTRY
    SPONSORSHIP
    ULTRAS
    PAYMENTS_SMOKE
  }

  "決済画面に示す購入の状態"
  enum CheckoutStatus {
    "支払える"
    OPEN
    "支払いの確認中"
    PROCESSING
    "完了"
    COMPLETED
    "権利を付与できず全額返金を依頼した"
    REFUNDING
    "失効"
    EXPIRED
    "Stripeに到達できず支払いの準備ができない"
    UNAVAILABLE
  }

  "権利を付与できなかった理由"
  enum CheckoutRejectionReason {
    "受付期限の後の支払い"
    LATE
    "購入の条件を満たさない"
    INELIGIBLE
    "同じ対象の二重の支払い"
    DUPLICATE
  }

  "金額"
  type Money {
    "最小通貨単位の整数"
    amount: Int!
    "ISO 4217の小文字の通貨コード"
    currency: String!
  }

  "決済の開始の結果。決済を始める変更操作が返す"
  type CheckoutStart {
    "決済画面の経路に使う購入のID"
    purchaseId: ID!
  }

  "最終確認画面の表示事項"
  type CheckoutSummary {
    itemName: String!
    quantityLabel: String!
    serviceTiming: String!
    additionalNotes: [String!]!
    isSubscription: Boolean!
  }

  "決済画面と決済後のランディングが表示する購入"
  type Checkout {
    purchaseId: ID!
    kind: PurchaseKind!
    status: CheckoutStatus!
    "状態がREFUNDINGのときだけ値がある"
    rejectionReason: CheckoutRejectionReason
    "状態がOPENのときだけ値がある"
    clientSecret: String
    unitPrice: Money!
    quantity: Int!
    total: Money!
    summary: CheckoutSummary!
    "受付期限。期限の無い購入はnull"
    acceptUntil: DateTime
    "決済セッションの有効期限"
    expiresAt: DateTime!
    "決済画面が表示する同意の文言の版"
    consentVersion: String!
    "失効した購入を受付期限の前にやり直せるなら真"
    canRestart: Boolean!
  }

  "決済後のランディングの確認の結果"
  type CheckoutReturnResult {
    checkout: Checkout!
  }

  "決済履歴の種類"
  enum PaymentRecordKind {
    ONE_TIME
    SUBSCRIPTION
    REFUND
    DISPUTE
  }

  "決済履歴の状態"
  enum PaymentRecordStatus {
    SUCCEEDED
    FAILED
    PENDING
    DISPUTED
    DISPUTE_WON
    DISPUTE_LOST
  }

  "決済履歴の1件"
  type PaymentRecord {
    id: ID!
    kind: PaymentRecordKind!
    purpose: PurchaseKind!
    "返金・チャージバックの引き落としは負"
    amount: Money!
    "数量の無い記録はnull"
    quantity: Int
    status: PaymentRecordStatus!
    occurredAt: DateTime!
  }

  "決済履歴の一覧"
  type PaymentRecordConnection {
    nodes: [PaymentRecord!]!
    pageInfo: PageInfo!
  }
`;
