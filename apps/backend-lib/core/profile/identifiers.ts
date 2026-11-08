const UserProfileDirectory: unique symbol = Symbol.for(
  'profile.UserProfileDirectory',
);
const ProfileExport: unique symbol = Symbol.for('profile.ProfileExport');
const FollowExport: unique symbol = Symbol.for('profile.FollowExport');
const FollowerDirectory: unique symbol = Symbol.for(
  'profile.FollowerDirectory',
);

export const PROFILE_PLATFORM_TYPES = Object.freeze({
  UserProfileDirectory,
  ProfileExport,
  FollowExport,
  FollowerDirectory,
});
