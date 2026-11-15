export const NOTIFICATION_SETTINGS_PAGE_TITLE = '通知';

export const NOTIFICATION_SETTINGS_SECTION_TITLE = '通知メール';

export const NOTIFICATION_SETTINGS_SECTION_DESCRIPTION =
  '受け取る通知メールを種類ごとに選べます。初期設定ではすべて受け取らない設定です。';

export const NOTIFICATION_PREFERENCE_SAVED_MESSAGE = '通知設定を保存しました。';

export const SUPPRESSION_MESSAGES: Readonly<
  Record<'BOUNCE' | 'COMPLAINT', string>
> = Object.freeze({
  BOUNCE:
    'このメールアドレスに配信できなかったため、通知メールを停止しています。メールアドレスを変更すると再開できます。',
  COMPLAINT:
    '迷惑メールとして報告されたため、通知メールを停止しています。メールアドレスを変更すると再開できます。',
});

// 期限の日時を<time>の要素で描くため、日時の前後の文に分ける
export const REJECTED_SUPPRESSION_MESSAGE_PARTS = Object.freeze({
  beforeUntil: '受信側で拒否されたため、',
  afterUntil: 'まで通知メールを停止しています。',
});

export const CHANGE_EMAIL_LINK_LABEL = 'メールアドレスを変更する';

export const DELIVERY_STATUS_UNAVAILABLE_MESSAGE =
  '配信の状態を確認できませんでした。';

export const EMAIL_UNVERIFIED_NOTICE =
  'メールアドレスの確認が完了するまで、通知メールは届きません。';

export const SUSPENDED_NOTIFICATION_SETTINGS_NOTICE =
  'このアカウントは停止されているため、通知設定を変更できません。';

export const UNSUBSCRIBE_PAGE_TITLE = '配信停止';

export const UNSUBSCRIBE_SUBMIT_LABEL = '配信を停止する';

export const OPEN_NOTIFICATION_SETTINGS_LABEL = '通知設定を開く';

export const INVALID_UNSUBSCRIBE_LINK_MESSAGE =
  'このリンクは無効です。通知メールの受信は通知設定から変更できます。';

export const UNSUBSCRIBE_FAILED_MESSAGE =
  '配信を停止できませんでした。時間をおいて再度お試しください。';

export const unsubscribeQuestion = (topicLabel: string): string =>
  `「${topicLabel}」の通知メールの配信を停止しますか?`;

export const unsubscribedMessage = (topicLabel: string): string =>
  `「${topicLabel}」の通知メールの配信を停止しました。通知設定からいつでも再開できます。`;

export const alreadyUnsubscribedMessage = (topicLabel: string): string =>
  `「${topicLabel}」の通知メールは既に配信を停止しています。`;
