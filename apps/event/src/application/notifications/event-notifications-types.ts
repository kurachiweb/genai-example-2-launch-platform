// APIサーバーとbackend-lib/core/notificationsの識別子がnotifications.の接頭辞を使うため、イベントサーバーの識別子はnotifications.event.で分ける
const EveningCollector: unique symbol = Symbol.for(
  'notifications.event.EveningCollector',
);
const MorningCollector: unique symbol = Symbol.for(
  'notifications.event.MorningCollector',
);
const GroupDispatcher: unique symbol = Symbol.for(
  'notifications.event.GroupDispatcher',
);
const SupplementSource: unique symbol = Symbol.for(
  'notifications.event.SupplementSource',
);
const FlushSlotHandler: unique symbol = Symbol.for(
  'notifications.event.FlushSlotHandler',
);
const ExpandEventHandler: unique symbol = Symbol.for(
  'notifications.event.ExpandEventHandler',
);
const OneClickUnsubscribe: unique symbol = Symbol.for(
  'notifications.event.OneClickUnsubscribe',
);
const AccountPurgeHandler: unique symbol = Symbol.for(
  'notifications.event.AccountPurgeHandler',
);

export const EVENT_NOTIFICATIONS_TYPES = Object.freeze({
  EveningCollector,
  MorningCollector,
  SupplementSource,
  GroupDispatcher,
  FlushSlotHandler,
  ExpandEventHandler,
  OneClickUnsubscribe,
  AccountPurgeHandler,
});
