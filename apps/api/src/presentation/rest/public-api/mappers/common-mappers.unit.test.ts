import { describe, expect, test } from 'bun:test';

import type { MediaFileView } from '../../../../../lib/core/media/media-file.ts';
import type { UserSummaryRecord } from '../../../../../lib/core/profile/ports.ts';
import {
  imageFileViewOf,
  mediaFileViewOf,
} from '../../../../../test/support/media-file-view.ts';
import {
  productPageUrl,
  profilePageUrl,
  publicApiOriginsOf,
  toApiImage,
  toUserSummary,
  userSummaryOf,
} from './common-mappers.ts';

const IMAGES_ORIGIN = 'https://images.launch.example';

const SITE_ORIGIN = 'https://launch.example';

const ORIGINS = publicApiOriginsOf({
  IMAGES_ORIGIN,
  CLIENT_SITE_ORIGIN: SITE_ORIGIN,
});

const OBJECT_KEY = 'fedcba9876543210'.repeat(2);

const AVATAR_FILE_ID = '01JC0F11E000000000000000002';

const USER_ID = '01JC0VSER00000000000000001';

const servableImageOf = (
  overrides: Partial<MediaFileView> = {},
): MediaFileView =>
  imageFileViewOf({
    objectKey: OBJECT_KEY,
    location: 'images',
    moderationStatus: 'passed',
    quarantineReasons: Object.freeze([]),
    quarantined: false,
    ...overrides,
  });

const userOf = (
  overrides: Partial<UserSummaryRecord> = {},
): UserSummaryRecord => ({
  userId: USER_ID,
  handle: 'alice',
  nickname: 'アリス',
  avatarFileId: AVATAR_FILE_ID,
  suspended: false,
  ...overrides,
});

describe('公開APIのオリジン', () => {
  test('画像配信とサイトのオリジンを環境の変数から取る', () => {
    expect(ORIGINS).toEqual({ images: IMAGES_ORIGIN, site: SITE_ORIGIN });
  });
});

describe('画像の写像', () => {
  test('配信できる画像は、画像配信のオリジンにオブジェクトキー・変換の名前・代替の形式を並べた絶対URLと寸法を返す', () => {
    expect(toApiImage(servableImageOf(), 'square-lg', IMAGES_ORIGIN)).toEqual({
      url: `${IMAGES_ORIGIN}/${OBJECT_KEY}/square-lg.png`,
      width: 640,
      height: 480,
    });
  });

  test.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/gif', 'png'],
    ['image/webp', 'png'],
    ['image/svg+xml', 'svg'],
  ] as const)('%sの画像の拡張子は%sにする', (contentType, extension) => {
    expect(
      toApiImage(
        servableImageOf({ contentType }),
        'screenshot-full',
        IMAGES_ORIGIN,
      )?.url,
    ).toBe(`${IMAGES_ORIGIN}/${OBJECT_KEY}/screenshot-full.${extension}`);
  });

  test('寸法が記録されていない画像は幅と高さをnullにする', () => {
    expect(
      toApiImage(
        servableImageOf({ width: null, height: null }),
        'square-lg',
        IMAGES_ORIGIN,
      ),
    ).toEqual({
      url: `${IMAGES_ORIGIN}/${OBJECT_KEY}/square-lg.png`,
      width: null,
      height: null,
    });
  });

  test('論理削除済みの画像は物理削除まで配信するため、URLを返す', () => {
    expect(
      toApiImage(
        servableImageOf({ deletedAt: new Date('2026-11-02T00:00:00.000Z') }),
        'square-lg',
        IMAGES_ORIGIN,
      )?.url,
    ).toBe(`${IMAGES_ORIGIN}/${OBJECT_KEY}/square-lg.png`);
  });

  test.each([
    ['画像の記録が無い', undefined],
    ['保存が完了していない', servableImageOf({ stored: false })],
    ['削除待ち', servableImageOf({ eraseRequested: true })],
    [
      '隔離中',
      servableImageOf({
        location: 'quarantine',
        quarantineReasons: Object.freeze(['auto']),
        quarantined: true,
      }),
    ],
    [
      '画像でないファイル',
      mediaFileViewOf({ storage: 'images', location: 'images' }),
    ],
    ['画像用でない保存先のファイル', servableImageOf({ storage: 'files' })],
  ] as const)('%sならnullを返す', (_label, file) => {
    expect(toApiImage(file, 'square-lg', IMAGES_ORIGIN)).toBeNull();
  });
});

describe('ページのURL', () => {
  test('プロフィールのページはサイトのオリジンの/@ハンドル', () => {
    expect(profilePageUrl(SITE_ORIGIN, 'alice')).toBe(`${SITE_ORIGIN}/@alice`);
  });

  test('プロダクトのページはサイトのオリジンの/p/ハンドル', () => {
    expect(productPageUrl(SITE_ORIGIN, 'Alpha_1')).toBe(
      `${SITE_ORIGIN}/p/Alpha_1`,
    );
  });
});

describe('利用者の表示の写像', () => {
  test('ハンドル・ニックネーム・プロフィール画像・プロフィールのページのURLを返し、利用者のIDを含めない', () => {
    const files = new Map([[AVATAR_FILE_ID, servableImageOf()]]);

    expect(toUserSummary(userOf(), files, ORIGINS)).toEqual({
      handle: 'alice',
      nickname: 'アリス',
      avatar: {
        url: `${IMAGES_ORIGIN}/${OBJECT_KEY}/square-lg.png`,
        width: 640,
        height: 480,
      },
      profile_url: `${SITE_ORIGIN}/@alice`,
    });
  });

  test('プロフィール画像が無い、または配信できない利用者は画像をnullにする', () => {
    const quarantined = new Map([
      [AVATAR_FILE_ID, servableImageOf({ quarantined: true })],
    ]);

    expect(
      toUserSummary(userOf({ avatarFileId: null }), new Map(), ORIGINS).avatar,
    ).toBeNull();
    expect(toUserSummary(userOf(), new Map(), ORIGINS).avatar).toBeNull();
    expect(toUserSummary(userOf(), quarantined, ORIGINS).avatar).toBeNull();
  });

  test('照会の結果に無い利用者(停止中・退会済み・不在)はnullにする', () => {
    const loaded = { files: new Map(), users: new Map([[USER_ID, userOf()]]) };

    expect(userSummaryOf(USER_ID, loaded, ORIGINS)?.handle).toBe('alice');
    expect(
      userSummaryOf('01JC0VSER00000000000000009', loaded, ORIGINS),
    ).toBeNull();
  });
});
