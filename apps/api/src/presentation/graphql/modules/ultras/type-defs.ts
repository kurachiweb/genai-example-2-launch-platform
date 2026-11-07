export const ULTRAS_TYPE_DEFS = /* GraphQL */ `
  type Query {
    "Ultrasの月額の価格と新規の加入の受付の状態。ログイン不要"
    ultrasOffer: UltrasOffer!
    "ログイン中の利用者のUltrasの加入状態と特典の有無。未ログインはnull"
    viewerUltras: ViewerUltras
    "有料プラン導線の機能フラグの現在の値と最後の変更。閲覧のみ以上の管理者"
    ultrasPromotionSetting: UltrasPromotionSetting!
  }

  type Mutation {
    "Ultrasの加入の開始。加入できるかを確かめて購入を作り、決済画面の経路に使う購入のIDを返す"
    startUltrasCheckout: CheckoutStart!
    "Customer Portalのセッションの作成。加入したことがある本人のStripe Customerにセッションを作り、移動先のURLを返す。戻り先はプラン管理画面"
    createUltrasPortalSession: UltrasPortalSession!
    "機能フラグの変更。読み取った版と一致するときだけ保存して監査ログに記録し、変更後の設定を返す。最上位管理者"
    updateUltrasPromotionSetting(
      input: UpdateUltrasPromotionSettingInput!
    ): UltrasPromotionSetting!
  }

  "Ultrasの加入状態"
  enum UltrasPlanStatus {
    "有効"
    ACTIVE
    "支払いの再試行中"
    PAST_DUE
    "解約済み(特典の終了日時まで特典が続く)"
    CANCELED
    "終了"
    ENDED
  }

  "料金ページが表示するUltrasの料金と受付の状態"
  type UltrasOffer {
    "新規の加入を受け付けているか(有料プラン導線の機能フラグ)"
    promotionEnabled: Boolean!
    "月額の価格(税込のUSD)。照会できなければnull"
    price: Money
    "Stripeに到達できず、以前に照会した価格を返したときに真"
    priceStale: Boolean!
  }

  "利用者の最新の有効化された加入"
  type UltrasPlan {
    status: UltrasPlanStatus!
    "加入の開始日時"
    startedAt: DateTime!
    "次回の更新日時(課金期間の終了日時)"
    currentPeriodEndsAt: DateTime
    "特典の終了日時。右に開いていればnull"
    benefitEndsAt: DateTime
    "解約の操作の日時"
    canceledAt: DateTime
  }

  "ログイン中の利用者のUltrasの加入状態"
  type ViewerUltras {
    "加入したことが無ければnull"
    plan: UltrasPlan
    "現在、特典を受けられるか"
    entitled: Boolean!
    "Customer Portalを開けるか(加入したことがあれば真)"
    canOpenPortal: Boolean!
  }

  "Customer Portalへ移動するためのセッション"
  type UltrasPortalSession {
    "Customer PortalのURL。作成の直後に移動に使う"
    url: String!
  }

  "有料プラン導線の機能フラグ"
  type UltrasPromotionSetting {
    "未加入者に導線を表示し、新規の加入を受け付けるか"
    enabled: Boolean!
    "変更のたびに1つ進む版。変更の入力にそのまま渡す"
    version: Int!
    "最後に変更した日時"
    updatedAt: DateTime
    "最後に変更した管理者のニックネーム。管理者の変更が無い・削除済みはnull"
    updatedByNickname: String
  }

  "機能フラグの変更の入力"
  input UpdateUltrasPromotionSettingInput {
    enabled: Boolean!
    "照会で読み取った版。最新と一致しなければversion_conflict"
    expectedVersion: Int!
    "監査ログに残す理由(任意)"
    reason: String
  }
`;
