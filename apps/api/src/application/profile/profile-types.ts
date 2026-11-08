const ProfileStore: unique symbol = Symbol.for('profile.ProfileStore');

const ProfileEditor: unique symbol = Symbol.for('profile.ProfileEditor');

const MyProfileReader: unique symbol = Symbol.for('profile.MyProfileReader');

const HandleAvailabilityChecker: unique symbol = Symbol.for(
  'profile.HandleAvailabilityChecker',
);

const UserHandleAvailability: unique symbol = Symbol.for(
  'profile.UserHandleAvailability',
);

export const PROFILE_TYPES = Object.freeze({
  ProfileStore,
  ProfileEditor,
  MyProfileReader,
  HandleAvailabilityChecker,
  UserHandleAvailability,
});
