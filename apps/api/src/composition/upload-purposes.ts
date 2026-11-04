import {
  ADMIN_AVATAR_MAX_BYTES,
  ADMIN_AVATAR_UPLOAD_PURPOSE,
} from '../../common-lib/admin/admin-avatar-upload.ts';
import { IMAGE_MEDIA_TYPES } from '../../common-lib/media/media-types.ts';
import {
  defineUploadPurpose,
  type UploadPurpose,
} from '../../lib/core/media/upload-purpose.ts';

export const UPLOAD_PURPOSES: readonly UploadPurpose[] = [
  defineUploadPurpose({
    name: ADMIN_AVATAR_UPLOAD_PURPOSE,
    storage: 'images',
    uploaderKinds: ['admin'],
    allowedTypes: IMAGE_MEDIA_TYPES,
    maxBytes: ADMIN_AVATAR_MAX_BYTES,
  }),
];
