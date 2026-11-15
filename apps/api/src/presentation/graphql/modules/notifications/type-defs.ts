export const NOTIFICATIONS_TYPE_DEFS = /* GraphQL */ `
  type Query {
    "ログイン中の利用者の通知設定。停止中も返す"
    viewerNotificationSettings: NotificationSettings!
    "配信停止のリンクの照会。ログイン不要。形式違反・照合できないトークンはnull"
    notificationUnsubscribeLink(token: String!): NotificationUnsubscribeLink
    "通知メールの送信者情報の現在の値と最後の変更。閲覧のみ以上の管理者"
    notificationSenderInfo: NotificationSenderInfoState!
  }

  type Mutation {
    "1つの通知種別の受信可否の保存。保存の後の通知設定を返す。停止中はaccount_unavailable"
    updateNotificationPreference(
      input: UpdateNotificationPreferenceInput!
    ): NotificationSettings!
    "配信停止のリンクの確定。ログイン不要。その通知種別の受信を停止する。既に停止していても成功。照合できないトークンはinvalid_link"
    confirmNotificationUnsubscribe(token: String!): NotificationUnsubscribeLink!
    "送信者情報の保存。読み取った版と一致するときだけ前後の空白を除いて保存して監査ログに記録し、保存の後の状態を返す。最上位管理者"
    updateNotificationSenderInfo(
      input: UpdateNotificationSenderInfoInput!
    ): NotificationSenderInfoState!
  }

  "通知メールの種別"
  enum NotificationTopic {
    "マッチ開始予告"
    MATCH_PREVIEW
    "勝敗結果"
    MATCH_RESULT
    "フォロー中ユーザーのマッチ開催"
    FOLLOWED_USER_MATCH
    "フォロー中ユーザーの受賞結果"
    FOLLOWED_USER_AWARD
  }

  "メールアドレスが配信の対象から除外されている理由"
  enum DeliverySuppressionReason {
    "恒久的なバウンス"
    BOUNCE
    "苦情"
    COMPLAINT
    "受信側の拒否"
    REJECTED
  }

  "通知種別ごとの受信可否"
  type NotificationPreference {
    topic: NotificationTopic!
    enabled: Boolean!
  }

  "配信の対象からの除外"
  type DeliverySuppression {
    reason: DeliverySuppressionReason!
    "受信側の拒否による期限付きの除外の終了。期限なしはnull"
    until: DateTime
  }

  "ログイン中の利用者の通知設定"
  type NotificationSettings {
    "4つの通知種別の受信可否。種別の順は決まっている"
    preferences: [NotificationPreference!]!
    "除外されていない・配信の状態を確認できなければnull"
    suppression: DeliverySuppression
    "配信の状態を確認できたか"
    deliveryStatusAvailable: Boolean!
    "メールアドレスが確認済みか"
    emailVerified: Boolean!
    "受信可否を変更できるか。停止中は偽"
    editable: Boolean!
  }

  "配信停止のリンクの対象"
  type NotificationUnsubscribeLink {
    topic: NotificationTopic!
    "その通知種別を受信する設定か。確定の後は偽"
    enabled: Boolean!
  }

  "受信可否の変更の入力"
  input UpdateNotificationPreferenceInput {
    topic: NotificationTopic!
    enabled: Boolean!
  }

  "全てのメールの末尾に載せる送信者情報"
  type NotificationSenderInfo {
    "事業者名"
    businessName: String!
    "連絡先メールアドレス"
    contactEmail: String!
    "物理的郵送先住所"
    postalAddress: String!
  }

  "送信者情報の現在の値と最後の変更"
  type NotificationSenderInfoState {
    "未設定はnull"
    info: NotificationSenderInfo
    "保存のたびに1つ進む版。未設定は0。保存の入力にそのまま渡す"
    version: Int!
    "最後に保存した日時。未設定はnull"
    updatedAt: DateTime
    "最後に保存した管理者のニックネーム。未設定・削除済み・招待中の管理者はnull"
    updatedByNickname: String
  }

  "送信者情報の保存の入力"
  input UpdateNotificationSenderInfoInput {
    businessName: String!
    contactEmail: String!
    postalAddress: String!
    "照会で読み取った版。最新と一致しなければversion_conflict"
    expectedVersion: Int!
    "監査ログに残す理由(任意)"
    reason: String
  }
`;
