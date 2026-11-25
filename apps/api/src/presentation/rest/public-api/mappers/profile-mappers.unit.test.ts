import { describe, expect, test } from 'bun:test';

import type { MediaFileView } from '../../../../../lib/core/media/media-file.ts';
import { imageFileViewOf } from '../../../../../test/support/media-file-view.ts';
import type { MyProfileView } from '../../../../application/profile/ports.ts';
import type { PublicProfileView } from '../../../../application/profile/public-profile-reader.ts';
import {
  AVATAR_IMAGE_VARIANT,
  publicApiOriginsOf,
  toApiImage,
} from './common-mappers.ts';
import {
  mediaRequestOfAvatar,
  toMyProfile,
  toProfilePatch,
  toPublicProfile,
} from './profile-mappers.ts';

const IMAGES_ORIGIN = 'https://images.launch.example';

const SITE_ORIGIN = 'https://launch.example';

const ORIGINS = publicApiOriginsOf({
  IMAGES_ORIGIN,
  CLIENT_SITE_ORIGIN: SITE_ORIGIN,
});

const AVATAR_FILE_ID = '01JC0F00000000000000000001';

const AVATAR: MediaFileView = imageFileViewOf({
  id: AVATAR_FILE_ID,
  purpose: 'user-avatar',
  location: 'images',
  stored: true,
  moderationStatus: 'passed',
  quarantineReasons: [],
  quarantined: false,
  width: 400,
  height: 400,
});

const FILES: ReadonlyMap<string, MediaFileView> = new Map([
  [AVATAR_FILE_ID, AVATAR],
]);

const WEBSITES = [
  { name: 'GitHub', url: 'https://github.example/alice' },
  { name: null, url: 'https://blog.example/' },
];

const MY_PROFILE: MyProfileView = {
  nickname: 'アリス',
  handle: 'alice',
  previousHandle: 'alice-old',
  headline: '個人開発者',
  bioMarkdown: '**自己紹介**',
  avatarFileId: AVATAR_FILE_ID,
  websites: WEBSITES,
  suspended: false,
};

const PUBLIC_PROFILE: PublicProfileView = {
  handle: 'alice',
  nickname: 'アリス',
  headline: null,
  bioMarkdown: null,
  avatarFileId: AVATAR_FILE_ID,
  websites: WEBSITES,
  followerCount: 3,
  ultras: true,
  suspended: false,
  viewerRelation: 'guest',
};

describe('mediaRequestOfAvatar', () => {
  test('画像があればその画像だけを、無ければ何も読まない', () => {
    expect(mediaRequestOfAvatar(AVATAR_FILE_ID)).toEqual({
      fileIds: [AVATAR_FILE_ID],
      userIds: [],
    });
    expect(mediaRequestOfAvatar(null)).toEqual({ fileIds: [], userIds: [] });
  });
});

describe('toMyProfile', () => {
  test('旧ハンドル・画像の絶対URL・プロフィールのページのURLを持ち、停止の状態を含めない', () => {
    const profile = toMyProfile(MY_PROFILE, FILES, ORIGINS);

    expect(profile).toEqual({
      handle: 'alice',
      previous_handle: 'alice-old',
      nickname: 'アリス',
      headline: '個人開発者',
      bio_markdown: '**自己紹介**',
      avatar: toApiImage(AVATAR, AVATAR_IMAGE_VARIANT, IMAGES_ORIGIN),
      websites: WEBSITES,
      profile_url: `${SITE_ORIGIN}/@alice`,
    });
    expect(profile.avatar).toMatchObject({ width: 400, height: 400 });
    expect(profile.avatar?.url.startsWith(`${IMAGES_ORIGIN}/`)).toBe(true);
  });

  test('配信できない画像と画像の無いプロフィールはavatarをnullにする', () => {
    const quarantined = new Map([
      [AVATAR_FILE_ID, { ...AVATAR, quarantined: true }],
    ]);
    expect(toMyProfile(MY_PROFILE, quarantined, ORIGINS).avatar).toBeNull();
    expect(
      toMyProfile({ ...MY_PROFILE, avatarFileId: null }, FILES, ORIGINS).avatar,
    ).toBeNull();
  });
});

describe('toPublicProfile', () => {
  test('フォロワー数とUltras加入中かどうかを持ち、閲覧者との関係と停止の状態を含めない', () => {
    expect(toPublicProfile(PUBLIC_PROFILE, FILES, ORIGINS)).toEqual({
      handle: 'alice',
      nickname: 'アリス',
      headline: null,
      bio_markdown: null,
      avatar: toApiImage(AVATAR, AVATAR_IMAGE_VARIANT, IMAGES_ORIGIN),
      websites: WEBSITES,
      follower_count: 3,
      ultras: true,
      profile_url: `${SITE_ORIGIN}/@alice`,
    });
  });
});

describe('toProfilePatch', () => {
  test('snake_caseの項目をユースケースの項目へ写し、指定の無い項目を含めない', () => {
    expect(toProfilePatch({ bio_markdown: null, handle: 'alice-new' })).toEqual(
      { bioMarkdown: null, handle: 'alice-new' },
    );
    expect(
      toProfilePatch({
        nickname: 'アリス',
        headline: '個人開発者',
        websites: [{ name: null, url: 'https://a.example/' }],
      }),
    ).toEqual({
      nickname: 'アリス',
      headline: '個人開発者',
      websites: [{ name: null, url: 'https://a.example/' }],
    });
  });
});
