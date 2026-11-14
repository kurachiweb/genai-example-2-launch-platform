const DeliveryStatusReader: unique symbol = Symbol.for(
  'notifications.DeliveryStatusReader',
);

const NotificationSettingsService: unique symbol = Symbol.for(
  'notifications.NotificationSettingsService',
);

const UnsubscribeService: unique symbol = Symbol.for(
  'notifications.UnsubscribeService',
);

export const NOTIFICATIONS_TYPES = Object.freeze({
  DeliveryStatusReader,
  NotificationSettingsService,
  UnsubscribeService,
});
