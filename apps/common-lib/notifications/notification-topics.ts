export const NOTIFICATION_TOPICS = Object.freeze([
  'match_preview',
  'match_result',
  'followed_user_match',
  'followed_user_award',
] as const);

export type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number];

export interface NotificationTopicCopy {
  readonly label: string;
  readonly description: string;
}

export const NOTIFICATION_TOPIC_COPY: Readonly<
  Record<NotificationTopic, NotificationTopicCopy>
> = Object.freeze({
  match_preview: Object.freeze({
    label: 'マッチ開始予告',
    description:
      '自分のプロダクトのマッチの前日の夜に、対戦相手と開始時刻をお知らせします。',
  }),
  match_result: Object.freeze({
    label: '勝敗結果',
    description:
      '自分のプロダクトのマッチの当日の夜に、結果をお知らせします。勝ち進んだ場合は翌日のマッチの予告もまとめてお送りします。',
  }),
  followed_user_match: Object.freeze({
    label: 'フォロー中ユーザーのマッチ開催',
    description:
      'フォローしているユーザーのプロダクトのマッチが始まったら、その日の分を1通にまとめてお知らせします。',
  }),
  followed_user_award: Object.freeze({
    label: 'フォロー中ユーザーの受賞結果',
    description:
      'フォローしているユーザーのプロダクトがProduct of the Week・Product of the Yearを受賞したらお知らせします。',
  }),
});
