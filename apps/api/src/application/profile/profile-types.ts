const ProfileStore: unique symbol = Symbol.for('profile.ProfileStore');

const ProfileEditor: unique symbol = Symbol.for('profile.ProfileEditor');

const MyProfileReader: unique symbol = Symbol.for('profile.MyProfileReader');

const HandleAvailabilityChecker: unique symbol = Symbol.for(
  'profile.HandleAvailabilityChecker',
);

const UserHandleAvailability: unique symbol = Symbol.for(
  'profile.UserHandleAvailability',
);

const PublicProfileStore: unique symbol = Symbol.for(
  'profile.PublicProfileStore',
);

const PublicProfileReader: unique symbol = Symbol.for(
  'profile.PublicProfileReader',
);

const FollowStore: unique symbol = Symbol.for('profile.FollowStore');

const FollowService: unique symbol = Symbol.for('profile.FollowService');

const FollowListReader: unique symbol = Symbol.for('profile.FollowListReader');

export const PROFILE_TYPES = Object.freeze({
  ProfileStore,
  ProfileEditor,
  MyProfileReader,
  HandleAvailabilityChecker,
  UserHandleAvailability,
  PublicProfileStore,
  PublicProfileReader,
  FollowStore,
  FollowService,
  FollowListReader,
});
