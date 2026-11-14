// APIサーバーのPROFILE_TYPESとbackend-lib/core/profileの識別子がprofile.の接頭辞を使うため、イベントサーバーの識別子はprofile.event.で分ける
const ProfilePurgeStore: unique symbol = Symbol.for(
  'profile.event.ProfilePurgeStore',
);
const ProfileErasureHandler: unique symbol = Symbol.for(
  'profile.event.ProfileErasureHandler',
);
const OwnedFileErasureHandler: unique symbol = Symbol.for(
  'profile.event.OwnedFileErasureHandler',
);
const OwnedImageQuarantineHandler: unique symbol = Symbol.for(
  'profile.event.OwnedImageQuarantineHandler',
);

export const EVENT_PROFILE_TYPES = Object.freeze({
  ProfilePurgeStore,
  ProfileErasureHandler,
  OwnedFileErasureHandler,
  OwnedImageQuarantineHandler,
});
