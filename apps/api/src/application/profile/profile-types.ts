const ProfileStore: unique symbol = Symbol.for('profile.ProfileStore');

const ProfileEditor: unique symbol = Symbol.for('profile.ProfileEditor');

const MyProfileReader: unique symbol = Symbol.for('profile.MyProfileReader');

const HandleAvailabilityChecker: unique symbol = Symbol.for(
  'profile.HandleAvailabilityChecker',
);

export const PROFILE_TYPES = Object.freeze({
  ProfileStore,
  ProfileEditor,
  MyProfileReader,
  HandleAvailabilityChecker,
});
