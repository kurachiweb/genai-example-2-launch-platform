// APIサーバーとbackend-lib/core/notificationsの識別子がnotifications.の接頭辞を使うため、イベントサーバーの識別子はnotifications.event.で分ける
const EveningCollector: unique symbol = Symbol.for(
  'notifications.event.EveningCollector',
);
const MorningCollector: unique symbol = Symbol.for(
  'notifications.event.MorningCollector',
);
const SupplementSource: unique symbol = Symbol.for(
  'notifications.event.SupplementSource',
);

export const EVENT_NOTIFICATIONS_TYPES = Object.freeze({
  EveningCollector,
  MorningCollector,
  SupplementSource,
});
