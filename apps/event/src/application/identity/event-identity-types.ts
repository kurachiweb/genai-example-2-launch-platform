const UserLifecycleStore: unique symbol = Symbol.for(
  'identity.event.UserLifecycleStore',
);
const IdentityPurgeStore: unique symbol = Symbol.for(
  'identity.event.IdentityPurgeStore',
);
const UserEmailLookup: unique symbol = Symbol.for(
  'identity.event.UserEmailLookup',
);
const DisposableStatusStore: unique symbol = Symbol.for(
  'identity.event.DisposableStatusStore',
);
const DisposableEmailChecker: unique symbol = Symbol.for(
  'identity.event.DisposableEmailChecker',
);
const UserLifecycleRunner: unique symbol = Symbol.for(
  'identity.event.UserLifecycleRunner',
);
const EmailSuppressionCleanupHandler: unique symbol = Symbol.for(
  'identity.event.EmailSuppressionCleanupHandler',
);
const DisposableEmailRecheckHandler: unique symbol = Symbol.for(
  'identity.event.DisposableEmailRecheckHandler',
);

export const EVENT_IDENTITY_TYPES = Object.freeze({
  UserLifecycleStore,
  IdentityPurgeStore,
  UserEmailLookup,
  DisposableStatusStore,
  DisposableEmailChecker,
  UserLifecycleRunner,
  EmailSuppressionCleanupHandler,
  DisposableEmailRecheckHandler,
});
