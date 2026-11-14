const NotificationPreferenceStore: unique symbol = Symbol.for(
  'notifications.NotificationPreferenceStore',
);
const UnsubscribeTokenService: unique symbol = Symbol.for(
  'notifications.UnsubscribeTokenService',
);
const SenderInfoStore: unique symbol = Symbol.for(
  'notifications.SenderInfoStore',
);
const NotificationSlotStore: unique symbol = Symbol.for(
  'notifications.NotificationSlotStore',
);
const NotificationNoticeStore: unique symbol = Symbol.for(
  'notifications.NotificationNoticeStore',
);
const NotificationEventPublisher: unique symbol = Symbol.for(
  'notifications.NotificationEventPublisher',
);
const NotificationEventExpander: unique symbol = Symbol.for(
  'notifications.NotificationEventExpander',
);
const NotificationWorkRequester: unique symbol = Symbol.for(
  'notifications.NotificationWorkRequester',
);
const NotificationSettingsExport: unique symbol = Symbol.for(
  'notifications.NotificationSettingsExport',
);
const NotificationIncidentReporter: unique symbol = Symbol.for(
  'notifications.NotificationIncidentReporter',
);
const EveningDispatchGate: unique symbol = Symbol.for(
  'notifications.EveningDispatchGate',
);
const EveningSlotOpener: unique symbol = Symbol.for(
  'notifications.EveningSlotOpener',
);
const EveningDispatchParticipants: unique symbol = Symbol.for(
  'notifications.EveningDispatchParticipants',
);

export const NOTIFICATIONS_PLATFORM_TYPES = Object.freeze({
  NotificationPreferenceStore,
  UnsubscribeTokenService,
  SenderInfoStore,
  NotificationSlotStore,
  NotificationNoticeStore,
  NotificationEventPublisher,
  NotificationEventExpander,
  NotificationWorkRequester,
  NotificationSettingsExport,
  NotificationIncidentReporter,
  EveningDispatchGate,
  EveningSlotOpener,
  EveningDispatchParticipants,
});
