import {
  GraphQLClientError,
  type GraphQLResult,
} from '../lib/utilities/graphql/graphql-result.ts';
import type {
  ClientConfirmNotificationUnsubscribeMutation,
  ClientNotificationUnsubscribeLinkQuery,
  NotificationTopic,
} from '../src/graphql/generated/graphql.ts';

export const UNSUBSCRIBE_TOKEN = ['unsubscribe', 'link', 'value'].join('_');

export const INVALID_LINK_MESSAGE =
  'このリンクは無効です。通知メールの受信は通知設定から変更できます。';

export const UNSUBSCRIBE_FAILED_MESSAGE =
  '配信を停止できませんでした。時間をおいて再度お試しください。';

export const API_INVALID_LINK_MESSAGE =
  'このリンクは無効か、有効期限が切れています。';

export const unsubscribeLinkResult = (
  link: ClientNotificationUnsubscribeLinkQuery['notificationUnsubscribeLink'],
): GraphQLResult<ClientNotificationUnsubscribeLinkQuery> => ({
  ok: true,
  data: { notificationUnsubscribeLink: link },
});

export const confirmedUnsubscribeResult = (
  topic: NotificationTopic,
): GraphQLResult<ClientConfirmNotificationUnsubscribeMutation> => ({
  ok: true,
  data: { confirmNotificationUnsubscribe: { topic, enabled: false } },
});

export const failedResult = (
  init: ConstructorParameters<typeof GraphQLClientError>[0],
): GraphQLResult<never> => ({ ok: false, error: new GraphQLClientError(init) });

export const invalidLinkFailure = (): GraphQLResult<never> =>
  failedResult({
    code: 'invalid_link',
    message: API_INVALID_LINK_MESSAGE,
    status: 422,
  });
