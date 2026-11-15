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

const AccountWithdrawalSyncHandler: unique symbol = Symbol.for(
  'notifications.AccountWithdrawalSyncHandler',
);

const NotificationMaintenanceStore: unique symbol = Symbol.for(
  'notifications.NotificationMaintenanceStore',
);

const EveningDispatchJob: unique symbol = Symbol.for(
  'notifications.EveningDispatchJob',
);

const MorningDispatchJob: unique symbol = Symbol.for(
  'notifications.MorningDispatchJob',
);

const NotificationMaintenanceJob: unique symbol = Symbol.for(
  'notifications.NotificationMaintenanceJob',
);

export const NOTIFICATIONS_TYPES = Object.freeze({
  DeliveryStatusReader,
  NotificationSettingsService,
  UnsubscribeService,
  SenderInfoService,
  SenderInfoWriter,
  AccountWithdrawalSyncHandler,
  NotificationMaintenanceStore,
  EveningDispatchJob,
  MorningDispatchJob,
  NotificationMaintenanceJob,
});
