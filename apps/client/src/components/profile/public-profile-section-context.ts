import type { PublicProfileSectionContext } from './public-profile-section-types.ts';
import type { PublicProfileView } from './public-profile-view.ts';

export const publicProfileSectionContextOf = (
  profile: PublicProfileView,
): PublicProfileSectionContext => ({
  handle: profile.handle,
  nickname: profile.nickname,
  isOwner: profile.viewerRelation === 'OWNER',
  suspended: profile.suspended,
});
