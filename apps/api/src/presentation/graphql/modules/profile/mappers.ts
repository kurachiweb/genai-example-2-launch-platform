import type { HandleAvailabilityResult } from '../../../../application/profile/handle-availability-checker.ts';
import type { MyProfileView } from '../../../../application/profile/ports.ts';
import type {
  ProfileViewerRelation,
  PublicProfileView,
} from '../../../../application/profile/public-profile-reader.ts';

export type HandleAvailabilityValue = 'AVAILABLE' | 'UNAVAILABLE' | 'INVALID';

export type ProfileViewerRelationValue =
  'OWNER' | 'FOLLOWING' | 'NOT_FOLLOWING' | 'GUEST';

export interface ProfileWebsiteModel {
  readonly name: string | null;
  readonly url: string;
}

export interface PublicProfileModel {
  readonly handle: string;
  readonly nickname: string;
  readonly headline: string | null;
  readonly bio: string | null;
  readonly avatarFileId: string | null;
  readonly websites: readonly ProfileWebsiteModel[];
  readonly followerCount: number;
  readonly ultras: boolean;
  readonly suspended: boolean;
  readonly viewerRelation: ProfileViewerRelationValue;
}

export interface PublicProfileRedirectModel {
  readonly handle: string;
}

export interface MyProfileModel {
  readonly nickname: string;
  readonly handle: string;
  readonly previousHandle: string | null;
  readonly headline: string | null;
  readonly bio: string | null;
  readonly avatarFileId: string | null;
  readonly websites: readonly ProfileWebsiteModel[];
  readonly suspended: boolean;
}

const HANDLE_AVAILABILITY_VALUES: Readonly<
  Record<HandleAvailabilityResult, HandleAvailabilityValue>
> = Object.freeze({
  available: 'AVAILABLE',
  unavailable: 'UNAVAILABLE',
  invalid: 'INVALID',
});

const VIEWER_RELATION_VALUES: Readonly<
  Record<ProfileViewerRelation, ProfileViewerRelationValue>
> = Object.freeze({
  owner: 'OWNER',
  following: 'FOLLOWING',
  'not-following': 'NOT_FOLLOWING',
  guest: 'GUEST',
});

export const handleAvailabilityOf = (
  result: HandleAvailabilityResult,
): HandleAvailabilityValue => HANDLE_AVAILABILITY_VALUES[result];

export const toPublicProfile = (
  view: PublicProfileView,
): PublicProfileModel => ({
  handle: view.handle,
  nickname: view.nickname,
  headline: view.headline,
  bio: view.bioMarkdown,
  avatarFileId: view.avatarFileId,
  websites: view.websites,
  followerCount: view.followerCount,
  ultras: view.ultras,
  suspended: view.suspended,
  viewerRelation: VIEWER_RELATION_VALUES[view.viewerRelation],
});

export const toMyProfile = (view: MyProfileView): MyProfileModel => ({
  nickname: view.nickname,
  handle: view.handle,
  previousHandle: view.previousHandle,
  headline: view.headline,
  bio: view.bioMarkdown,
  avatarFileId: view.avatarFileId,
  websites: view.websites,
  suspended: view.suspended,
});
