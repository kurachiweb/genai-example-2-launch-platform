const DeliveryStatusReader: unique symbol = Symbol.for(
  'notifications.DeliveryStatusReader',
);

const NotificationSettingsService: unique symbol = Symbol.for(
  'notifications.NotificationSettingsService',
);

const UnsubscribeService: unique symbol = Symbol.for(
  'notifications.UnsubscribeService',
);

const SenderInfoService: unique symbol = Symbol.for(
  'notifications.SenderInfoService',
);

const SenderInfoWriter: unique symbol = Symbol.for(
  'notifications.SenderInfoWriter',
);

export const NOTIFICATIONS_TYPES = Object.freeze({
  DeliveryStatusReader,
  NotificationSettingsService,
  UnsubscribeService,
  SenderInfoService,
  SenderInfoWriter,
});
