import {
  buildImagePath,
  type ImageVariantName,
} from '../../../../../common-lib/media/image-variants.ts';
import {
  fallbackFormatOf,
  isImageMediaType,
} from '../../../../../common-lib/media/media-types.ts';
import {
  isServableImageFile,
  type MediaFileView,
} from '../../../../../lib/core/media/media-file.ts';
import type { UserSummaryRecord } from '../../../../../lib/core/profile/ports.ts';
import type { LoadedMedia } from '../media-lookup.ts';
import type { ApiImage, UserSummary } from '../schemas/common.ts';

export interface PublicApiOrigins {
  readonly images: string;
  readonly site: string;
}

export const AVATAR_IMAGE_VARIANT: ImageVariantName = 'square-lg';

export const LOGO_IMAGE_VARIANT: ImageVariantName = 'square-lg';

export const SCREENSHOT_IMAGE_VARIANT: ImageVariantName = 'screenshot-full';

const PROFILE_PATH_PREFIX = '/@';

const PRODUCT_PATH_PREFIX = '/p/';

export function publicApiOriginsOf(env: {
  readonly IMAGES_ORIGIN: string;
  readonly CLIENT_SITE_ORIGIN: string;
}): PublicApiOrigins {
  return { images: env.IMAGES_ORIGIN, site: env.CLIENT_SITE_ORIGIN };
}

// 画像の配信は画像用の保存先の画像だけを扱うため、それ以外の記録は配信できない画像と同じくnullにする
export function toApiImage(
  file: MediaFileView | undefined,
  variant: ImageVariantName,
  imagesOrigin: string,
): ApiImage | null {
  if (
    file?.storage !== 'images' ||
    !isServableImageFile(file) ||
    !isImageMediaType(file.contentType)
  ) {
    return null;
  }
  const path = buildImagePath(
    file.objectKey,
    variant,
    fallbackFormatOf(file.contentType),
  );
  return {
    url: new URL(path, imagesOrigin).href,
    width: file.width,
    height: file.height,
  };
}

export function profilePageUrl(siteOrigin: string, handle: string): string {
  return new URL(
    `${PROFILE_PATH_PREFIX}${encodeURIComponent(handle)}`,
    siteOrigin,
  ).href;
}

export function productPageUrl(siteOrigin: string, handle: string): string {
  return new URL(
    `${PRODUCT_PATH_PREFIX}${encodeURIComponent(handle)}`,
    siteOrigin,
  ).href;
}

export function toUserSummary(
  user: UserSummaryRecord,
  files: ReadonlyMap<string, MediaFileView>,
  origins: PublicApiOrigins,
): UserSummary {
  return {
    handle: user.handle,
    nickname: user.nickname,
    avatar:
      user.avatarFileId === null
        ? null
        : toApiImage(
            files.get(user.avatarFileId),
            AVATAR_IMAGE_VARIANT,
            origins.images,
          ),
    profile_url: profilePageUrl(origins.site, user.handle),
  };
}

// 一括の照会は可視の利用者だけを返すため、結果に無い利用者(停止中・退会済み・不在)は表示しない
export function userSummaryOf(
  userId: string,
  loaded: LoadedMedia,
  origins: PublicApiOrigins,
): UserSummary | null {
  const user = loaded.users.get(userId);
  return user === undefined ? null : toUserSummary(user, loaded.files, origins);
}
