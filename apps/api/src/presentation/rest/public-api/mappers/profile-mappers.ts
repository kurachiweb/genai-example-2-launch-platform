import type { MediaFileView } from '../../../../../lib/core/media/media-file.ts';
import type { MyProfileView } from '../../../../application/profile/ports.ts';
import type { PublicProfileView } from '../../../../application/profile/public-profile-reader.ts';
import type { PublicProfilePatch } from '../../../../application/public-api/public-profile-updater.ts';
import type { MediaLookupRequest } from '../media-lookup.ts';
import type {
  MyProfile,
  MyProfilePatchBody,
  PublicProfile,
} from '../schemas/profiles.ts';
import {
  AVATAR_IMAGE_VARIANT,
  profilePageUrl,
  type PublicApiOrigins,
  toApiImage,
} from './common-mappers.ts';

interface ProfileFieldsSource {
  readonly handle: string;
  readonly nickname: string;
  readonly headline: string | null;
  readonly bioMarkdown: string | null;
  readonly avatarFileId: string | null;
  readonly websites: readonly {
    readonly name: string | null;
    readonly url: string;
  }[];
}

export const mediaRequestOfAvatar = (
  avatarFileId: string | null,
): MediaLookupRequest => ({
  fileIds: avatarFileId === null ? [] : [avatarFileId],
  userIds: [],
});

// 外部Webサイトは画面と同じく保存の時点の検証を信頼し、出力の時点で検証し直さない
const profileFieldsOf = (
  source: ProfileFieldsSource,
  files: ReadonlyMap<string, MediaFileView>,
  origins: PublicApiOrigins,
) => ({
  handle: source.handle,
  nickname: source.nickname,
  headline: source.headline,
  bio_markdown: source.bioMarkdown,
  avatar:
    source.avatarFileId === null
      ? null
      : toApiImage(
          files.get(source.avatarFileId),
          AVATAR_IMAGE_VARIANT,
          origins.images,
        ),
  websites: source.websites.map(({ name, url }) => ({ name, url })),
  profile_url: profilePageUrl(origins.site, source.handle),
});

export const toMyProfile = (
  view: MyProfileView,
  files: ReadonlyMap<string, MediaFileView>,
  origins: PublicApiOrigins,
): MyProfile => ({
  ...profileFieldsOf(view, files, origins),
  previous_handle: view.previousHandle,
});

export const toPublicProfile = (
  view: PublicProfileView,
  files: ReadonlyMap<string, MediaFileView>,
  origins: PublicApiOrigins,
): PublicProfile => ({
  ...profileFieldsOf(view, files, origins),
  follower_count: view.followerCount,
  ultras: view.ultras,
});

export const toProfilePatch = (
  body: MyProfilePatchBody,
): PublicProfilePatch => ({
  ...(body.nickname === undefined ? {} : { nickname: body.nickname }),
  ...(body.handle === undefined ? {} : { handle: body.handle }),
  ...(body.headline === undefined ? {} : { headline: body.headline }),
  ...(body.bio_markdown === undefined
    ? {}
    : { bioMarkdown: body.bio_markdown }),
  ...(body.websites === undefined ? {} : { websites: body.websites }),
});
