import type { GraphQLResult } from '../lib/utilities/graphql/graphql-result.ts';
import type {
  ClientUpdateNotificationPreferenceMutation,
  ClientViewerNotificationSettingsQuery,
  NotificationSettingsFragment,
  NotificationTopic,
} from '../src/graphql/generated/graphql.ts';

export const NOTIFICATION_TOPIC_LABELS = Object.freeze([
  'マッチ開始予告',
  '勝敗結果',
  'フォロー中ユーザーのマッチ開催',
  'フォロー中ユーザーの受賞結果',
] as const);

export const SECTION_DESCRIPTION =
  '受け取る通知メールを種類ごとに選べます。初期設定ではすべて受け取らない設定です。';

export const SAVED_MESSAGE = '通知設定を保存しました。';

export const BOUNCE_MESSAGE =
  'このメールアドレスに配信できなかったため、通知メールを停止しています。メールアドレスを変更すると再開できます。';

export const COMPLAINT_MESSAGE =
  '迷惑メールとして報告されたため、通知メールを停止しています。メールアドレスを変更すると再開できます。';

export const DELIVERY_STATUS_UNAVAILABLE = '配信の状態を確認できませんでした。';

export const EMAIL_UNVERIFIED =
  'メールアドレスの確認が完了するまで、通知メールは届きません。';

export const SUSPENDED_NOTICE =
  'このアカウントは停止されているため、通知設定を変更できません。';

export const CHANGE_EMAIL_LINK = 'メールアドレスを変更する';

export const REJECTED_UNTIL = '2026-11-20T03:00:00.000Z';

export const REJECTED_MESSAGE_PATTERN =
  /^受信側で拒否されたため、.+まで通知メールを停止しています。$/;

const TOPIC_ORDER: readonly NotificationTopic[] = Object.freeze([
  'MATCH_PREVIEW',
  'MATCH_RESULT',
  'FOLLOWED_USER_MATCH',
  'FOLLOWED_USER_AWARD',
]);

export const notificationSettings = (
  overrides: Partial<NotificationSettingsFragment> & {
    readonly enabledTopics?: readonly NotificationTopic[];
  } = {},
): NotificationSettingsFragment => {
  const { enabledTopics = [], ...rest } = overrides;
  return {
    preferences: TOPIC_ORDER.map((topic) => ({
      topic,
      enabled: enabledTopics.includes(topic),
    })),
    suppression: null,
    deliveryStatusAvailable: true,
    emailVerified: true,
    editable: true,
    ...rest,
  };
};

export const viewerNotificationSettingsResult = (
  settings: NotificationSettingsFragment = notificationSettings(),
): GraphQLResult<ClientViewerNotificationSettingsQuery> => ({
  ok: true,
  data: { viewerNotificationSettings: settings },
});

export const updatedNotificationSettingsResult = (
  settings: NotificationSettingsFragment,
): GraphQLResult<ClientUpdateNotificationPreferenceMutation> => ({
  ok: true,
  data: { updateNotificationPreference: settings },
});
