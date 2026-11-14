const DeliveryStatusReader: unique symbol = Symbol.for(
  'notifications.DeliveryStatusReader',
);

const NotificationSettingsService: unique symbol = Symbol.for(
  'notifications.NotificationSettingsService',
);

export const NOTIFICATIONS_TYPES = Object.freeze({
  DeliveryStatusReader,
  NotificationSettingsService,
});
