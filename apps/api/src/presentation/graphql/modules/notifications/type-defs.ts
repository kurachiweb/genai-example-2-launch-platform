export const NOTIFICATIONS_TYPE_DEFS = /* GraphQL */ `
  type Query {
    "ログイン中の利用者の通知設定。停止中も返す"
    viewerNotificationSettings: NotificationSettings!
    "配信停止のリンクの照会。ログイン不要。形式違反・照合できないトークンはnull"
    notificationUnsubscribeLink(token: String!): NotificationUnsubscribeLink
  }

  type Mutation {
    "1つの通知種別の受信可否の保存。保存の後の通知設定を返す。停止中はaccount_unavailable"
    updateNotificationPreference(
      input: UpdateNotificationPreferenceInput!
    ): NotificationSettings!
    "配信停止のリンクの確定。ログイン不要。その通知種別の受信を停止する。既に停止していても成功。照合できないトークンはinvalid_link"
    confirmNotificationUnsubscribe(token: String!): NotificationUnsubscribeLink!
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
`;
