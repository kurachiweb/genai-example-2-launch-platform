import { IMAGE_MEDIA_TYPES } from '../../common-lib/media/media-types.ts';
import {
  defineUploadPurpose,
  type UploadPurpose,
} from '../../lib/core/media/upload-purpose.ts';
import { ADMIN_AVATAR_UPLOAD_PURPOSE } from '../application/admin/admin-profile.ts';

export const UPLOAD_PURPOSES: readonly UploadPurpose[] = [
  defineUploadPurpose({
    name: ADMIN_AVATAR_UPLOAD_PURPOSE,
    storage: 'images',
    uploaderKinds: ['admin'],
    allowedTypes: IMAGE_MEDIA_TYPES,
    maxBytes: 512_000,
  }),
];
