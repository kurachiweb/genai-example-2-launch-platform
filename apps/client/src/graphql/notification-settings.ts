import { type QueryClient, queryOptions } from '@tanstack/react-query';

import {
  NOTIFICATION_TOPICS,
  type NotificationTopic,
} from '../../common-lib/notifications/notification-topics.ts';
import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { isInvalidLinkError } from '../../lib/utilities/auth/invalid-link.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientNotificationUnsubscribeLinkDocument,
  ClientViewerNotificationSettingsDocument,
  type NotificationSettingsFragment,
  type NotificationTopic as NotificationTopicValue,
  type NotificationUnsubscribeLinkFragment,
} from './generated/graphql.ts';

const TOPIC_VALUES: Readonly<
  Record<NotificationTopic, NotificationTopicValue>
> = Object.freeze({
  match_preview: 'MATCH_PREVIEW',
  match_result: 'MATCH_RESULT',
  followed_user_match: 'FOLLOWED_USER_MATCH',
  followed_user_award: 'FOLLOWED_USER_AWARD',
});

const TOPICS_BY_VALUE: Readonly<
  Record<NotificationTopicValue, NotificationTopic>
> = Object.freeze({
  MATCH_PREVIEW: 'match_preview',
  MATCH_RESULT: 'match_result',
  FOLLOWED_USER_MATCH: 'followed_user_match',
  FOLLOWED_USER_AWARD: 'followed_user_award',
});

// GraphQLの列挙は大文字のため、名称と説明を引く共有の通知種別へ写す
export const notificationTopicOf = (
  value: NotificationTopicValue,
): NotificationTopic => TOPICS_BY_VALUE[value];

export const notificationTopicValueOf = (
  topic: NotificationTopic,
): NotificationTopicValue => TOPIC_VALUES[topic];

export interface NotificationPreferenceView {
  readonly topic: NotificationTopic;
  readonly enabled: boolean;
}

export type DeliverySuppressionView =
  | { readonly reason: 'BOUNCE' | 'COMPLAINT' }
  | { readonly reason: 'REJECTED'; readonly until: string };

export interface NotificationSettingsView {
  readonly preferences: readonly NotificationPreferenceView[];
  // nullは除外されていないか、配信の状態を確認できなかった
  readonly suppression: DeliverySuppressionView | null;
  readonly deliveryStatusAvailable: boolean;
  readonly emailVerified: boolean;
  readonly editable: boolean;
}

// 期限の無い受信側の拒否は、先の恒久的なバウンスか苦情による除外が続いている状態のため、配信できなかった旨で示す
const toSuppressionView = (
  suppression: NotificationSettingsFragment['suppression'],
): DeliverySuppressionView | null => {
  if (suppression === null) {
    return null;
  }
  if (suppression.reason !== 'REJECTED') {
    return { reason: suppression.reason };
  }
  return suppression.until === null
    ? { reason: 'BOUNCE' }
    : { reason: 'REJECTED', until: suppression.until };
};

export const toNotificationSettingsView = (
  settings: NotificationSettingsFragment,
): NotificationSettingsView => ({
  preferences: NOTIFICATION_TOPICS.map((topic) => ({
    topic,
    enabled: settings.preferences.some(
      (preference) =>
        preference.topic === TOPIC_VALUES[topic] && preference.enabled,
    ),
  })),
  suppression: toSuppressionView(settings.suppression),
  deliveryStatusAvailable: settings.deliveryStatusAvailable,
  emailVerified: settings.emailVerified,
  editable: settings.editable,
});

// 複数の種別の保存が並ぶと、後から届いた応答の全体には先に保存した種別の古い値が残り得るため、保存した種別の受信可否だけを今のキャッシュへ写す
export const withSavedNotificationPreference = (
  current: NotificationSettingsFragment | undefined,
  saved: NotificationSettingsFragment,
  topic: NotificationTopic,
): NotificationSettingsFragment => {
  if (current === undefined) {
    return saved;
  }
  const value = TOPIC_VALUES[topic];
  const enabled = saved.preferences.some(
    (preference) => preference.topic === value && preference.enabled,
  );
  const preferences = current.preferences.some(
    (preference) => preference.topic === value,
  )
    ? current.preferences.map((preference) =>
        preference.topic === value ? { ...preference, enabled } : preference,
      )
    : [...current.preferences, { topic: value, enabled }];
  return { ...current, preferences };
};

// 受信可否の変更の結果も同じ形のため、このキーのキャッシュへ書ける。本人の設定のため、同じタブでログインし直した別の利用者に前の利用者の設定を見せないよう、共通の取得の補助のキーの後に閲覧者のIDを加える
export const notificationSettingsQueryOptions = (viewerId: string) =>
  queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientViewerNotificationSettingsDocument, {}),
      viewerId,
    ],
    queryFn: async ({ signal }): Promise<NotificationSettingsFragment> =>
      requireData(
        await executeGraphQL(
          ClientViewerNotificationSettingsDocument,
          {},
          { signal },
        ),
      ).viewerNotificationSettings,
  });

// 通知設定が無ければページを表示できないため、取得の失敗はエラーの画面にする。キャッシュにあれば取得し直さない
export async function loadNotificationSettings({
  context,
}: {
  readonly context: {
    readonly queryClient: QueryClient;
    readonly viewer: { readonly id: string };
  };
}): Promise<void> {
  await context.queryClient.query({
    ...notificationSettingsQueryOptions(context.viewer.id),
    staleTime: 'static',
  });
}

export type UnsubscribeLinkView =
  | { readonly status: 'invalid' }
  | {
      readonly status: 'subscribed' | 'already_disabled';
      readonly topic: NotificationTopic;
    };

export const toUnsubscribeLinkView = (
  link: NotificationUnsubscribeLinkFragment | null,
): UnsubscribeLinkView => {
  if (link === null) {
    return { status: 'invalid' };
  }
  return {
    status: link.enabled ? 'subscribed' : 'already_disabled',
    topic: notificationTopicOf(link.topic),
  };
};

// 照合できないトークン(null)と長さの検証の失敗は、失効済みのリンクと区別せず無効の表示にするため、例外にせず無効の状態として返す
export const notificationUnsubscribeLinkQueryOptions = (token: string) =>
  queryOptions({
    queryKey: graphqlQueryKey(ClientNotificationUnsubscribeLinkDocument, {
      token,
    }),
    queryFn: async ({ signal }): Promise<UnsubscribeLinkView> => {
      const result = await executeGraphQL(
        ClientNotificationUnsubscribeLinkDocument,
        { token },
        { signal },
      );
      if (!result.ok && isInvalidLinkError(result.error)) {
        return { status: 'invalid' };
      }
      return toUnsubscribeLinkView(
        requireData(result).notificationUnsubscribeLink,
      );
    },
  });
