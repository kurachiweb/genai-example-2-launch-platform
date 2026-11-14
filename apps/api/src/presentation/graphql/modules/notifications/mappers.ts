import {
  NOTIFICATION_TOPICS,
  type NotificationTopic,
} from '../../../../../common-lib/notifications/notification-topics.ts';
import type { NoticeSuppressionReason } from '../../../../../lib/core/notifications/notice-copy.ts';
import type { NotificationSettingsView } from '../../../../application/notifications/notification-settings-service.ts';
import type { DeliveryStatus } from '../../../../application/notifications/ports.ts';
import type { SenderInfoView } from '../../../../application/notifications/sender-info-service.ts';
import type { UnsubscribeLinkView } from '../../../../application/notifications/unsubscribe-service.ts';
import type {
  DeliverySuppression,
  DeliverySuppressionReason,
  NotificationTopic as GraphQLNotificationTopic,
  NotificationSenderInfoState,
  NotificationSettings,
  NotificationUnsubscribeLink,
} from '../../generated/resolvers-types.ts';

const TOPIC_VALUES: Readonly<
  Record<NotificationTopic, GraphQLNotificationTopic>
> = Object.freeze({
  match_preview: 'MATCH_PREVIEW',
  match_result: 'MATCH_RESULT',
  followed_user_match: 'FOLLOWED_USER_MATCH',
  followed_user_award: 'FOLLOWED_USER_AWARD',
});

const SUPPRESSION_REASON_VALUES: Readonly<
  Record<NoticeSuppressionReason, DeliverySuppressionReason>
> = Object.freeze({
  bounce: 'BOUNCE',
  complaint: 'COMPLAINT',
  rejected: 'REJECTED',
});

function toDeliverySuppression(
  delivery: DeliveryStatus,
): DeliverySuppression | null {
  return delivery.kind === 'suppressed'
    ? {
        reason: SUPPRESSION_REASON_VALUES[delivery.reason],
        until: delivery.until,
      }
    : null;
}

export function toNotificationSettings(
  view: NotificationSettingsView,
): NotificationSettings {
  return {
    preferences: NOTIFICATION_TOPICS.map((topic) => ({
      topic: TOPIC_VALUES[topic],
      enabled: view.preferences.get(topic) === true,
    })),
    suppression: toDeliverySuppression(view.delivery),
    deliveryStatusAvailable: view.delivery.kind !== 'unknown',
    emailVerified: view.emailVerified,
    editable: view.editable,
  };
}

export function toNotificationUnsubscribeLink(
  view: UnsubscribeLinkView,
): NotificationUnsubscribeLink {
  return { topic: TOPIC_VALUES[view.topic], enabled: view.enabled };
}

export function toNotificationSenderInfoState(
  view: SenderInfoView,
  updatedByNickname: string | null,
): NotificationSenderInfoState {
  return {
    info: view.info === null ? null : { ...view.info },
    version: view.version,
    updatedAt: view.updatedAt,
    updatedByNickname,
  };
}
