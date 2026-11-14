import type { MyProfileView } from './my-profile-view.ts';
import type { ProfileFormInput } from './profile-form-schema.ts';

export const profileFormDefaultsOf = (
  profile: MyProfileView,
): ProfileFormInput => ({
  nickname: profile.nickname,
  handle: profile.handle,
  headline: profile.headline ?? '',
  bio: profile.bio ?? '',
  avatarFileId: profile.avatar?.id ?? null,
  websites: profile.websites.map(({ name, url }) => ({
    name: name ?? '',
    url,
  })),
});
