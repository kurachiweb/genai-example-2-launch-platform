import { z } from 'zod';

import { OBJECT_KEY_PATTERN } from '../../../common-lib/media/image-variants.ts';
import {
  defineMessageContract,
  type MessageContract,
} from '../messaging/message-contract.ts';

export const MEDIA_MESSAGE_LIMITS = Object.freeze({
  relocateBatch: 25,
  purgeBatch: 100,
} as const);

export interface ModerateImageBody {
  readonly fileId: string;
}

export interface RelocateFilesBody {
  readonly fileIds: readonly string[];
}

export interface PurgeImageCacheBody {
  readonly objectKeys: readonly string[];
}

// デッドレターや再試行で本文が運ばれ続けるため、ファイル名・主体・画像の内容を入れず、受信側が記録を読み直す識別子だけを持たせる
const moderateImageBodySchema = z.object({
  fileId: z.ulid(),
});

const relocateFilesBodySchema = z.object({
  fileIds: z.array(z.ulid()).min(1).max(MEDIA_MESSAGE_LIMITS.relocateBatch),
});

const purgeImageCacheBodySchema = z.object({
  objectKeys: z
    .array(z.string().regex(OBJECT_KEY_PATTERN))
    .min(1)
    .max(MEDIA_MESSAGE_LIMITS.purgeBatch),
});

export const MODERATE_IMAGE_MESSAGE: MessageContract<
  'media.moderate-image',
  ModerateImageBody
> = defineMessageContract('media.moderate-image', moderateImageBodySchema);

export const RELOCATE_FILES_MESSAGE: MessageContract<
  'media.relocate-files',
  RelocateFilesBody
> = defineMessageContract('media.relocate-files', relocateFilesBodySchema);

export const PURGE_IMAGE_CACHE_MESSAGE: MessageContract<
  'media.purge-image-cache',
  PurgeImageCacheBody
> = defineMessageContract('media.purge-image-cache', purgeImageCacheBodySchema);
