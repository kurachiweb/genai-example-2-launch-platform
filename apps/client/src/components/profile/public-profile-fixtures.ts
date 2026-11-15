import type { PublicProfileView } from './public-profile-view.ts';

export const PROFILE_NICKNAME = 'ピッチの作り手';

export const PROFILE_HANDLE = 'maker_ai';

export const publicProfileOf = (
  overrides: Partial<PublicProfileView> = {},
): PublicProfileView => ({
  __typename: 'PublicProfile',
  handle: PROFILE_HANDLE,
  nickname: PROFILE_NICKNAME,
  headline: null,
  bio: null,
  avatar: null,
  websites: [],
  followerCount: 0,
  ultras: false,
  suspended: false,
  viewerRelation: 'NOT_FOLLOWING',
  ...overrides,
});
